import { MatchType, ProjectContext, ProjectContextProvider } from './contracts.js';
import { LocalEmbeddingProvider } from './localEmbeddingProvider.js';
import { LocalKnowledge, LocalMemoryMatch, LocalMemoryStore, normalizePrompt } from './localMemoryStore.js';
import { MongoMemoryUnavailableError } from './mongoConnectionManager.js';

const MAX_PROMPT_CHARACTERS = 20_000;
const FULL_SIMILARITY_THRESHOLD = 0.90;
const PARTIAL_SIMILARITY_THRESHOLD = 0.70;
// Calibrated with the bundled model: real pom.xml formulations score 0.850090208950.
// Keep deduplication stricter than PARTIAL (0.70), but do not require a FULL match.
export const SEMANTIC_DEDUPLICATION_THRESHOLD = 0.85;
const SENSITIVE_CONTENT_PATTERNS = [
  /ghp_[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /sk-[A-Za-z0-9_-]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];

export interface MemorySearchResult {
  readonly matchType: MatchType;
  readonly similarity?: number;
  readonly contextCompatible: boolean;
  readonly memoryId?: string;
  readonly reusableSolution?: string;
  readonly memoryUnavailable?: boolean;
}

export interface MemorySaveResult {
  readonly memoryId: string;
  readonly reusedExistingKnowledge: boolean;
  readonly memoryUnavailable?: boolean;
}

export interface MemorySearchDiagnostic {
  readonly normalizedPrompt: string;
  readonly candidates: readonly { readonly memoryId: string; readonly similarity: number; readonly contextCompatible: boolean }[];
  readonly matchType: MatchType;
  readonly reason: 'EXACT' | 'SEMANTIC_FULL' | 'SEMANTIC_PARTIAL' | 'NO_CANDIDATE';
  readonly selectedMemoryId?: string;
}

export type MemorySearchDiagnosticSink = (diagnostic: MemorySearchDiagnostic) => void;

/** Owns only local-memory decisions. It never selects or invokes a language model. */
export class LocalMemoryService {
  public constructor(
    private readonly memory: LocalMemoryStore,
    private readonly embeddings: LocalEmbeddingProvider,
    private readonly projectContext: ProjectContextProvider,
    private readonly onSearchDiagnostic?: MemorySearchDiagnosticSink,
  ) {}

  public async search(request: string): Promise<MemorySearchResult> {
    const prompt = validateRequest(request);
    rejectSensitiveContent(request);
    rejectSensitiveContent(prompt);
    const context = await this.captureContext();
    let exact: LocalKnowledge | undefined;
    try {
      exact = await this.memory.findExact(prompt, context);
    } catch (error) {
      if (error instanceof MongoMemoryUnavailableError) return unavailable();
      throw error;
    }
    if (exact !== undefined) {
      this.diagnose(prompt, [], 'FULL', 'EXACT', exact.id);
      return full(exact, 1);
    }

    const embedding = await this.embeddings.generate(prompt);
    let candidates: readonly LocalMemoryMatch[];
    try {
      candidates = await this.memory.findSimilar(embedding, context);
    } catch (error) {
      if (error instanceof MongoMemoryUnavailableError) return unavailable();
      throw error;
    }
    const compatible = candidates.find((candidate) =>
      candidate.contextCompatible && candidate.similarity >= FULL_SIMILARITY_THRESHOLD);
    if (compatible !== undefined) {
      const reused = await this.requireReuse(compatible.knowledge.id);
      this.diagnose(prompt, candidates, 'FULL', 'SEMANTIC_FULL', reused.id);
      return full(reused, compatible.similarity);
    }

    const partial = candidates.find((candidate) => candidate.similarity >= PARTIAL_SIMILARITY_THRESHOLD);
    if (partial === undefined) {
      this.diagnose(prompt, candidates, 'NONE', 'NO_CANDIDATE');
      return none();
    }
    this.diagnose(prompt, candidates, 'PARTIAL', 'SEMANTIC_PARTIAL', partial.knowledge.id);
    return partialResult(partial);
  }

  public async save(request: string, solution: string): Promise<MemorySaveResult> {
    const prompt = validateRequest(request);
    const reusableSolution = validateSolution(solution);
    rejectSensitiveContent(request);
    rejectSensitiveContent(prompt);
    rejectSensitiveContent(reusableSolution);
    const context = await this.captureContext();
    let existing: LocalKnowledge | undefined;
    try {
      existing = await this.memory.findExact(prompt, context);
    } catch (error) {
      if (error instanceof MongoMemoryUnavailableError) return { memoryId: '', reusedExistingKnowledge: false, memoryUnavailable: true };
      throw error;
    }
    if (existing !== undefined) {
      return { memoryId: existing.id, reusedExistingKnowledge: true };
    }
    const embedding = await this.embeddings.generate(prompt);
    let candidates: readonly LocalMemoryMatch[];
    try {
      candidates = await this.memory.findSimilar(embedding, context);
    } catch (error) {
      if (error instanceof MongoMemoryUnavailableError) return { memoryId: '', reusedExistingKnowledge: false, memoryUnavailable: true };
      throw error;
    }
    const duplicate = candidates.find((candidate) =>
      candidate.contextCompatible && candidate.similarity >= SEMANTIC_DEDUPLICATION_THRESHOLD);
    if (duplicate !== undefined && this.memory.replace !== undefined) {
      let updated: LocalKnowledge | undefined;
      try {
        updated = await this.memory.replace(duplicate.knowledge.id, reusableSolution, embedding);
      } catch (error) {
        if (error instanceof MongoMemoryUnavailableError) return { memoryId: '', reusedExistingKnowledge: false, memoryUnavailable: true };
        throw error;
      }
      if (updated !== undefined) return { memoryId: updated.id, reusedExistingKnowledge: true };
    }
    let stored: LocalKnowledge;
    try {
      stored = await this.memory.save(request, prompt, context, reusableSolution, embedding);
    } catch (error) {
      if (error instanceof MongoMemoryUnavailableError) return { memoryId: '', reusedExistingKnowledge: false, memoryUnavailable: true };
      throw error;
    }
    return { memoryId: stored.id, reusedExistingKnowledge: false };
  }

  private diagnose(
    normalizedPrompt: string,
    candidates: readonly LocalMemoryMatch[],
    matchType: MatchType,
    reason: MemorySearchDiagnostic['reason'],
    selectedMemoryId?: string,
  ): void {
    this.onSearchDiagnostic?.({
      normalizedPrompt,
      candidates: candidates.map((candidate) => ({ memoryId: candidate.knowledge.id, similarity: candidate.similarity, contextCompatible: candidate.contextCompatible })),
      matchType,
      reason,
      selectedMemoryId,
    });
  }

  private async captureContext(): Promise<ProjectContext | undefined> {
    return this.projectContext.capture();
  }

  private async requireReuse(id: string): Promise<LocalKnowledge> {
    const reused = await this.memory.registerReuse(id);
    if (reused === undefined) {
      throw new Error('Conhecimento local não encontrado para reutilização.');
    }
    return reused;
  }
}

function full(knowledge: LocalKnowledge, similarity: number): MemorySearchResult {
  return {
    matchType: 'FULL', similarity, contextCompatible: true,
    memoryId: knowledge.id, reusableSolution: knowledge.response,
  };
}

function partialResult(candidate: LocalMemoryMatch): MemorySearchResult {
  return {
    matchType: 'PARTIAL', similarity: candidate.similarity,
    contextCompatible: candidate.contextCompatible,
    memoryId: candidate.knowledge.id, reusableSolution: candidate.knowledge.response,
  };
}

function none(): MemorySearchResult {
  return { matchType: 'NONE', contextCompatible: false };
}

function unavailable(): MemorySearchResult {
  return { matchType: 'NONE', contextCompatible: false, memoryUnavailable: true };
}

function validateRequest(value: string): string {
  const prompt = normalizePrompt(value);
  if (prompt === '' || prompt.length > MAX_PROMPT_CHARACTERS) {
    throw new Error('A solicitação deve ter entre 1 e 20.000 caracteres.');
  }
  return prompt;
}

function validateSolution(value: string): string {
  const solution = value.trim();
  if (solution === '' || solution.length > 200_000) {
    throw new Error('A solução deve ter entre 1 e 200.000 caracteres.');
  }
  return solution;
}

function rejectSensitiveContent(value: string): void {
  if (SENSITIVE_CONTENT_PATTERNS.some((pattern) => pattern.test(value))) {
    throw new Error('Conteúdo potencialmente sensível não pode ser usado na memória local.');
  }
}
