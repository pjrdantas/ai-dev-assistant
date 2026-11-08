import { Collection, Document } from 'mongodb';

import { ProjectContext } from './contracts.js';
import { LocalKnowledge, LocalMemoryMatch, LocalMemoryStore, MemoryHistoryEntry, MemoryLookupScope, MemorySaveOptions, isDeduplicationMatch, memoryProvenance, memoryScope, projectContextKey } from './localMemoryStore.js';
import { MongoConnectionManager } from './mongoConnectionManager.js';
import { containsSensitiveContent } from './sensitiveContent.js';

const SCHEMA_VERSION = 2;

interface MemoryDocument extends Document {
  readonly _id: string;
  readonly schemaVersion: number;
  readonly originalRequest: string;
  readonly normalizedPrompt: string;
  readonly contextKey: string;
  readonly response: string;
  readonly embedding?: readonly number[];
  readonly active: boolean;
  readonly createdAt: Date;
  readonly updatedAt?: Date;
  readonly lastUsedAt: Date;
  readonly reuseCount: number;
  readonly revision?: number;
  readonly invalidatedAt?: Date;
  readonly provenance?: 'AUTO_PROMOTED' | 'MANUAL' | 'LEGACY';
  readonly scope?: 'WORKSPACE' | 'SHARED' | 'LEGACY_UNSCOPED';
  readonly workspaceKey?: string;
  readonly history?: MongoMemoryHistoryEntry[];
}

interface MongoMemoryHistoryEntry {
  readonly response: string;
  readonly embedding?: readonly number[];
  readonly updatedAt: Date;
}

export interface MongoMemoryStatistics {
  readonly total: number;
  readonly active: number;
  readonly invalidated: number;
  readonly schemaVersion: number;
}

export interface StoredMemoryEntry {
  readonly knowledge: LocalKnowledge;
  readonly active: boolean;
}

/** Active MongoDB store. Cosine similarity deliberately remains local. */
export class MongoMemoryStore implements LocalMemoryStore {
  public constructor(private readonly connection: MongoConnectionManager, private readonly now: () => Date = () => new Date()) {}

  public async findExact(normalizedPrompt: string, context: ProjectContext | undefined, lookup: MemoryLookupScope = {}): Promise<LocalKnowledge | undefined> {
    const collection = await this.memories();
    const contextKey = projectContextKey(context);
    for (const query of exactQueries(normalizedPrompt, contextKey, lookup)) {
      const document = await collection.findOne(
        { ...query, active: true },
      );
      if (document !== null) {
        const knowledge = mapDocument(document);
        if (!containsSensitiveMemory(knowledge)) return knowledge;
      }
    }
    return undefined;
  }

  public async findSimilar(embedding: readonly number[], context: ProjectContext | undefined, lookup: MemoryLookupScope = {}): Promise<readonly LocalMemoryMatch[]> {
    validateEmbedding(embedding);
    const contextKey = projectContextKey(context);
    const matches: LocalMemoryMatch[] = [];
    const cursor = (await this.memories())
      .find(similarQuery(lookup))
      .project({ _id: 1, originalRequest: 1, normalizedPrompt: 1, contextKey: 1, response: 1, embedding: 1, createdAt: 1, updatedAt: 1, lastUsedAt: 1, reuseCount: 1, revision: 1, invalidatedAt: 1, provenance: 1, scope: 1, workspaceKey: 1 })
      .batchSize(256);
    for await (const document of cursor as AsyncIterable<MemoryDocument>) {
      if (document.embedding === undefined || document.embedding.length !== embedding.length) continue;
      const knowledge = mapDocument(document);
      if (!isDeduplicationMatch(knowledge, lookup) || containsSensitiveMemory(knowledge)) continue;
      matches.push({ knowledge, similarity: cosineSimilarity(embedding, document.embedding), contextCompatible: document.contextKey === contextKey });
      matches.sort(compareMatches(lookup));
      if (matches.length > MAX_SEMANTIC_RESULTS) matches.pop();
    }
    return matches;
  }

  public async registerReuse(id: string): Promise<LocalKnowledge | undefined> {
    const timestamp = this.now();
    const document = await (await this.memories()).findOneAndUpdate(
      { _id: id, active: true },
      { $inc: { reuseCount: 1 }, $set: { lastUsedAt: timestamp, updatedAt: timestamp } },
      { returnDocument: 'after' },
    );
    if (document === null) return undefined;
    const knowledge = mapDocument(document);
    return containsSensitiveMemory(knowledge) ? undefined : knowledge;
  }

  public async save(originalRequest: string, normalizedPrompt: string, context: ProjectContext | undefined, response: string, embedding: readonly number[], options: MemorySaveOptions = { provenance: 'MANUAL', scope: 'SHARED' }): Promise<LocalKnowledge> {
    rejectSensitiveMemory(originalRequest, normalizedPrompt, response);
    validateEmbedding(embedding);
    const collection = await this.memories();
    const contextKey = projectContextKey(context);
    const timestamp = this.now();
    const document: MemoryDocument = {
      _id: crypto.randomUUID(), schemaVersion: SCHEMA_VERSION, originalRequest, normalizedPrompt,
      contextKey, response, embedding: [...embedding], active: true, createdAt: timestamp,
      updatedAt: timestamp, lastUsedAt: timestamp, reuseCount: 0,
      provenance: options.provenance, scope: options.scope, ...(options.workspaceKey === undefined ? {} : { workspaceKey: options.workspaceKey }),
    };
    let result;
    try {
      result = await collection.findOneAndUpdate(
        { normalizedPrompt, contextKey, active: true, provenance: options.provenance, scope: options.scope, ...(options.workspaceKey === undefined ? {} : { workspaceKey: options.workspaceKey }) },
        { $setOnInsert: document },
        { upsert: true, returnDocument: 'after', includeResultMetadata: true },
      );
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      const raced = await collection.findOne({ normalizedPrompt, contextKey, active: true, provenance: options.provenance, scope: options.scope, ...(options.workspaceKey === undefined ? {} : { workspaceKey: options.workspaceKey }) });
      if (raced === null) throw error;
      return mapDocument(raced);
    }
    const stored = result.value;
    if (stored === null) throw new Error('A memória MongoDB não foi persistida.');
    if (result.lastErrorObject?.updatedExisting === true) return mapDocument(stored);
    return mapDocument(stored);
  }

  public async replace(id: string, response: string, embedding?: readonly number[]): Promise<LocalKnowledge | undefined> {
    if (containsSensitiveContent(response)) throw new Error('Conteúdo potencialmente sensível não pode ser usado na memória local.');
    const timestamp = this.now();
    const current = await (await this.memories()).findOne({ _id: id, active: true });
    if (current === null) return undefined;
    if (embedding !== undefined) validateEmbedding(embedding);
    const nextRevision = (current.revision ?? 1) + 1;
    const document = await (await this.memories()).findOneAndUpdate(
      { _id: id, active: true, revision: current.revision },
      {
        $set: { response, ...(embedding === undefined ? {} : { embedding: [...embedding] }), updatedAt: timestamp, revision: nextRevision },
        $push: { history: { response: current.response, ...(current.embedding === undefined ? {} : { embedding: [...current.embedding] }), updatedAt: (current.updatedAt ?? current.createdAt) } } as Document,
      },
      { returnDocument: 'after' },
    );
    return document === null ? undefined : mapDocument(document);
  }

  public async invalidate(id: string): Promise<boolean> {
    const result = await (await this.memories()).updateOne({ _id: id, active: true }, { $set: { active: false, invalidatedAt: this.now(), updatedAt: this.now() } });
    return result.modifiedCount === 1;
  }

  public async delete(id: string): Promise<boolean> { return (await (await this.memories()).deleteOne({ _id: id })).deletedCount === 1; }

  public async deactivateAll(): Promise<number> {
    const timestamp = this.now();
    const result = await (await this.memories()).updateMany(
      { active: true },
      {
        $set: {
          active: false,
          invalidatedAt: timestamp,
          updatedAt: timestamp,
        },
      },
    );

    return result.modifiedCount;
  }

  public async reactivateAllInvalidated(): Promise<number> {
    const collection = await this.memories();
    const documents = await collection
      .find({
        active: false,
        invalidatedAt: { $exists: true },
      })
      .toArray();

    let reactivated = 0;

    for (const document of documents) {
      const duplicate = await collection.findOne({ _id: { $ne: document._id }, active: true, ...deduplicationQuery(document) });

      if (duplicate) {
        continue;
      }

      if (await this.reactivateDocument(collection, document, true)) reactivated += 1;
    }

    return reactivated;
  }

  public async reactivateAll(): Promise<number> {
    const collection = await this.memories();
    const documents = await collection
      .find({ active: false })
      .toArray();

    let reactivated = 0;

    for (const document of documents) {
      const duplicate = await collection.findOne({ _id: { $ne: document._id }, active: true, ...deduplicationQuery(document) });

      if (duplicate) {
        continue;
      }

      if (await this.reactivateDocument(collection, document, false)) reactivated += 1;
    }

    return reactivated;
  }

  public async reactivate(id: string): Promise<boolean> {
    const collection = await this.memories();

    const document = await collection.findOne({
      _id: id,
      active: false,
    });

    if (!document) {
      return false;
    }

    const duplicate = await collection.findOne({ _id: { $ne: document._id }, active: true, ...deduplicationQuery(document) });

    if (duplicate) {
      return false;
    }

    return this.reactivateDocument(collection, document, false);
  }

  public async listInactive(): Promise<readonly LocalKnowledge[]> {
    const documents = await (await this.memories())
      .find({ active: false })
      .toArray();

    return documents.map(mapDocument);
  }

  public async listAll(): Promise<readonly StoredMemoryEntry[]> {
    const documents = await (await this.memories())
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    return documents.map((document) => ({
      knowledge: mapDocument(document),
      active: document.active,
    }));
  }

  public async clear(): Promise<void> {
    await this.deactivateAll();
  }

  public async statistics(): Promise<MongoMemoryStatistics> {
    const collection = await this.memories();
    const [total, active] = await Promise.all([collection.countDocuments(), collection.countDocuments({ active: true })]);
    return { total, active, invalidated: total - active, schemaVersion: SCHEMA_VERSION };
  }

  public async upsertMigrated(entry: LocalKnowledge): Promise<void> {
    rejectSensitiveMemory(entry.originalRequest, entry.normalizedPrompt, entry.response);
    const document = toMigrationDocument(entry);
    await (await this.memories()).updateOne({ _id: document._id }, { $setOnInsert: document }, { upsert: true });
  }

  public async countByIds(ids: readonly string[]): Promise<number> { return ids.length === 0 ? 0 : (await (await this.memories()).countDocuments({ _id: { $in: [...ids] } })); }

  private async memories(): Promise<Collection<MemoryDocument>> {
    await this.connection.ensureIndexes();
    return (await this.connection.database()).collection<MemoryDocument>('memories');
  }

  private async reactivateDocument(collection: Collection<MemoryDocument>, document: MemoryDocument, requireInvalidatedAt: boolean): Promise<boolean> {
    if (containsSensitiveMemory(mapDocument(document))) return false;
    try {
      const result = await collection.updateOne(
        {
          _id: document._id,
          active: false,
          normalizedPrompt: document.normalizedPrompt,
          contextKey: document.contextKey,
          ...(document.provenance === undefined ? { provenance: { $exists: false } } : { provenance: document.provenance }),
          ...(document.scope === undefined ? { scope: { $exists: false } } : { scope: document.scope }),
          ...(document.workspaceKey === undefined ? {} : { workspaceKey: document.workspaceKey }),
          ...(requireInvalidatedAt ? { invalidatedAt: { $exists: true } } : {}),
        },
        { $set: { active: true, updatedAt: this.now() }, $unset: { invalidatedAt: '' } },
      );
      return result.modifiedCount === 1;
    } catch (error) {
      // The unique active identity index arbitrates a concurrent reactivation/save.
      // Losing that race means this memory must remain inactive; other Mongo errors stay visible.
      if (isDuplicateKey(error)) return false;
      throw error;
    }
  }
}

function rejectSensitiveMemory(originalRequest: string, normalizedPrompt: string, response: string): void {
  if (containsSensitiveContent(originalRequest) || containsSensitiveContent(normalizedPrompt) || containsSensitiveContent(response)) {
    throw new Error('Conteúdo potencialmente sensível não pode ser usado na memória local.');
  }
}

function containsSensitiveMemory(entry: Pick<LocalKnowledge, 'originalRequest' | 'normalizedPrompt' | 'response'>): boolean {
  return containsSensitiveContent(entry.originalRequest)
    || containsSensitiveContent(entry.normalizedPrompt)
    || containsSensitiveContent(entry.response);
}

function mapDocument(document: MemoryDocument): LocalKnowledge {
  return { id: document._id, originalRequest: document.originalRequest, normalizedPrompt: document.normalizedPrompt, contextKey: document.contextKey, response: document.response, createdAt: document.createdAt.toISOString(), updatedAt: document.updatedAt?.toISOString(), lastUsedAt: document.lastUsedAt.toISOString(), reuseCount: document.reuseCount, revision: document.revision, invalidatedAt: document.invalidatedAt?.toISOString(), embedding: document.embedding, history: document.history?.map((entry) => ({ response: entry.response, embedding: entry.embedding, updatedAt: entry.updatedAt.toISOString() })), provenance: document.provenance ?? 'LEGACY', scope: document.scope ?? 'LEGACY_UNSCOPED', workspaceKey: document.workspaceKey ?? undefined };
}

function toMigrationDocument(entry: LocalKnowledge): MemoryDocument {
  return { _id: entry.id, schemaVersion: SCHEMA_VERSION, originalRequest: entry.originalRequest, normalizedPrompt: entry.normalizedPrompt, contextKey: entry.contextKey, response: entry.response, embedding: entry.embedding, history: entry.history?.map((item) => ({ response: item.response, embedding: item.embedding, updatedAt: new Date(item.updatedAt) })), active: entry.invalidatedAt === undefined, createdAt: new Date(entry.createdAt), updatedAt: new Date(entry.updatedAt ?? entry.createdAt), lastUsedAt: new Date(entry.lastUsedAt), reuseCount: entry.reuseCount, revision: entry.revision, invalidatedAt: entry.invalidatedAt === undefined ? undefined : new Date(entry.invalidatedAt), provenance: memoryProvenance(entry), scope: memoryScope(entry), workspaceKey: entry.workspaceKey };
}

function accessibleQuery(lookup: MemoryLookupScope): Record<string, unknown> {
  return { $or: [
    ...(lookup.includeLegacy === false || lookup.workspaceKey !== undefined ? [] : [{ provenance: { $exists: false } }, { provenance: 'LEGACY' }]),
    { scope: 'SHARED' },
    ...(lookup.workspaceKey === undefined ? [] : [{ scope: 'WORKSPACE', workspaceKey: lookup.workspaceKey }]),
  ] };
}

function similarQuery(lookup: MemoryLookupScope): Record<string, unknown> {
  const predicates: Record<string, unknown>[] = [accessibleQuery(lookup)];
  if (lookup.deduplication !== undefined) predicates.push(deduplicationMongoQuery(lookup.deduplication));
  return { active: true, embedding: { $exists: true }, $and: predicates };
}

function deduplicationMongoQuery(options: MemorySaveOptions): Record<string, unknown> {
  return {
    provenance: options.provenance,
    scope: options.scope,
    ...(options.workspaceKey === undefined
      ? { $or: [{ workspaceKey: { $exists: false } }, { workspaceKey: null }] }
      : { workspaceKey: options.workspaceKey }),
  };
}

function exactQueries(normalizedPrompt: string, contextKey: string, lookup: MemoryLookupScope): readonly Record<string, unknown>[] {
  if (lookup.deduplication !== undefined) {
    return [{ normalizedPrompt, contextKey, ...deduplicationIdentityQuery(lookup.deduplication) }];
  }
  const queries: Record<string, unknown>[] = [];
  if (lookup.workspaceKey !== undefined) queries.push({ normalizedPrompt, contextKey, scope: 'WORKSPACE', workspaceKey: lookup.workspaceKey });
  queries.push({ normalizedPrompt, contextKey, scope: 'SHARED' });
  if (lookup.includeLegacy !== false && lookup.workspaceKey === undefined) {
    queries.push({ normalizedPrompt, contextKey, provenance: { $exists: false } });
    queries.push({ normalizedPrompt, contextKey, provenance: 'LEGACY' });
  }
  return queries;
}

function deduplicationQuery(document: MemoryDocument): Record<string, unknown> {
  return {
    normalizedPrompt: document.normalizedPrompt,
    contextKey: document.contextKey,
    ...(document.provenance === undefined ? { provenance: { $exists: false } } : { provenance: document.provenance }),
    ...(document.scope === undefined ? { scope: { $exists: false } } : { scope: document.scope }),
    ...(document.workspaceKey === undefined ? {} : { workspaceKey: document.workspaceKey }),
  };
}

function deduplicationIdentityQuery(options: MemorySaveOptions): Record<string, unknown> {
  return { provenance: options.provenance, scope: options.scope, ...(options.workspaceKey === undefined ? {} : { workspaceKey: options.workspaceKey }) };
}

function memoryPriority(entry: Pick<LocalKnowledge, 'scope' | 'workspaceKey'>, lookup: MemoryLookupScope): number {
  return lookup.workspaceKey !== undefined && memoryScope(entry) === 'WORKSPACE' && entry.workspaceKey === lookup.workspaceKey ? 2 : memoryScope(entry) === 'SHARED' ? 1 : 0;
}

const MAX_SEMANTIC_RESULTS = 100;

function compareMatches(lookup: MemoryLookupScope): (left: LocalMemoryMatch, right: LocalMemoryMatch) => number {
  return (left, right) => memoryPriority(right.knowledge, lookup) - memoryPriority(left.knowledge, lookup)
    || right.similarity - left.similarity
    || left.knowledge.id.localeCompare(right.knowledge.id);
}

function validateEmbedding(embedding: readonly number[]): void { if (embedding.length === 0 || embedding.some((value) => !Number.isFinite(value))) throw new Error('O embedding da memória local é inválido.'); }
function cosineSimilarity(left: readonly number[], right: readonly number[]): number { let dot = 0; let leftNorm = 0; let rightNorm = 0; for (let index = 0; index < left.length; index += 1) { dot += left[index]! * right[index]!; leftNorm += left[index]! ** 2; rightNorm += right[index]! ** 2; } const denominator = Math.sqrt(leftNorm) * Math.sqrt(rightNorm); if (denominator === 0) throw new Error('O embedding da memória local possui norma inválida.'); return Math.max(-1, Math.min(1, dot / denominator)); }

function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { readonly code?: unknown }).code === 11000;
}
