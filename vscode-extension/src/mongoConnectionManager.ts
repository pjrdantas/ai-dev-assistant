import { createHash } from 'node:crypto';
import { EJSON } from 'bson';
import { Db, MongoClient, MongoClientOptions, type Collection, type Document, type IndexDescription } from 'mongodb';

export interface MongoConnectionConfiguration {
  readonly uri: string;
  readonly database: string;
}

export interface MongoConnectionStatus {
  readonly connected: boolean;
  readonly uri: string;
  readonly database: string;
  readonly reason?: string;
}

export type MongoConnectionDiagnosticLogger = (line: string) => void;

export const CURRENT_MEMORY_EXACT_INDEX = 'memories_active_exact_unique_v2';
export const LEGACY_MEMORY_EXACT_INDEX = 'memories_active_exact_unique';

export interface MongoLegacyIndexMigrationReport {
  readonly status: 'MIGRATED' | 'ALREADY_MIGRATED';
  readonly documentCount: number;
  readonly backupCollection: string;
  readonly backupSha256: string;
}

export class MongoMemoryUnavailableError extends Error {
  public constructor(cause: unknown) {
    super('MongoDB local indisponível. A memória local não foi consultada nem gravada.');
    this.name = 'MongoMemoryUnavailableError';
    this.cause = cause;
  }
}

export class MongoSchemaMigrationRequiredError extends Error {
  public constructor() {
    super('O banco de memórias possui o índice legado. Execute a migração planejada antes de ativar o novo contrato de proveniência.');
    this.name = 'MongoSchemaMigrationRequiredError';
  }
}

export class MongoConnectionManager {
  private client: MongoClient | undefined;
  private connecting: Promise<Db> | undefined;
  private indexes: Promise<void> | undefined;
  private lifecycle: Promise<void> = Promise.resolve();

  public constructor(
    private configuration: MongoConnectionConfiguration,
    private readonly clientFactory: (uri: string, options: MongoClientOptions) => MongoClient = (uri, options) => new MongoClient(uri, options),
    private readonly diagnosticLogger: MongoConnectionDiagnosticLogger = () => undefined,
  ) {}

  public async database(): Promise<Db> {
    await this.lifecycle;
    if (this.connecting === undefined) {
      this.diagnosticLogger(`MongoDB connection attempt: uri=${redactUri(this.configuration.uri)}, database=${this.configuration.database}`);
      this.connecting = this.connect();
    }
    const connecting = this.connecting;
    try {
      const database = await connecting;
      this.diagnosticLogger(`MongoDB connection success: uri=${redactUri(this.configuration.uri)}, database=${this.configuration.database}`);
      return database;
    } catch (error) {
      if (this.connecting === connecting) this.connecting = undefined;
      this.diagnosticLogger(`MongoDB connection failure: uri=${redactUri(this.configuration.uri)}, database=${this.configuration.database}, ${describeError(error)}`);
      throw new MongoMemoryUnavailableError(error);
    }
  }

  public async ensureIndexes(): Promise<void> {
    if (this.indexes === undefined) {
      this.indexes = this.createIndexes();
    }
    try {
      await this.indexes;
    } catch (error) {
      this.indexes = undefined;
      throw error;
    }
  }

  public async status(): Promise<MongoConnectionStatus> {
    try {
      await this.database();
      await this.ensureIndexes();
      return { connected: true, uri: redactUri(this.configuration.uri), database: this.configuration.database };
    } catch (error) {
      this.diagnosticLogger(`MongoDB status failure: uri=${redactUri(this.configuration.uri)}, database=${this.configuration.database}, ${describeError(error)}`);
      return { connected: false, uri: redactUri(this.configuration.uri), database: this.configuration.database, reason: error instanceof Error ? error.message : 'erro desconhecido' };
    }
  }

  public async close(): Promise<void> {
    await this.enqueueLifecycle(() => this.closeNow());
  }

  public async updateConfiguration(configuration: MongoConnectionConfiguration): Promise<void> {
    await this.enqueueLifecycle(async () => {
      await this.closeNow();
      this.configuration = configuration;
    });
  }

  public currentConfiguration(): MongoConnectionConfiguration { return this.configuration; }

  public async migrateLegacyIndexes(): Promise<MongoLegacyIndexMigrationReport> {
    const db = await this.database();
    const memories = db.collection('memories');
    const indexes = await listIndexes(memories);
    const legacy = indexes.find((index) => index.name === LEGACY_MEMORY_EXACT_INDEX);
    const current = indexes.find((index) => index.name === CURRENT_MEMORY_EXACT_INDEX);

    if (legacy !== undefined && !isLegacyExactIndex(legacy) && !isCurrentExactIndex(legacy)) {
      throw new Error(`O índice ${LEGACY_MEMORY_EXACT_INDEX} existe, mas sua definição não corresponde ao legado ou ao contrato atual conhecido; migração interrompida por segurança.`);
    }
    if (current !== undefined && !isCurrentExactIndex(current)) {
      throw new Error(`O índice ${CURRENT_MEMORY_EXACT_INDEX} existe com definição inesperada; migração interrompida por segurança.`);
    }

    if (legacy === undefined && current !== undefined) {
      return { status: 'ALREADY_MIGRATED', documentCount: await memories.countDocuments(), backupCollection: 'não necessário', backupSha256: await digestDocuments(memories) };
    }

    const backup = await ensureMemoriesBackup(db, legacy);
    if (legacy !== undefined) {
      const duplicates = await findCurrentIdentityConflicts(memories);
      if (duplicates.length > 0) {
        throw new Error(`A migração foi interrompida: ${duplicates.length} conflito(s) de unicidade no contrato atual (${duplicates.slice(0, 3).join('; ')}).`);
      }
      await memories.createIndex(
        { normalizedPrompt: 1, contextKey: 1, provenance: 1, scope: 1, workspaceKey: 1 },
        { name: CURRENT_MEMORY_EXACT_INDEX, unique: true, partialFilterExpression: currentMemoryExactPartialFilter() },
      );
      const afterCreate = await listIndexes(memories);
      const created = afterCreate.find((index) => index.name === CURRENT_MEMORY_EXACT_INDEX);
      if (created === undefined || !isCurrentExactIndex(created)) {
        throw new Error('O novo índice único não pôde ser validado após a criação; o índice legado não foi removido.');
      }
      await memories.dropIndex(LEGACY_MEMORY_EXACT_INDEX);
      const afterDrop = await listIndexes(memories);
      if (afterDrop.some((index) => index.name === LEGACY_MEMORY_EXACT_INDEX)) {
        throw new Error('O índice legado ainda existe após a tentativa de remoção; a migração requer verificação manual.');
      }
      return { status: 'MIGRATED', documentCount: backup.documentCount, backupCollection: backup.collection, backupSha256: backup.sha256 };
    }

    if (current === undefined) {
      await memories.createIndex(
        { normalizedPrompt: 1, contextKey: 1, provenance: 1, scope: 1, workspaceKey: 1 },
        { name: CURRENT_MEMORY_EXACT_INDEX, unique: true, partialFilterExpression: currentMemoryExactPartialFilter() },
      );
    }
    return { status: 'ALREADY_MIGRATED', documentCount: backup.documentCount, backupCollection: backup.collection, backupSha256: backup.sha256 };
  }

  private async connect(): Promise<Db> {
    const client = this.client ??= this.clientFactory(this.configuration.uri, {
      serverSelectionTimeoutMS: 1_500,
      connectTimeoutMS: 1_500,
      appName: 'AI Dev Assistant',
    });
    try {
      await client.connect();
      return client.db(this.configuration.database);
    } catch (error) {
      // A failed/closed client must never be reused by a later database() call.
      if (this.client === client) this.client = undefined;
      throw error;
    }
  }

  private async closeNow(): Promise<void> {
    const connecting = this.connecting;
    if (connecting !== undefined) {
      await connecting.catch(() => undefined);
    }
    const indexes = this.indexes;
    if (indexes !== undefined) {
      await indexes.catch(() => undefined);
    }
    const client = this.client;
    this.client = undefined;
    this.connecting = undefined;
    this.indexes = undefined;
    await client?.close();
  }

  private enqueueLifecycle(operation: () => Promise<void>): Promise<void> {
    const current = this.lifecycle.then(operation);
    this.lifecycle = current.catch(() => undefined);
    return current;
  }

  private async createIndexes(): Promise<void> {
    const db = await this.database();
    let existing;
    try {
      const memories = db.collection('memories');
      if (typeof memories.listIndexes !== 'function') {
        existing = [];
      } else {
        existing = await memories.listIndexes().toArray();
      }
    } catch (error) {
      if (!isMissingNamespace(error)) throw error;
      existing = [];
    }
    const legacyExact = existing.find((index) => index.name === LEGACY_MEMORY_EXACT_INDEX);
    if (legacyExact !== undefined) {
      if (isCurrentExactIndex(legacyExact)) {
        // A versão defeituosa podia createIndexes() com o nome legado depois de uma execução parcial.
        // O comando explícito ainda renomeia esse índice após backup; a proteção permanece ativa.
      } else if (!isLegacyExactIndex(legacyExact)) {
        throw new Error(`O índice ${LEGACY_MEMORY_EXACT_INDEX} possui uma definição inesperada.`);
      } else {
        throw new MongoSchemaMigrationRequiredError();
      }
    }
    await Promise.all([
      db.collection('memories').createIndexes([
        { key: { contextKey: 1 }, name: 'memories_contextKey' },
        { key: { active: 1 }, name: 'memories_active' },
        { key: { normalizedPrompt: 1 }, name: 'memories_normalizedPrompt' },
        { key: { updatedAt: -1 }, name: 'memories_updatedAt' },
        { key: { contextKey: 1, active: 1 }, name: 'memories_contextKey_active' },
        { key: { active: 1, scope: 1, workspaceKey: 1, provenance: 1, contextKey: 1 }, name: 'memories_semantic_scope' },
        { key: { normalizedPrompt: 1, contextKey: 1, provenance: 1, scope: 1, workspaceKey: 1 }, name: CURRENT_MEMORY_EXACT_INDEX, unique: true, partialFilterExpression: currentMemoryExactPartialFilter() },
      ]),
      db.collection('interactions').createIndexes([
        { key: { sessionId: 1, createdAt: -1 }, name: 'interactions_sessionId_createdAt' },
        { key: { workspaceKey: 1, createdAt: -1 }, name: 'interactions_workspaceKey_createdAt' },
        { key: { status: 1 }, name: 'interactions_status' },
        { key: { status: 1, promotionStatus: 1, promotionLeaseUntil: 1, completedAt: 1 }, name: 'interactions_promotion_lease' },
        { key: { interactionId: 1, promotionStatus: 1, promotionOwner: 1 }, name: 'interactions_promotion_owner' },
        { key: { interactionId: 1 }, name: 'interactions_interactionId_unique', unique: true },
      ]),
    ]);
  }
}

const BACKUP_COLLECTION = 'memories_legacy_index_backup_v1';
const BACKUP_METADATA_COLLECTION = 'memories_legacy_index_backup_meta_v1';
const BACKUP_METADATA_ID = 'memories_active_exact_unique';

function currentMemoryExactPartialFilter(): Document {
  return { active: true, provenance: { $exists: true }, scope: { $exists: true } };
}

function isLegacyExactIndex(index: IndexDescription): boolean {
  return JSON.stringify(index.key) === JSON.stringify({ normalizedPrompt: 1, contextKey: 1 })
    && index.unique === true
    && JSON.stringify(index.partialFilterExpression) === JSON.stringify({ active: true });
}

function isCurrentExactIndex(index: IndexDescription): boolean {
  return JSON.stringify(index.key) === JSON.stringify({ normalizedPrompt: 1, contextKey: 1, provenance: 1, scope: 1, workspaceKey: 1 })
    && index.unique === true
    && JSON.stringify(index.partialFilterExpression) === JSON.stringify(currentMemoryExactPartialFilter());
}

async function listIndexes(collection: { listIndexes: () => { toArray: () => Promise<IndexDescription[]> } }): Promise<IndexDescription[]> {
  return typeof collection.listIndexes === 'function' ? collection.listIndexes().toArray() : [];
}

async function ensureMemoriesBackup(db: Db, legacy: IndexDescription | undefined): Promise<{ collection: string; documentCount: number; sha256: string }> {
  const memories = db.collection('memories');
  const backup = db.collection(BACKUP_COLLECTION);
  const metadata = db.collection<Document & { _id: string }>(BACKUP_METADATA_COLLECTION);
  const sourceCount = await memories.countDocuments();
  const sourceSha256 = await digestDocuments(memories);
  const existingMetadata = await metadata.findOne<{ sourceCount: number; sourceSha256: string; legacyIndex: IndexDescription }>({ _id: BACKUP_METADATA_ID });
  const backupExists = (await db.listCollections({ name: BACKUP_COLLECTION }).toArray()).length > 0;

  if (!backupExists) {
    await memories.aggregate([{ $match: {} }, { $out: BACKUP_COLLECTION }]).toArray();
  }

  const backupCount = await backup.countDocuments();
  const backupSha256 = await digestDocuments(backup);
  if (backupCount !== sourceCount || backupSha256 !== sourceSha256) {
    throw new Error(`O backup verificável não corresponde à coleção memories (origem ${sourceCount}/${sourceSha256}, backup ${backupCount}/${backupSha256}).`);
  }

  if (existingMetadata !== null && (existingMetadata.sourceCount !== sourceCount || existingMetadata.sourceSha256 !== sourceSha256)) {
    throw new Error('Já existe um backup de migração com conteúdo diferente; nenhum índice foi alterado.');
  }
  if (existingMetadata === null) {
    if (legacy === undefined) {
      throw new Error('Não foi possível verificar a definição do índice legado para registrar o backup.');
    }
    await metadata.insertOne({ _id: BACKUP_METADATA_ID, sourceCollection: 'memories', backupCollection: BACKUP_COLLECTION, sourceCount, sourceSha256, legacyIndex: legacy, createdAt: new Date() });
  }
  const verified = await metadata.findOne<{ sourceCount: number; sourceSha256: string }>({ _id: BACKUP_METADATA_ID });
  if (verified?.sourceCount !== sourceCount || verified.sourceSha256 !== sourceSha256) throw new Error('A evidência do backup não pôde ser verificada.');
  return { collection: BACKUP_COLLECTION, documentCount: sourceCount, sha256: sourceSha256 };
}

async function digestDocuments(collection: Collection<Document>): Promise<string> {
  const hash = createHash('sha256');
  for await (const document of collection.find({}).sort({ _id: 1 })) hash.update(EJSON.stringify(document, { relaxed: false }));
  return hash.digest('hex');
}

async function findCurrentIdentityConflicts(collection: Collection<Document>): Promise<string[]> {
  const conflicts = await collection.aggregate([
    { $match: currentMemoryExactPartialFilter() },
    { $group: { _id: { normalizedPrompt: '$normalizedPrompt', contextKey: '$contextKey', provenance: '$provenance', scope: '$scope', workspaceKey: { $ifNull: ['$workspaceKey', null] } }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
  ]).toArray();
  return conflicts.map((conflict) => `${EJSON.stringify(conflict._id, { relaxed: false })}: ${String(conflict.count)}`);
}

export function redactUri(uri: string): string {
  return uri
    .replace(/\/\/[^@/]*@/, '//***@')
    .replace(/([?&](?:password|passwd|pwd|secret|token|api[-_]?key|access[-_]?token)=)[^&]*/gi, '$1***');
}

export function sanitizeDiagnosticText(text: string): string | undefined {
  const sanitized = redactUri(text)
    .replace(/((?:password|passwd|pwd|secret|token|api[-_]?key|access[-_]?token)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1***')
    .replace(/(Bearer\s+)[^\s,;]+/gi, '$1***')
    .replace(/\r?\n/g, ' ')
    .trim();
  if (!sanitized || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(sanitized)) return undefined;
  return sanitized.length <= 500 ? sanitized : `${sanitized.slice(0, 500)}…`;
}

function describeError(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  let depth = 0;
  while (current !== undefined && current !== null && depth < 3) {
    const record = typeof current === 'object' ? current as Record<string, unknown> : undefined;
    const constructorName = record?.constructor;
    const className = typeof constructorName === 'function' && typeof (constructorName as { readonly name?: unknown }).name === 'string'
      ? (constructorName as { readonly name: string }).name
      : typeof current;
    const name = typeof record?.name === 'string' ? record.name : 'unknown';
    const code = typeof record?.code === 'string' || typeof record?.code === 'number' ? String(record.code) : 'none';
    const message = typeof record?.message === 'string' ? sanitizeDiagnosticText(record.message) : undefined;
    parts.push(`class=${className}, name=${name}, code=${code}${message === undefined ? '' : `, message=${message}`}`);
    current = record?.cause;
    depth += 1;
    if (current !== undefined && current !== null) parts.push('cause=');
  }
  return parts.join(' ');
}

function isMissingNamespace(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { readonly code?: unknown }).code === 26;
}
