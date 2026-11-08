import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import { ProjectContext } from './contracts.js';
import { containsSensitiveContent } from './sensitiveContent.js';

export type MemoryProvenance = 'AUTO_PROMOTED' | 'MANUAL' | 'LEGACY';
export type MemoryScope = 'WORKSPACE' | 'SHARED' | 'LEGACY_UNSCOPED';

export interface MemoryLookupScope {
  /** Read-only selection options; lookup must never change reuse metrics. */
  readonly workspaceKey?: string;
  readonly includeLegacy?: boolean;
  readonly deduplication?: MemorySaveOptions;
}

export interface MemorySaveOptions {
  readonly provenance: Exclude<MemoryProvenance, 'LEGACY'>;
  readonly scope: Exclude<MemoryScope, 'LEGACY_UNSCOPED'>;
  readonly workspaceKey?: string;
}

const SCHEMA_VERSION = 2;
export const MAX_CORRUPTION_BACKUPS = 5;
const DEFAULT_LOCK_TIMEOUT_MS = 1_000;
const DEFAULT_LOCK_RETRY_DELAY_MS = 10;
const DEFAULT_STALE_LOCK_AGE_MS = 30_000;

export interface FileLocalMemoryStoreOptions {
  readonly lockTimeoutMs?: number;
  readonly lockRetryDelayMs?: number;
  readonly staleLockAgeMs?: number;
}

export interface LocalKnowledge {
  readonly id: string;
  readonly originalRequest: string;
  readonly normalizedPrompt: string;
  readonly contextKey: string;
  readonly response: string;
  readonly createdAt: string;
  readonly lastUsedAt: string;
  /** Count of validated search consumptions only; saves, deduplication and lookups do not increment it. */
  readonly reuseCount: number;
  readonly updatedAt?: string;
  readonly revision?: number;
  readonly invalidatedAt?: string;
  readonly embedding?: readonly number[];
  readonly provenance?: MemoryProvenance;
  readonly scope?: MemoryScope;
  readonly workspaceKey?: string;
  readonly history?: readonly MemoryHistoryEntry[];
}

export interface MemoryHistoryEntry {
  readonly response: string;
  readonly embedding?: readonly number[];
  readonly updatedAt: string;
}

export interface LocalMemoryStore {
  findExact(normalizedPrompt: string, context: ProjectContext | undefined, lookup?: MemoryLookupScope): Promise<LocalKnowledge | undefined>;

  findSimilar(
    embedding: readonly number[],
    context: ProjectContext | undefined,
    lookup?: MemoryLookupScope,
  ): Promise<readonly LocalMemoryMatch[]>;

  registerReuse(id: string): Promise<LocalKnowledge | undefined>;

  save(
    originalRequest: string,
    normalizedPrompt: string,
    context: ProjectContext | undefined,
    response: string,
    embedding: readonly number[],
    options?: MemorySaveOptions,
  ): Promise<LocalKnowledge>;
  replace?(id: string, response: string, embedding?: readonly number[]): Promise<LocalKnowledge | undefined>;
}

export interface LocalMemoryMatch {
  readonly knowledge: LocalKnowledge;
  readonly similarity: number;
  readonly contextCompatible: boolean;
}

interface PersistedMemory {
  readonly schemaVersion: number;
  readonly revision: number;
  readonly entries: readonly LocalKnowledge[];
}

export interface LocalMemoryStatistics {
  readonly total: number;
  readonly active: number;
  readonly invalidated: number;
  readonly schemaVersion: number;
  readonly revision: number;
  readonly approximateBytes: number;
  readonly location: string;
}

export class FileLocalMemoryStore implements LocalMemoryStore {
  private writes: Promise<void> = Promise.resolve();

  public constructor(
    private readonly filePath: string,
    private readonly now: () => Date = () => new Date(),
    private readonly options: FileLocalMemoryStoreOptions = {},
  ) {}

  public async findExact(
    normalizedPrompt: string,
    context: ProjectContext | undefined,
    lookup: MemoryLookupScope = {},
  ): Promise<LocalKnowledge | undefined> {
    const contextKey = projectContextKey(context);
    const state = await this.read();
    const entries = state.entries.filter((candidate) =>
      candidate.invalidatedAt === undefined
      && candidate.normalizedPrompt === normalizedPrompt
      && candidate.contextKey === contextKey
      && isMemoryAccessible(candidate, lookup)
      && isDeduplicationMatch(candidate, lookup));
    const entry = selectPreferredMemory(entries, lookup);
    if (entry === undefined || containsSensitiveMemory(entry)) {
      return undefined;
    }
    // Preserve the historical v1 record while upgrading its on-disk schema;
    // this migration is deliberately independent from reuse accounting.
    if (state.schemaVersion === 1) {
      await this.serialize(async () => {
        const latest = await this.read();
        if (latest.schemaVersion === 1) await this.write(latest, latest.entries);
      });
    }
    // Lookup is observational. Only LocalMemoryService.search registers a
    // reuse after it has selected and validated a result.
    return entry;
  }

  public async save(
    originalRequest: string,
    normalizedPrompt: string,
    context: ProjectContext | undefined,
    response: string,
    embedding: readonly number[],
    options: MemorySaveOptions = { provenance: 'MANUAL', scope: 'SHARED' },
  ): Promise<LocalKnowledge> {
    rejectSensitiveMemory(originalRequest, normalizedPrompt, response);
    const validatedEmbedding = validateEmbedding(embedding);
    return this.serialize(async () => {
      const state = await this.read();
      const contextKey = projectContextKey(context);
      const sensitiveConflict = state.entries.find((candidate) =>
        candidate.normalizedPrompt === normalizedPrompt
        && candidate.contextKey === contextKey
        && containsSensitiveMemory(candidate));
      if (sensitiveConflict !== undefined) {
        throw new Error('Conteúdo potencialmente sensível não pode ser reutilizado na memória local.');
      }
      const existing = state.entries.find((candidate) =>
        candidate.normalizedPrompt === normalizedPrompt && candidate.contextKey === contextKey
        && sameDeduplicationScope(candidate, options));
      if (existing !== undefined) {
        // Saving/deduplicating an existing record is not a reuse event.
        return existing;
      }
      const timestamp = this.now().toISOString();
      const entry: LocalKnowledge = {
        id: randomUUID(),
        originalRequest,
        normalizedPrompt,
        contextKey,
        response,
        createdAt: timestamp,
        lastUsedAt: timestamp,
        reuseCount: 0,
        embedding: validatedEmbedding,
        provenance: options.provenance,
        scope: options.scope,
        workspaceKey: options.workspaceKey,
      };
      await this.write(state, [...state.entries, entry]);
      return entry;
    });
  }

  public async findSimilar(
    embedding: readonly number[],
    context: ProjectContext | undefined,
    lookup: MemoryLookupScope = {},
  ): Promise<readonly LocalMemoryMatch[]> {
    const query = validateEmbedding(embedding);
    const state = await this.read();
    const contextKey = projectContextKey(context);
    const matches: LocalMemoryMatch[] = [];
    for (const entry of state.entries) {
      if (entry.invalidatedAt !== undefined || entry.embedding === undefined || entry.embedding.length !== query.length) {
        continue;
      }
      if (!isMemoryAccessible(entry, lookup) || !isDeduplicationMatch(entry, lookup) || containsSensitiveMemory(entry)) continue;
      const similarity = cosineSimilarity(query, entry.embedding);
      matches.push({
        knowledge: entry,
        similarity,
        contextCompatible: entry.contextKey === contextKey,
      });
    }
    return matches.sort((left, right) => memoryPriority(right.knowledge, lookup) - memoryPriority(left.knowledge, lookup)
      || right.similarity - left.similarity
      || left.knowledge.id.localeCompare(right.knowledge.id));
  }

  public async registerReuse(id: string): Promise<LocalKnowledge | undefined> {
    const state = await this.read();
    const entry = state.entries.find((candidate) => candidate.id === id);
    return entry === undefined || entry.invalidatedAt !== undefined || containsSensitiveMemory(entry) ? undefined : this.updateReuse(id);
  }

  public async replace(id: string, response: string, embedding?: readonly number[]): Promise<LocalKnowledge | undefined> {
    if (containsSensitiveContent(response)) throw new Error('Conteúdo potencialmente sensível não pode ser usado na memória local.');
    return this.serialize(async () => {
      const state = await this.read();
      let replacement: LocalKnowledge | undefined;
      const entries = state.entries.map((entry) => {
        if (entry.id !== id) return entry;
        if (entry.invalidatedAt !== undefined) return entry;
        if (containsSensitiveMemory(entry)) throw new Error('Conteúdo potencialmente sensível não pode ser usado na memória local.');
        const updatedAt = this.now().toISOString();
        replacement = {
          ...entry,
          response,
          ...(embedding === undefined ? {} : { embedding: validateEmbedding(embedding) }),
          updatedAt,
          revision: (entry.revision ?? 1) + 1,
          history: [...(entry.history ?? []), { response: entry.response, embedding: entry.embedding, updatedAt: entry.updatedAt ?? entry.createdAt }],
          invalidatedAt: undefined,
        };
        return replacement;
      });
      if (replacement !== undefined) await this.write(state, entries);
      return replacement;
    });
  }

  public async invalidate(id: string): Promise<boolean> {
    return this.serialize(async () => this.changeEntry(id, (entry) => ({ ...entry, invalidatedAt: this.now().toISOString() })));
  }

  public async delete(id: string): Promise<boolean> {
    return this.serialize(async () => {
      const state = await this.read(); const entries = state.entries.filter((entry) => entry.id !== id);
      if (entries.length === state.entries.length) return false;
      await this.write(state, entries); return true;
    });
  }

  public async clear(): Promise<void> { return this.serialize(async () => { const state = await this.read(); await this.write(state, []); }); }

  public async statistics(): Promise<LocalMemoryStatistics> {
    const state = await this.read(); const invalidated = state.entries.filter((entry) => entry.invalidatedAt !== undefined).length;
    let approximateBytes = 0; try { approximateBytes = (await readFile(this.filePath)).byteLength; } catch (error) { if (!isMissingFile(error)) throw error; }
    return { total: state.entries.length, active: state.entries.length - invalidated, invalidated, schemaVersion: state.schemaVersion, revision: state.revision, approximateBytes, location: this.filePath };
  }

  private async updateReuse(id: string): Promise<LocalKnowledge | undefined> {
    return this.serialize(async () => {
      const state = await this.read();
      if (!state.entries.some((entry) => entry.id === id && entry.invalidatedAt === undefined)) {
        return undefined;
      }
      return this.writeUpdatedReuse(state, id);
    });
  }

  private async writeUpdatedReuse(state: PersistedMemory, id: string): Promise<LocalKnowledge> {
    let updated: LocalKnowledge | undefined;
    const entries = state.entries.map((entry) => {
      if (entry.id !== id) {
        return entry;
      }
      updated = {
        ...entry,
        lastUsedAt: this.now().toISOString(),
        updatedAt: this.now().toISOString(),
        reuseCount: entry.reuseCount + 1,
      };
      return updated;
    });
    if (updated === undefined) {
      throw new Error('Conhecimento local não encontrado para atualização.');
    }
    await this.write(state, entries);
    return updated;
  }

  private async serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.writes.then(() => this.withFileLock(operation), () => this.withFileLock(operation));
    this.writes = next.then(() => undefined, () => undefined);
    return next;
  }

  private async read(): Promise<PersistedMemory> {
    let content: string;
    try {
      content = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if (isMissingFile(error)) {
        return { schemaVersion: SCHEMA_VERSION, revision: 0, entries: [] };
      }
      throw error;
    }
    try {
      return parseMemory(content);
    } catch {
      return this.recoverCorruptedMemory();
    }
  }

  private async write(state: PersistedMemory, entries: readonly LocalKnowledge[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, JSON.stringify({ schemaVersion: SCHEMA_VERSION, revision: state.revision + 1, entries }), { encoding: 'utf8', mode: 0o600 });
    await rename(temporaryPath, this.filePath);
  }

  private async changeEntry(id: string, change: (entry: LocalKnowledge) => LocalKnowledge): Promise<boolean> {
    const state = await this.read(); let changed = false; const entries = state.entries.map((entry) => entry.id === id ? (changed = true, change(entry)) : entry);
    if (changed) await this.write(state, entries); return changed;
  }

  private async withFileLock<T>(operation: () => Promise<T>): Promise<T> {
    const lockPath = `${this.filePath}.lock`;
    const timeoutMs = this.options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
    const retryDelayMs = this.options.lockRetryDelayMs ?? DEFAULT_LOCK_RETRY_DELAY_MS;
    const deadline = Date.now() + timeoutMs;
    while (true) {
      try { await mkdir(dirname(this.filePath), { recursive: true }); const handle = await open(lockPath, 'wx', 0o600);
        try { return await operation(); } finally { await handle.close(); await rm(lockPath, { force: true }); }
      } catch (error) {
        if (!isAlreadyExists(error)) throw error;
        await this.removeStaleLock(lockPath);
        if (Date.now() >= deadline) break;
        await delay(retryDelayMs);
      }
    }
    throw new Error('A memória local está ocupada por outra janela do VS Code.');
  }

  private async removeStaleLock(lockPath: string): Promise<void> {
    try {
      const lock = await stat(lockPath);
      const staleLockAgeMs = this.options.staleLockAgeMs ?? DEFAULT_STALE_LOCK_AGE_MS;
      if (Date.now() - lock.mtimeMs < staleLockAgeMs) {
        return;
      }
      await rm(lockPath);
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
  }

  private async recoverCorruptedMemory(): Promise<PersistedMemory> {
    const backup = this.corruptionBackupPath();
    await rename(this.filePath, backup);
    await this.pruneCorruptionBackups();
    return { schemaVersion: SCHEMA_VERSION, revision: 0, entries: [] };
  }

  private corruptionBackupPath(): string {
    const extension = '.json';
    const fileName = basename(this.filePath);
    const stem = fileName.endsWith(extension) ? fileName.slice(0, -extension.length) : fileName;
    const timestamp = this.now().toISOString().replace(/[-:]/g, '').replace('.', '');
    return join(dirname(this.filePath), `${stem}.corrupt.${timestamp}.${randomUUID()}.json`);
  }

  private async pruneCorruptionBackups(): Promise<void> {
    const backupPattern = this.corruptionBackupPattern();
    const directory = dirname(this.filePath);
    const backups = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && backupPattern.test(entry.name));
    const datedBackups = await Promise.all(backups.map(async (entry) => ({
      path: join(directory, entry.name),
      name: entry.name,
      modifiedAt: (await stat(join(directory, entry.name))).mtimeMs,
    })));
    datedBackups.sort((left, right) => right.modifiedAt - left.modifiedAt || right.name.localeCompare(left.name));
    await Promise.all(datedBackups.slice(MAX_CORRUPTION_BACKUPS).map((backup) => rm(backup.path)));
  }

  private corruptionBackupPattern(): RegExp {
    const extension = '.json';
    const fileName = basename(this.filePath);
    const stem = fileName.endsWith(extension) ? fileName.slice(0, -extension.length) : fileName;
    return new RegExp(`^${escapeRegularExpression(stem)}\\.corrupt\\.\\d{8}T\\d{9}Z\\.[0-9a-f-]+\\.json$`);
  }
}

export function normalizePrompt(prompt: string): string {
  return prompt
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('und');
}

export function projectContextKey(context: ProjectContext | undefined): string {
  if (context === undefined) {
    return 'v1:without-project-context';
  }
  return JSON.stringify({
    buildTool: context.buildTool ?? '',
    frameworks: normalizeTechnologies(context.frameworks),
    languages: normalizeTechnologies(context.languages),
  });
}

export function memoryProvenance(entry: Pick<LocalKnowledge, 'provenance'>): MemoryProvenance {
  return entry.provenance ?? 'LEGACY';
}

export function memoryScope(entry: Pick<LocalKnowledge, 'scope'>): MemoryScope {
  return entry.scope ?? 'LEGACY_UNSCOPED';
}

export function isMemoryAccessible(entry: Pick<LocalKnowledge, 'provenance' | 'scope' | 'workspaceKey'>, lookup: MemoryLookupScope): boolean {
  const provenance = memoryProvenance(entry);
  const scope = memoryScope(entry);
  // Legacy records have no trustworthy workspace origin. They may remain
  // available for an explicitly unscoped lookup, but must never cross a
  // workspace boundary as if they were shared knowledge.
  if (provenance === 'LEGACY') return lookup.includeLegacy !== false && lookup.workspaceKey === undefined;
  if (scope === 'SHARED') return true;
  return scope === 'WORKSPACE' && lookup.workspaceKey !== undefined && entry.workspaceKey === lookup.workspaceKey;
}

export function isDeduplicationMatch(entry: Pick<LocalKnowledge, 'provenance' | 'scope' | 'workspaceKey'>, lookup: MemoryLookupScope): boolean {
  return lookup.deduplication === undefined || sameDeduplicationScope(entry, lookup.deduplication);
}

export function sameDeduplicationScope(entry: Pick<LocalKnowledge, 'provenance' | 'scope' | 'workspaceKey'>, options: MemorySaveOptions): boolean {
  return memoryProvenance(entry) === options.provenance
    && memoryScope(entry) === options.scope
    && entry.workspaceKey === options.workspaceKey;
}

function selectPreferredMemory(entries: readonly LocalKnowledge[], lookup: MemoryLookupScope): LocalKnowledge | undefined {
  return [...entries].sort((left, right) => memoryPriority(right, lookup) - memoryPriority(left, lookup)
    || left.id.localeCompare(right.id))[0];
}

function memoryPriority(entry: Pick<LocalKnowledge, 'provenance' | 'scope' | 'workspaceKey'>, lookup: MemoryLookupScope): number {
  if (lookup.workspaceKey !== undefined && memoryScope(entry) === 'WORKSPACE' && entry.workspaceKey === lookup.workspaceKey) return 2;
  if (memoryScope(entry) === 'SHARED') return 1;
  return 0;
}

function normalizeTechnologies(technologies: readonly { readonly name: string; readonly version?: string }[]): readonly object[] {
  return technologies
    .map((technology) => ({ name: technology.name, version: technology.version ?? '' }))
    .sort((left, right) => `${left.name}:${left.version}`.localeCompare(`${right.name}:${right.version}`));
}

function parseMemory(content: string): PersistedMemory {
  const value: unknown = JSON.parse(content);
  if (typeof value !== 'object' || value === null) {
    throw new Error('O arquivo de memória local possui formato inválido.');
  }
  const candidate = value as Record<string, unknown>;
  if ((candidate.schemaVersion !== 1 && candidate.schemaVersion !== SCHEMA_VERSION)
    || !Array.isArray(candidate.entries)
    || !Number.isSafeInteger(candidate.revision)
    || (candidate.revision as number) < 0) {
    throw new Error('O arquivo de memória local possui schema incompatível.');
  }
  const entries = candidate.entries.map((entry) => parseEntry(entry, candidate.schemaVersion as number));
  return { schemaVersion: candidate.schemaVersion as number, revision: candidate.revision as number, entries };
}

function parseEntry(value: unknown, schemaVersion: number): LocalKnowledge {
  if (typeof value !== 'object' || value === null) {
    throw new Error('O arquivo de memória local possui entrada inválida.');
  }
  const candidate = value as Record<string, unknown>;
  const strings = ['id', 'normalizedPrompt', 'contextKey', 'response', 'createdAt', 'lastUsedAt'];
  for (const field of strings) {
    if (typeof candidate[field] !== 'string') {
      throw new Error('O arquivo de memória local possui entrada inválida.');
    }
  }
  if (schemaVersion === SCHEMA_VERSION && typeof candidate.originalRequest !== 'string') {
    throw new Error('O arquivo de memória local possui entrada inválida.');
  }
  if (typeof candidate.reuseCount !== 'number' || !Number.isSafeInteger(candidate.reuseCount) || candidate.reuseCount < 0) {
    throw new Error('O arquivo de memória local possui entrada inválida.');
  }
  if (candidate.embedding !== undefined) {
    if (!Array.isArray(candidate.embedding)) {
      throw new Error('O arquivo de memória local possui entrada inválida.');
    }
    validateEmbedding(candidate.embedding);
  }
  return {
    ...candidate,
    originalRequest: typeof candidate.originalRequest === 'string'
      ? candidate.originalRequest
      : candidate.normalizedPrompt as string,
  } as LocalKnowledge;
}

function validateEmbedding(embedding: readonly number[]): readonly number[] {
  if (embedding.length === 0 || embedding.some((value) => !Number.isFinite(value))) {
    throw new Error('O embedding da memória local é inválido.');
  }
  return [...embedding];
}

function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  let dotProduct = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dotProduct += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }
  const denominator = Math.sqrt(leftNorm) * Math.sqrt(rightNorm);
  if (!Number.isFinite(denominator) || denominator === 0) {
    throw new Error('O embedding da memória local possui norma inválida.');
  }
  return Math.max(-1, Math.min(1, dotProduct / denominator));
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { readonly code?: unknown }).code === 'ENOENT';
}

function isAlreadyExists(error: unknown): boolean { return typeof error === 'object' && error !== null && 'code' in error && (error as { readonly code?: unknown }).code === 'EEXIST'; }

function escapeRegularExpression(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function containsSensitiveMemory(entry: Pick<LocalKnowledge, 'originalRequest' | 'normalizedPrompt' | 'response'>): boolean {
  return containsSensitiveContent(entry.originalRequest)
    || containsSensitiveContent(entry.normalizedPrompt)
    || containsSensitiveContent(entry.response);
}

function rejectSensitiveMemory(originalRequest: string, normalizedPrompt: string, response: string): void {
  if (containsSensitiveContent(originalRequest) || containsSensitiveContent(normalizedPrompt) || containsSensitiveContent(response)) {
    throw new Error('Conteúdo potencialmente sensível não pode ser usado na memória local.');
  }
}

function delay(milliseconds: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
