import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import { ProjectContext } from './contracts.js';

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
  readonly reuseCount: number;
  readonly updatedAt?: string;
  readonly revision?: number;
  readonly invalidatedAt?: string;
  readonly embedding?: readonly number[];
}

export interface LocalMemoryStore {
  findExact(normalizedPrompt: string, context: ProjectContext | undefined): Promise<LocalKnowledge | undefined>;

  findSimilar(
    embedding: readonly number[],
    context: ProjectContext | undefined,
  ): Promise<readonly LocalMemoryMatch[]>;

  registerReuse(id: string): Promise<LocalKnowledge | undefined>;

  save(
    originalRequest: string,
    normalizedPrompt: string,
    context: ProjectContext | undefined,
    response: string,
    embedding: readonly number[],
  ): Promise<LocalKnowledge>;
  replace?(id: string, response: string, embedding: readonly number[]): Promise<LocalKnowledge | undefined>;
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
  ): Promise<LocalKnowledge | undefined> {
    const contextKey = projectContextKey(context);
    const state = await this.read();
    const entry = state.entries.find((candidate) =>
      candidate.invalidatedAt === undefined
      && candidate.normalizedPrompt === normalizedPrompt
      && candidate.contextKey === contextKey);
    if (entry === undefined) {
      return undefined;
    }
    return this.updateReuse(entry.id);
  }

  public async save(
    originalRequest: string,
    normalizedPrompt: string,
    context: ProjectContext | undefined,
    response: string,
    embedding: readonly number[],
  ): Promise<LocalKnowledge> {
    return this.serialize(async () => {
      const state = await this.read();
      const contextKey = projectContextKey(context);
      const existing = state.entries.find((candidate) =>
        candidate.normalizedPrompt === normalizedPrompt && candidate.contextKey === contextKey);
      if (existing !== undefined) {
        return this.writeUpdatedReuse(state, existing.id);
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
        embedding: validateEmbedding(embedding),
      };
      await this.write(state, [...state.entries, entry]);
      return entry;
    });
  }

  public async findSimilar(
    embedding: readonly number[],
    context: ProjectContext | undefined,
  ): Promise<readonly LocalMemoryMatch[]> {
    const query = validateEmbedding(embedding);
    const state = await this.read();
    const contextKey = projectContextKey(context);
    const matches: LocalMemoryMatch[] = [];
    for (const entry of state.entries) {
      if (entry.invalidatedAt !== undefined || entry.embedding === undefined || entry.embedding.length !== query.length) {
        continue;
      }
      const similarity = cosineSimilarity(query, entry.embedding);
      matches.push({
        knowledge: entry,
        similarity,
        contextCompatible: entry.contextKey === contextKey,
      });
    }
    return matches.sort((left, right) => right.similarity - left.similarity);
  }

  public async registerReuse(id: string): Promise<LocalKnowledge | undefined> {
    return this.updateReuse(id);
  }

  public async replace(id: string, response: string, embedding: readonly number[]): Promise<LocalKnowledge | undefined> {
    return this.serialize(async () => {
      const state = await this.read();
      let replacement: LocalKnowledge | undefined;
      const entries = state.entries.map((entry) => {
        if (entry.id !== id) return entry;
        replacement = { ...entry, response, embedding: validateEmbedding(embedding), updatedAt: this.now().toISOString(), revision: (entry.revision ?? 0) + 1, invalidatedAt: undefined };
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
      if (!state.entries.some((entry) => entry.id === id)) {
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
  return { schemaVersion: SCHEMA_VERSION, revision: candidate.revision as number, entries };
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

function delay(milliseconds: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
