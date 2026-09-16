import { readFile } from 'node:fs/promises';

import { LocalKnowledge } from './localMemoryStore.js';

export interface LegacyMemorySource {
  readonly schemaVersion: number;
  readonly entries: readonly LocalKnowledge[];
}

export interface MigrationTarget {
  upsertMigrated(entry: LocalKnowledge): Promise<void>;
  countByIds(ids: readonly string[]): Promise<number>;
}

export interface MigrationResult {
  readonly status: 'MIGRATED' | 'NOTHING_TO_MIGRATE';
  readonly migrated: number;
  readonly sourceEntries: number;
}

/** Reads the historical JSON once; it never removes or mutates the source file. */
export async function migrateJsonMemory(path: string, target: MigrationTarget): Promise<MigrationResult> {
  let content: string;
  try {
    content = await readFile(path, 'utf8');
  } catch (error) {
    if (isMissingLegacyFile(error)) return { status: 'NOTHING_TO_MIGRATE', migrated: 0, sourceEntries: 0 };
    throw error;
  }
  const source = parseLegacyMemory(content);
  for (const entry of source.entries) await target.upsertMigrated(entry);
  const migrated = await target.countByIds(source.entries.map((entry) => entry.id));
  if (migrated !== source.entries.length) throw new Error('A validação da migração para MongoDB falhou. O JSON original foi preservado.');
  return { status: 'MIGRATED', migrated, sourceEntries: source.entries.length };
}

function isMissingLegacyFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error as { readonly code?: unknown }).code === 'ENOENT';
}

export function parseLegacyMemory(content: string): LegacyMemorySource {
  const candidate = JSON.parse(content) as { schemaVersion?: unknown; entries?: unknown };
  if ((candidate.schemaVersion !== 1 && candidate.schemaVersion !== 2) || !Array.isArray(candidate.entries)) throw new Error('O JSON histórico de memória possui schema incompatível.');
  const schemaVersion = candidate.schemaVersion as 1 | 2;
  const entries = candidate.entries.map((value) => parseEntry(value, schemaVersion));
  return { schemaVersion, entries };
}

function parseEntry(value: unknown, schemaVersion: 1 | 2): LocalKnowledge {
  if (typeof value !== 'object' || value === null) throw new Error('O JSON histórico de memória possui entrada inválida.');
  const entry = value as Record<string, unknown>;
  for (const name of ['id', 'normalizedPrompt', 'contextKey', 'response', 'createdAt', 'lastUsedAt']) if (typeof entry[name] !== 'string') throw new Error('O JSON histórico de memória possui entrada inválida.');
  if (typeof entry.reuseCount !== 'number' || !Number.isSafeInteger(entry.reuseCount)) throw new Error('O JSON histórico de memória possui entrada inválida.');
  if (entry.embedding !== undefined && (!Array.isArray(entry.embedding) || entry.embedding.some((number) => typeof number !== 'number' || !Number.isFinite(number)))) throw new Error('O JSON histórico de memória possui embedding inválido.');
  if (schemaVersion === 2 && typeof entry.originalRequest !== 'string') throw new Error('O JSON histórico de memória possui entrada inválida.');
  return { id: entry.id as string, originalRequest: typeof entry.originalRequest === 'string' ? entry.originalRequest : entry.normalizedPrompt as string, normalizedPrompt: entry.normalizedPrompt as string, contextKey: entry.contextKey as string, response: entry.response as string, createdAt: entry.createdAt as string, lastUsedAt: entry.lastUsedAt as string, reuseCount: entry.reuseCount as number, updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : undefined, revision: typeof entry.revision === 'number' ? entry.revision : undefined, invalidatedAt: typeof entry.invalidatedAt === 'string' ? entry.invalidatedAt : undefined, embedding: entry.embedding as readonly number[] | undefined };
}
