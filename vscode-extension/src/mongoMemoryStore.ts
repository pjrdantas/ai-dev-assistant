import { Collection, Document } from 'mongodb';

import { ProjectContext } from './contracts.js';
import { LocalKnowledge, LocalMemoryMatch, LocalMemoryStore, projectContextKey } from './localMemoryStore.js';
import { MongoConnectionManager } from './mongoConnectionManager.js';

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
}

export interface MongoMemoryStatistics {
  readonly total: number;
  readonly active: number;
  readonly invalidated: number;
  readonly schemaVersion: number;
}

/** Active MongoDB store. Cosine similarity deliberately remains local. */
export class MongoMemoryStore implements LocalMemoryStore {
  public constructor(private readonly connection: MongoConnectionManager, private readonly now: () => Date = () => new Date()) {}

  public async findExact(normalizedPrompt: string, context: ProjectContext | undefined): Promise<LocalKnowledge | undefined> {
    const collection = await this.memories();
    const timestamp = this.now();
    const document = await collection.findOneAndUpdate(
      { normalizedPrompt, contextKey: projectContextKey(context), active: true },
      { $inc: { reuseCount: 1 }, $set: { lastUsedAt: timestamp, updatedAt: timestamp } },
      { returnDocument: 'after' },
    );
    return document === null ? undefined : mapDocument(document);
  }

  public async findSimilar(embedding: readonly number[], context: ProjectContext | undefined): Promise<readonly LocalMemoryMatch[]> {
    validateEmbedding(embedding);
    const contextKey = projectContextKey(context);
    const documents = await (await this.memories()).find({ active: true, embedding: { $exists: true } }).toArray();
    return documents
      .filter((document) => document.embedding !== undefined && document.embedding.length === embedding.length)
      .map((document) => ({
        knowledge: mapDocument(document),
        similarity: cosineSimilarity(embedding, document.embedding!),
        contextCompatible: document.contextKey === contextKey,
      }))
      .sort((left, right) => right.similarity - left.similarity);
  }

  public async registerReuse(id: string): Promise<LocalKnowledge | undefined> {
    const timestamp = this.now();
    const document = await (await this.memories()).findOneAndUpdate(
      { _id: id, active: true },
      { $inc: { reuseCount: 1 }, $set: { lastUsedAt: timestamp, updatedAt: timestamp } },
      { returnDocument: 'after' },
    );
    return document === null ? undefined : mapDocument(document);
  }

  public async save(originalRequest: string, normalizedPrompt: string, context: ProjectContext | undefined, response: string, embedding: readonly number[]): Promise<LocalKnowledge> {
    validateEmbedding(embedding);
    const collection = await this.memories();
    const contextKey = projectContextKey(context);
    const timestamp = this.now();
    const document: MemoryDocument = {
      _id: crypto.randomUUID(), schemaVersion: SCHEMA_VERSION, originalRequest, normalizedPrompt,
      contextKey, response, embedding: [...embedding], active: true, createdAt: timestamp,
      updatedAt: timestamp, lastUsedAt: timestamp, reuseCount: 0,
    };
    const result = await collection.findOneAndUpdate(
      { normalizedPrompt, contextKey, active: true },
      { $setOnInsert: document },
      { upsert: true, returnDocument: 'after', includeResultMetadata: true },
    );
    const stored = result.value;
    if (stored === null) throw new Error('A memória MongoDB não foi persistida.');
    if (result.lastErrorObject?.updatedExisting === true) return (await this.registerReuse(stored._id))!;
    return mapDocument(stored);
  }

  public async replace(id: string, response: string, embedding: readonly number[]): Promise<LocalKnowledge | undefined> {
    validateEmbedding(embedding);
    const timestamp = this.now();
    const document = await (await this.memories()).findOneAndUpdate(
      { _id: id },
      { $set: { response, embedding: [...embedding], active: true, updatedAt: timestamp }, $inc: { revision: 1 }, $unset: { invalidatedAt: '' } },
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
      const duplicate = await collection.findOne({
        _id: { $ne: document._id },
        normalizedPrompt: document.normalizedPrompt,
        contextKey: document.contextKey,
        active: true,
      });

      if (duplicate) {
        continue;
      }

      const result = await collection.updateOne(
        {
          _id: document._id,
          active: false,
        },
        {
          $set: {
            active: true,
            updatedAt: this.now(),
          },
          $unset: {
            invalidatedAt: '',
          },
        },
      );

      reactivated += result.modifiedCount;
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
      const duplicate = await collection.findOne({
        _id: { $ne: document._id },
        normalizedPrompt: document.normalizedPrompt,
        contextKey: document.contextKey,
        active: true,
      });

      if (duplicate) {
        continue;
      }

      const result = await collection.updateOne(
        {
          _id: document._id,
          active: false,
        },
        {
          $set: {
            active: true,
            updatedAt: this.now(),
          },
          $unset: {
            invalidatedAt: '',
          },
        },
      );

      reactivated += result.modifiedCount;
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

    const duplicate = await collection.findOne({
      _id: { $ne: document._id },
      normalizedPrompt: document.normalizedPrompt,
      contextKey: document.contextKey,
      active: true,
    });

    if (duplicate) {
      return false;
    }

    const result = await collection.updateOne(
      {
        _id: document._id,
        active: false,
      },
      {
        $set: {
          active: true,
          updatedAt: this.now(),
        },
        $unset: {
          invalidatedAt: '',
        },
      },
    );

    return result.modifiedCount === 1;
  }

  public async listInactive(): Promise<readonly LocalKnowledge[]> {
    const documents = await (await this.memories())
      .find({ active: false })
      .toArray();

    return documents.map(mapDocument);
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
    const document = toMigrationDocument(entry);
    await (await this.memories()).updateOne({ _id: document._id }, { $setOnInsert: document }, { upsert: true });
  }

  public async countByIds(ids: readonly string[]): Promise<number> { return ids.length === 0 ? 0 : (await (await this.memories()).countDocuments({ _id: { $in: [...ids] } })); }

  private async memories(): Promise<Collection<MemoryDocument>> {
    await this.connection.ensureIndexes();
    return (await this.connection.database()).collection<MemoryDocument>('memories');
  }
}

function mapDocument(document: MemoryDocument): LocalKnowledge {
  return { id: document._id, originalRequest: document.originalRequest, normalizedPrompt: document.normalizedPrompt, contextKey: document.contextKey, response: document.response, createdAt: document.createdAt.toISOString(), updatedAt: document.updatedAt?.toISOString(), lastUsedAt: document.lastUsedAt.toISOString(), reuseCount: document.reuseCount, revision: document.revision, invalidatedAt: document.invalidatedAt?.toISOString(), embedding: document.embedding };
}

function toMigrationDocument(entry: LocalKnowledge): MemoryDocument {
  return { _id: entry.id, schemaVersion: SCHEMA_VERSION, originalRequest: entry.originalRequest, normalizedPrompt: entry.normalizedPrompt, contextKey: entry.contextKey, response: entry.response, embedding: entry.embedding, active: entry.invalidatedAt === undefined, createdAt: new Date(entry.createdAt), updatedAt: new Date(entry.updatedAt ?? entry.createdAt), lastUsedAt: new Date(entry.lastUsedAt), reuseCount: entry.reuseCount, revision: entry.revision, invalidatedAt: entry.invalidatedAt === undefined ? undefined : new Date(entry.invalidatedAt) };
}

function validateEmbedding(embedding: readonly number[]): void { if (embedding.length === 0 || embedding.some((value) => !Number.isFinite(value))) throw new Error('O embedding da memória local é inválido.'); }
function cosineSimilarity(left: readonly number[], right: readonly number[]): number { let dot = 0; let leftNorm = 0; let rightNorm = 0; for (let index = 0; index < left.length; index += 1) { dot += left[index]! * right[index]!; leftNorm += left[index]! ** 2; rightNorm += right[index]! ** 2; } const denominator = Math.sqrt(leftNorm) * Math.sqrt(rightNorm); if (denominator === 0) throw new Error('O embedding da memória local possui norma inválida.'); return Math.max(-1, Math.min(1, dot / denominator)); }
