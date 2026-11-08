import assert from 'node:assert/strict';
import test from 'node:test';

import { LocalMemoryService } from '../src/localMemoryService.js';
import { InteractionPromotionService } from '../src/interactionPromotionService.js';
import { InteractionRecord, PromotionStatus } from '../src/mongoInteractionStore.js';
import { ProjectContextProvider } from '../src/contracts.js';
import { MongoMemoryUnavailableError } from '../src/mongoConnectionManager.js';
import { MongoMemoryStore } from '../src/mongoMemoryStore.js';

const origin = 'workspace-a';
const provider: ProjectContextProvider & { currentWorkspaceKeys: () => readonly string[] } = {
  async capture() { return undefined; },
  currentWorkspaceKeys() { return [origin]; },
};

test('AUD-08: dois workers não promovem a mesma interação e o owner protege o finish', async () => {
  const record: MutableInteraction = {
    interactionId: 'interaction-1', sessionId: 'session-1', workspaceKey: origin,
    originalRequest: 'pergunta técnica', response: 'resposta técnica válida', status: 'COMPLETED',
    createdAt: new Date(), promotionStatus: 'PENDING', promotionAttempts: 0,
  };
  const store = new LeaseFake(record);
  const memoryStore = new MemoryFake();
  const memory = new LocalMemoryService(memoryStore, { async generate() { return [1, 0]; } }, provider);
  const service = new InteractionPromotionService(store as never, memory, () => [origin]);
  await Promise.all([service.promotePending(), service.promotePending()]);
  assert.equal(memoryStore.saveCalls, 1);
  assert.equal(record.promotionStatus, 'PROMOTED');
  await store.finishPromotion(record.interactionId, 'FAILED', 'stale-worker', 'dead-worker');
  assert.equal(store.staleFinishAccepted, false);
});

test('AUD-08: lease expirado é recuperável e a tentativa excedida é terminal', async () => {
  const record: MutableInteraction = {
    interactionId: 'interaction-2', sessionId: 'session-2', workspaceKey: origin,
    originalRequest: 'pergunta técnica', response: 'resposta técnica válida', status: 'COMPLETED',
    createdAt: new Date(), promotionStatus: 'PROCESSING', promotionOwner: 'dead-worker',
    promotionLeaseUntil: new Date(Date.now() - 1), promotionAttempts: 1,
  };
  const store = new LeaseFake(record);
  const memory = new LocalMemoryService(new MemoryFake(), { async generate() { return [1, 0]; } }, provider);
  await new InteractionPromotionService(store as never, memory, () => [origin]).promotePending();
  assert.equal(record.promotionStatus, 'PROMOTED');
  assert.equal(record.promotionOwner, undefined);
  assert.equal(record.promotionAttempts, 2);
  assert.equal(store.releaseCalls, 0);
});

test('AUD-08: erro transitório não perde interação e o quinto retry encerra como FAILED', async () => {
  const record: MutableInteraction = {
    interactionId: 'interaction-3', sessionId: 'session-3', workspaceKey: origin,
    originalRequest: 'pergunta técnica', response: 'resposta técnica válida', status: 'COMPLETED',
    createdAt: new Date(), promotionStatus: 'PROCESSING', promotionOwner: 'dead-worker',
    promotionLeaseUntil: new Date(Date.now() - 1), promotionAttempts: 4,
  };
  const store = new LeaseFake(record);
  const memory = new LocalMemoryService(new MemoryFake(true), { async generate() { return [1, 0]; } }, provider);
  await new InteractionPromotionService(store as never, memory, () => [origin]).promotePending();
  assert.equal(record.promotionStatus, 'FAILED');
  assert.equal(record.promotionReason, 'RETRY_EXCEEDED');
});

test('AUD-10: busca semântica usa cursor/projeção e mantém top-K determinístico', async () => {
  const documents = Array.from({ length: 150 }, (_, index) => ({
    _id: `memory-${String(index).padStart(3, '0')}`, schemaVersion: 2, originalRequest: `request-${index}`,
    normalizedPrompt: `request-${index}`, contextKey: 'v1:without-project-context', response: `response-${index}`,
    embedding: [1, 0], active: true, createdAt: new Date(), updatedAt: new Date(), lastUsedAt: new Date(), reuseCount: 0,
    provenance: 'MANUAL', scope: 'SHARED', history: [{ response: 'must not be projected', updatedAt: new Date() }],
  }));
  const cursor = new CursorFake(documents);
  const collection = { find() { return cursor; } };
  const store = new MongoMemoryStore({ async ensureIndexes() {}, async database() { return { collection() { return collection; } } as never; } } as never);
  const matches = await store.findSimilar([1, 0], undefined);
  assert.equal(matches.length, 100);
  assert.equal(matches[0]?.knowledge.id, 'memory-000');
  assert.equal(matches.at(-1)?.knowledge.id, 'memory-099');
  assert.equal(cursor.projected.history, undefined);
  assert.equal(cursor.batch, 256);
});

type MutableInteraction = {
  interactionId: string; sessionId: string; workspaceKey?: string; originalRequest: string; response?: string;
  status: InteractionRecord['status']; createdAt: Date; promotionStatus?: PromotionStatus; promotionReason?: string;
  promotionOwner?: string; promotionLeaseUntil?: Date; promotionAttempts?: number;
};

class LeaseFake {
  public saveCalls = 0;
  public releaseCalls = 0;
  public staleFinishAccepted = true;
  public constructor(private readonly record: MutableInteraction) {}
  public async claimCompletedForPromotionInWorkspaces(limit: number, keys: readonly string[], owner: string): Promise<readonly InteractionRecord[]> {
    if (limit <= 0 || !keys.includes(this.record.workspaceKey ?? '') || this.record.status !== 'COMPLETED') return [];
    const reclaimable = this.record.promotionStatus === 'PENDING'
      || (this.record.promotionStatus === 'PROCESSING' && (this.record.promotionLeaseUntil?.getTime() ?? Infinity) <= Date.now());
    if (!reclaimable) return [];
    this.record.promotionStatus = 'PROCESSING'; this.record.promotionOwner = owner;
    this.record.promotionLeaseUntil = new Date(Date.now() + 30_000); this.record.promotionAttempts = (this.record.promotionAttempts ?? 0) + 1;
    return [this.record];
  }
  public async releasePromotion(id: string, reason: string, owner: string, maxAttempts = 5): Promise<boolean> { this.releaseCalls += 1; if (this.record.interactionId !== id || this.record.promotionOwner !== owner) return false; if ((this.record.promotionAttempts ?? 0) >= maxAttempts) { this.record.promotionStatus = 'FAILED'; this.record.promotionReason = 'RETRY_EXCEEDED'; } else { this.record.promotionStatus = 'PENDING'; this.record.promotionReason = reason; } return true; }
  public async finishPromotion(id: string, status: Exclude<PromotionStatus, 'PENDING' | 'PROCESSING'>, reason: string, owner: string): Promise<boolean> {
    if (this.record.interactionId !== id || this.record.promotionOwner !== owner) { this.staleFinishAccepted = false; return false; }
    this.record.promotionStatus = status; this.record.promotionReason = reason; this.record.promotionOwner = undefined; this.record.promotionLeaseUntil = undefined; return true;
  }
}

class MemoryFake {
  public constructor(private readonly unavailable = false) {}
  public async findExact() { return undefined; }
  public async findSimilar() { return []; }
  public async registerReuse() { return undefined; }
  public async save() { this.saveCalls += 1; if (this.unavailable) throw new MongoMemoryUnavailableError(new Error('transient')); return { id: 'memory', originalRequest: 'pergunta técnica', normalizedPrompt: 'pergunta técnica', contextKey: 'v1:without-project-context', response: 'resposta técnica válida', createdAt: '', lastUsedAt: '', reuseCount: 0 }; }
  public saveCalls = 0;
}

class CursorFake {
  public projected: Record<string, unknown> = {};
  public batch = 0;
  public constructor(private readonly documents: readonly Record<string, unknown>[]) {}
  public project(projection: Record<string, unknown>) { this.projected = projection; return this; }
  public batchSize(size: number) { this.batch = size; return this; }
  public async *[Symbol.asyncIterator](): AsyncGenerator<Record<string, unknown>> { for (const document of this.documents) yield document; }
}
