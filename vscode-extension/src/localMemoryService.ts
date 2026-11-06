import { MatchType, ProjectContext, ProjectContextProvider } from './contracts.js';
import { LocalEmbeddingProvider } from './localEmbeddingProvider.js';
import { LocalKnowledge, LocalMemoryMatch, LocalMemoryStore, MemorySaveOptions, memoryProvenance, memoryScope, normalizePrompt } from './localMemoryStore.js';
import { MongoMemoryUnavailableError } from './mongoConnectionManager.js';
import { containsSensitiveContent } from './sensitiveContent.js';

const MAX_PROMPT_CHARACTERS = 20_000;
const FULL_SIMILARITY_THRESHOLD = 0.90;
const PARTIAL_SIMILARITY_THRESHOLD = 0.70;
// Calibrated with the bundled model: real pom.xml formulations score 0.850090208950.
// Keep deduplication stricter than PARTIAL (0.70), but do not require a FULL match.
export const SEMANTIC_DEDUPLICATION_THRESHOLD = 0.85;

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

export class WorkspaceChangedError extends Error {
  public constructor() { super('O workspace de origem mudou durante a promoção.'); }
}

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
    const workspaceKey = this.currentWorkspaceKey();
    const context = await this.captureContext(workspaceKey);
    if (!this.isCurrentWorkspace(workspaceKey)) return none();
    let exact: LocalKnowledge | undefined;
    try {
      exact = await this.memory.findExact(prompt, context, { workspaceKey });
    } catch (error) {
      if (error instanceof MongoMemoryUnavailableError) return unavailable();
      throw error;
    }
    if (exact !== undefined) {
      if (!this.isCurrentWorkspace(workspaceKey)) return none();
      if (containsSensitiveContent(exact.originalRequest) || containsSensitiveContent(exact.response)) return none();
      this.diagnose(prompt, [], 'FULL', 'EXACT', exact.id);
      return full(exact, 1);
    }

    const embedding = await this.embeddings.generate(prompt);
    if (!this.isCurrentWorkspace(workspaceKey)) return none();
    let candidates: readonly LocalMemoryMatch[];
    try {
      candidates = await this.memory.findSimilar(embedding, context, { workspaceKey });
    } catch (error) {
      if (error instanceof MongoMemoryUnavailableError) return unavailable();
      throw error;
    }
    if (!this.isCurrentWorkspace(workspaceKey)) return none();
    const safeCandidates = candidates.filter((candidate) =>
      !containsSensitiveContent(candidate.knowledge.originalRequest)
      && !containsSensitiveContent(candidate.knowledge.response));
    const compatible = safeCandidates.find((candidate) =>
      candidate.contextCompatible && candidate.similarity >= FULL_SIMILARITY_THRESHOLD);
    if (compatible !== undefined) {
      if (!this.isCurrentWorkspace(workspaceKey)) return none();
      const reused = await this.requireReuse(compatible.knowledge.id);
      if (!this.isCurrentWorkspace(workspaceKey)) return none();
      this.diagnose(prompt, candidates, 'FULL', 'SEMANTIC_FULL', reused.id);
      return full(reused, compatible.similarity);
    }

    const partial = safeCandidates.find((candidate) => candidate.similarity >= PARTIAL_SIMILARITY_THRESHOLD);
    if (partial === undefined) {
      this.diagnose(prompt, candidates, 'NONE', 'NO_CANDIDATE');
      return none();
    }
    if (!this.isCurrentWorkspace(workspaceKey)) return none();
    this.diagnose(prompt, safeCandidates, 'PARTIAL', 'SEMANTIC_PARTIAL', partial.knowledge.id);
    return partialResult(partial);
  }

  public async save(request: string, solution: string, expectedWorkspaceKey?: string): Promise<MemorySaveResult> {
    const prompt = validateRequest(request);
    const reusableSolution = validateSolution(solution);
    rejectSensitiveContent(request);
    rejectSensitiveContent(prompt);
    rejectSensitiveContent(reusableSolution);
    this.assertWorkspace(expectedWorkspaceKey);
    const provenance: MemorySaveOptions = expectedWorkspaceKey === undefined
      ? { provenance: 'MANUAL', scope: 'SHARED' }
      : { provenance: 'AUTO_PROMOTED', scope: 'WORKSPACE', workspaceKey: expectedWorkspaceKey };
    const context = await this.captureContext(expectedWorkspaceKey);
    this.assertWorkspace(expectedWorkspaceKey);
    let existing: LocalKnowledge | undefined;
    try {
      const lookupWorkspaceKey = expectedWorkspaceKey ?? this.currentWorkspaceKey();
      existing = await this.memory.findExact(prompt, context, { workspaceKey: lookupWorkspaceKey, deduplication: provenance });
    } catch (error) {
      if (error instanceof MongoMemoryUnavailableError) return { memoryId: '', reusedExistingKnowledge: false, memoryUnavailable: true };
      throw error;
    }
    if (existing !== undefined) {
      rejectSensitiveContent(existing.originalRequest);
      rejectSensitiveContent(existing.response);
      return { memoryId: existing.id, reusedExistingKnowledge: true };
    }
    const embedding = await this.embeddings.generate(prompt);
    let candidates: readonly LocalMemoryMatch[];
    try {
      const lookupWorkspaceKey = expectedWorkspaceKey ?? this.currentWorkspaceKey();
      candidates = await this.memory.findSimilar(embedding, context, { workspaceKey: lookupWorkspaceKey, deduplication: provenance });
    } catch (error) {
      if (error instanceof MongoMemoryUnavailableError) return { memoryId: '', reusedExistingKnowledge: false, memoryUnavailable: true };
      throw error;
    }
    const duplicate = candidates.find((candidate) =>
      !containsSensitiveContent(candidate.knowledge.originalRequest)
      && !containsSensitiveContent(candidate.knowledge.response)
      && candidate.contextCompatible
      && candidate.similarity >= SEMANTIC_DEDUPLICATION_THRESHOLD
      && sameSaveScope(candidate.knowledge, provenance));
    if (duplicate !== undefined && this.memory.replace !== undefined) {
      this.assertWorkspace(expectedWorkspaceKey);
      let updated: LocalKnowledge | undefined;
      try {
        updated = await this.memory.replace(duplicate.knowledge.id, reusableSolution, embedding);
      } catch (error) {
        if (error instanceof MongoMemoryUnavailableError) return { memoryId: '', reusedExistingKnowledge: false, memoryUnavailable: true };
        throw error;
      }
      if (updated !== undefined) {
        rejectSensitiveContent(updated.originalRequest);
        rejectSensitiveContent(updated.response);
        return { memoryId: updated.id, reusedExistingKnowledge: true };
      }
    }
    let stored: LocalKnowledge;
    try {
      this.assertWorkspace(expectedWorkspaceKey);
      stored = await this.memory.save(request, prompt, context, reusableSolution, embedding, provenance);
    } catch (error) {
      if (error instanceof MongoMemoryUnavailableError) return { memoryId: '', reusedExistingKnowledge: false, memoryUnavailable: true };
      throw error;
    }
    rejectSensitiveContent(stored.originalRequest);
    rejectSensitiveContent(stored.response);
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

  private async captureContext(workspaceKey?: string): Promise<ProjectContext | undefined> {
    return this.projectContext.capture(workspaceKey);
  }

  private currentWorkspaceKey(): string | undefined {
    const provider = this.projectContext as ProjectContextProvider & { currentWorkspaceKeys?: () => readonly string[] };
    const active = (provider as ProjectContextProvider & { currentSearchWorkspaceKey?: () => string | undefined }).currentSearchWorkspaceKey?.();
    if (active !== undefined) return active;
    const keys = provider.currentWorkspaceKeys?.() ?? [];
    return keys.length === 1 ? keys[0] : undefined;
  }

  private assertWorkspace(expectedWorkspaceKey: string | undefined): void {
    if (expectedWorkspaceKey === undefined) return;
    const provider = this.projectContext as ProjectContextProvider & { currentWorkspaceKeys?: () => readonly string[] };
    const currentKeys = provider.currentWorkspaceKeys?.();
    if (currentKeys === undefined || !currentKeys.includes(expectedWorkspaceKey)) {
      throw new WorkspaceChangedError();
    }
  }

  private isCurrentWorkspace(expectedWorkspaceKey: string | undefined): boolean {
    return this.currentWorkspaceKey() === expectedWorkspaceKey;
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
  if (containsSensitiveContent(value)) {
    throw new Error('Conteúdo potencialmente sensível não pode ser usado na memória local.');
  }
}

function sameSaveScope(entry: LocalKnowledge, options: MemorySaveOptions): boolean {
  if (entry.provenance === undefined && options.provenance === 'MANUAL') return true;
  return memoryProvenance(entry) === options.provenance
    && memoryScope(entry) === options.scope
    && entry.workspaceKey === options.workspaceKey;
}
