import { Collection, Document } from 'mongodb';

import { MongoConnectionManager } from './mongoConnectionManager.js';

export type InteractionStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'RESPONSE_UNAVAILABLE' | 'SKIPPED_SENSITIVE';
export type PromotionStatus = 'PENDING' | 'PROCESSING' | 'PROMOTED' | 'SKIPPED' | 'FAILED';

export interface InteractionRecord {
  readonly interactionId: string;
  readonly sessionId: string;
  readonly workspaceKey: string;
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
    await (await this.interactions()).updateOne({ interactionId: interaction.interactionId }, { $setOnInsert: interaction }, { upsert: true });
  }

  public async count(): Promise<number> { return (await this.interactions()).countDocuments(); }
  public async statistics(workspaceKey: string): Promise<{ readonly total: number; readonly pending: number; readonly completed: number; readonly unavailable: number; readonly last?: InteractionRecord }> {
    const collection = await this.interactions();
    const [total, pending, completed, unavailable, last] = await Promise.all([
      collection.countDocuments(), collection.countDocuments({ status: 'PENDING' }), collection.countDocuments({ status: 'COMPLETED' }), collection.countDocuments({ status: { $in: ['FAILED', 'RESPONSE_UNAVAILABLE'] } }), collection.find({ workspaceKey }).sort({ createdAt: -1 }).limit(1).next(),
    ]);
    return { total, pending, completed, unavailable, last: last ?? undefined };
  }
  public async clear(): Promise<void> { await (await this.interactions()).deleteMany({}); }

  public async finishLatestPending(sessionId: string, result: { readonly response?: string; readonly reason?: string; readonly completedAt: Date }): Promise<boolean> {
    const update = result.response === undefined
      ? { $set: { status: 'RESPONSE_UNAVAILABLE' as const, completedAt: result.completedAt, promotionStatus: 'SKIPPED' as const, promotionReason: result.reason ?? 'RESPONSE_UNAVAILABLE', metadata: { captureSource: 'STOP_TRANSCRIPT' } } }
      : { $set: { status: 'COMPLETED' as const, response: result.response, completedAt: result.completedAt, promotionStatus: 'PENDING' as const, metadata: { captureSource: 'STOP_TRANSCRIPT' } } };
    const found = await (await this.interactions()).findOneAndUpdate({ sessionId, status: 'PENDING' }, update, { sort: { createdAt: -1 }, returnDocument: 'after' });
    return found !== null;
  }

  public async claimCompletedForPromotion(limit: number): Promise<readonly InteractionRecord[]> {
    const claimed: InteractionRecord[] = [];
    const collection = await this.interactions();
    for (let index = 0; index < limit; index += 1) {
      const record = await collection.findOneAndUpdate({ status: 'COMPLETED', promotionStatus: 'PENDING' }, { $set: { promotionStatus: 'PROCESSING' as const } }, { sort: { completedAt: 1, createdAt: 1 }, returnDocument: 'after' });
      if (record === null) break;
      claimed.push(record);
    }
    return claimed;
  }

  public async finishPromotion(id: string, status: Exclude<PromotionStatus, 'PENDING' | 'PROCESSING'>, reason: string): Promise<void> {
    await (await this.interactions()).updateOne({ interactionId: id, promotionStatus: 'PROCESSING' }, { $set: { promotionStatus: status, promotionReason: reason } });
  }

  private async interactions(): Promise<Collection<InteractionRecord & Document>> {
    await this.connection.ensureIndexes();
    return (await this.connection.database()).collection<InteractionRecord & Document>('interactions');
  }
}
