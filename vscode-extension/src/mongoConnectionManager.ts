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

export class MongoMemoryUnavailableError extends Error {
  public constructor(cause: unknown) {
    super('MongoDB local indisponível. A memória local não foi consultada nem gravada.');
    this.name = 'MongoMemoryUnavailableError';
    this.cause = cause;
  }
}

export class MongoConnectionManager {
  private client: MongoClient | undefined;
  private connecting: Promise<Db> | undefined;
  private indexes: Promise<void> | undefined;

  public constructor(
    private readonly configuration: MongoConnectionConfiguration,
    private readonly clientFactory: (uri: string, options: MongoClientOptions) => MongoClient = (uri, options) => new MongoClient(uri, options),
  ) {}

  public async database(): Promise<Db> {
    if (this.connecting === undefined) {
      this.connecting = this.connect();
    }
    try {
      return await this.connecting;
    } catch (error) {
      this.connecting = undefined;
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
      return { connected: false, uri: redactUri(this.configuration.uri), database: this.configuration.database, reason: error instanceof Error ? error.message : 'erro desconhecido' };
    }
  }

  public async close(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    this.connecting = undefined;
    this.indexes = undefined;
    await client?.close();
  }

  private async connect(): Promise<Db> {
    this.client ??= this.clientFactory(this.configuration.uri, {
      serverSelectionTimeoutMS: 1_500,
      connectTimeoutMS: 1_500,
      appName: 'AI Dev Assistant',
    });
    await this.client.connect();
    return this.client.db(this.configuration.database);
  }

  private async createIndexes(): Promise<void> {
    const db = await this.database();
    await Promise.all([
      db.collection('memories').createIndexes([
        { key: { contextKey: 1 }, name: 'memories_contextKey' },
        { key: { active: 1 }, name: 'memories_active' },
        { key: { normalizedPrompt: 1 }, name: 'memories_normalizedPrompt' },
        { key: { updatedAt: -1 }, name: 'memories_updatedAt' },
        { key: { contextKey: 1, active: 1 }, name: 'memories_contextKey_active' },
        { key: { normalizedPrompt: 1, contextKey: 1 }, name: 'memories_active_exact_unique', unique: true, partialFilterExpression: { active: true } },
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
  return uri.replace(/\/\/[^@/]*@/, '//***@');
}
