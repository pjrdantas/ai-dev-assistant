import { Db, MongoClient, MongoClientOptions } from 'mongodb';

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
    const legacyExact = existing.find((index) => index.name === 'memories_active_exact_unique');
    const legacyKey = legacyExact?.key !== undefined
      && JSON.stringify(legacyExact.key) === JSON.stringify({ normalizedPrompt: 1, contextKey: 1 });
    if (legacyKey) throw new MongoSchemaMigrationRequiredError();
    await Promise.all([
      db.collection('memories').createIndexes([
        { key: { contextKey: 1 }, name: 'memories_contextKey' },
        { key: { active: 1 }, name: 'memories_active' },
        { key: { normalizedPrompt: 1 }, name: 'memories_normalizedPrompt' },
        { key: { updatedAt: -1 }, name: 'memories_updatedAt' },
        { key: { contextKey: 1, active: 1 }, name: 'memories_contextKey_active' },
        { key: { normalizedPrompt: 1, contextKey: 1, provenance: 1, scope: 1, workspaceKey: 1 }, name: 'memories_active_exact_unique', unique: true, partialFilterExpression: { active: true, provenance: { $exists: true }, scope: { $exists: true } } },
      ]),
      db.collection('interactions').createIndexes([
        { key: { sessionId: 1, createdAt: -1 }, name: 'interactions_sessionId_createdAt' },
        { key: { workspaceKey: 1, createdAt: -1 }, name: 'interactions_workspaceKey_createdAt' },
        { key: { status: 1 }, name: 'interactions_status' },
        { key: { interactionId: 1 }, name: 'interactions_interactionId_unique', unique: true },
      ]),
    ]);
  }
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
