import { Collection, Document } from 'mongodb';

import { MongoConnectionManager } from './mongoConnectionManager.js';
import { WorkspaceOrigin, resolveWorkspaceOrigin } from './interactionCapture.js';
import { containsSensitiveContent } from './sensitiveContent.js';

export type InteractionStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'RESPONSE_UNAVAILABLE' | 'SKIPPED_SENSITIVE';
export type PromotionStatus = 'PENDING' | 'PROCESSING' | 'PROMOTED' | 'SKIPPED' | 'FAILED';

export interface InteractionRecord {
  readonly interactionId: string;
  readonly sessionId: string;
  readonly workspaceKey?: string;
  readonly originalRequest: string;
  readonly response?: string;
  readonly status: InteractionStatus;
  readonly createdAt: Date;
  readonly completedAt?: Date;
  readonly cwd?: string;
  readonly promotionStatus?: PromotionStatus;
  readonly promotionReason?: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

/** Prepared history store. It never persists a raw Copilot transcript by default. */
export class MongoInteractionStore {
  public constructor(private readonly connection: MongoConnectionManager) {}

  public async save(interaction: InteractionRecord): Promise<void> {
    rejectSensitiveInteraction(interaction);
    await (await this.interactions()).updateOne({ interactionId: interaction.interactionId }, { $setOnInsert: interaction }, { upsert: true });
  }

  public async count(): Promise<number> { return (await this.interactions()).countDocuments(); }
  public async statistics(workspaceKey: string, origins: readonly WorkspaceOrigin[] = []): Promise<{ readonly total: number; readonly pending: number; readonly completed: number; readonly unavailable: number; readonly last?: InteractionRecord }> {
    const collection = await this.interactions();
    const candidates = await collection.find({ $or: [{ workspaceKey }, { cwd: { $exists: true } }] }).toArray();
    const records = candidates.filter((record) => record.cwd !== undefined
      ? resolveWorkspaceOrigin(record.cwd, origins)?.workspaceKey === workspaceKey
      : record.workspaceKey === workspaceKey);
    const last = [...records].sort((left, right) => right.createdAt.valueOf() - left.createdAt.valueOf())[0];
    return {
      total: records.length,
      pending: records.filter((record) => record.status === 'PENDING').length,
      completed: records.filter((record) => record.status === 'COMPLETED').length,
      unavailable: records.filter((record) => record.status === 'FAILED' || record.status === 'RESPONSE_UNAVAILABLE').length,
      last,
    };
  }
  public async clear(): Promise<void> { await (await this.interactions()).deleteMany({}); }

  public async finishLatestPending(sessionId: string, result: { readonly response?: string; readonly reason?: string; readonly completedAt: Date }): Promise<boolean> {
    const update = result.response === undefined || containsSensitiveContent(result.response)
      ? { $set: { status: 'RESPONSE_UNAVAILABLE' as const, completedAt: result.completedAt, promotionStatus: 'SKIPPED' as const, promotionReason: result.reason ?? 'RESPONSE_UNAVAILABLE', metadata: { captureSource: 'STOP_TRANSCRIPT' } } }
      : { $set: { status: 'COMPLETED' as const, response: result.response, completedAt: result.completedAt, promotionStatus: 'PENDING' as const, metadata: { captureSource: 'STOP_TRANSCRIPT' } } };
    const found = await (await this.interactions()).findOneAndUpdate({ sessionId, status: 'PENDING' }, update, { sort: { createdAt: -1 }, returnDocument: 'after' });
    return found !== null;
  }

  public async claimCompletedForPromotion(limit: number): Promise<readonly InteractionRecord[]> {
    return this.claimCompletedForPromotionInWorkspaces(limit, []);
  }

  public async claimCompletedForPromotionInWorkspaces(limit: number, workspaceKeys: readonly string[]): Promise<readonly InteractionRecord[]> {
    if (limit <= 0 || workspaceKeys.length === 0) return [];
    const claimed: InteractionRecord[] = [];
    const collection = await this.interactions();
    for (let index = 0; index < limit; index += 1) {
      const record = await collection.findOneAndUpdate({ status: 'COMPLETED', promotionStatus: 'PENDING', workspaceKey: { $in: [...workspaceKeys] } }, { $set: { promotionStatus: 'PROCESSING' as const } }, { sort: { completedAt: 1, createdAt: 1 }, returnDocument: 'after' });
      if (record === null) break;
      claimed.push(record);
    }
    return claimed;
  }

  public async claimCompletedForPromotionInWorkspaceOrigins(limit: number, origins: readonly WorkspaceOrigin[]): Promise<readonly InteractionRecord[]> {
    if (limit <= 0 || origins.length === 0) return [];
    const claimed: InteractionRecord[] = [];
    const collection = await this.interactions();
    const candidates = await collection.find({ status: 'COMPLETED', promotionStatus: 'PENDING' }).sort({ completedAt: 1, createdAt: 1 }).toArray();
    for (const candidate of candidates) {
      if (claimed.length >= limit) break;
      const resolvedOrigin = resolveWorkspaceOrigin(candidate.cwd, origins);
      if (candidate.cwd !== undefined
        ? resolvedOrigin === undefined
        : !origins.some((origin) => origin.workspaceKey === candidate.workspaceKey)) continue;
      const record = await collection.findOneAndUpdate(
        { interactionId: candidate.interactionId, status: 'COMPLETED', promotionStatus: 'PENDING' },
        { $set: { promotionStatus: 'PROCESSING' as const } },
        { returnDocument: 'after' },
      );
      if (record !== null) claimed.push(record);
    }
    return claimed;
  }

  public async releasePromotion(id: string, reason: string): Promise<void> {
    await (await this.interactions()).updateOne({ interactionId: id, promotionStatus: 'PROCESSING' }, { $set: { promotionStatus: 'PENDING', promotionReason: reason } });
  }

  public async finishPromotion(id: string, status: Exclude<PromotionStatus, 'PENDING' | 'PROCESSING'>, reason: string): Promise<void> {
    await (await this.interactions()).updateOne({ interactionId: id, promotionStatus: 'PROCESSING' }, { $set: { promotionStatus: status, promotionReason: reason } });
  }

  private async interactions(): Promise<Collection<InteractionRecord & Document>> {
    await this.connection.ensureIndexes();
    return (await this.connection.database()).collection<InteractionRecord & Document>('interactions');
  }
}

function rejectSensitiveInteraction(interaction: InteractionRecord): void {
  if (containsSensitiveContent(interaction.originalRequest) || (interaction.response !== undefined && containsSensitiveContent(interaction.response))) {
    throw new Error('Interação potencialmente sensível não pode ser persistida.');
  }
}
