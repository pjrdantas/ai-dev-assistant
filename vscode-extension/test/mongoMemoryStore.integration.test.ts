import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { MongoClient } from 'mongodb';
import type { Document } from 'mongodb';

import { ProjectContext, ProjectContextProvider } from '../src/contracts.js';
import { LocalEmbeddingProvider } from '../src/localEmbeddingProvider.js';
import { LocalMemoryService } from '../src/localMemoryService.js';
import { MongoConnectionManager, MongoMemoryUnavailableError, MongoSchemaMigrationRequiredError } from '../src/mongoConnectionManager.js';
import { MongoMemoryStore } from '../src/mongoMemoryStore.js';
import { MongoInteractionStore } from '../src/mongoInteractionStore.js';
import { InteractionPromotionService } from '../src/interactionPromotionService.js';
import { normalizeWorkspacePath, workspaceKey } from '../src/interactionCapture.js';
import { stripToolReference } from '../src/toolReferenceUtils.js';

const SEARCH_MEMORY_TOOL = 'ai-dev-assistant_searchMemory';
const SAVE_MEMORY_TOOL = 'ai-dev-assistant_saveMemory';

const context: ProjectContext = { buildTool: 'MAVEN', frameworks: [{ name: 'SPRING_BOOT', version: '3.5.14' }], languages: [{ name: 'JAVA', version: '21' }] };

test('MongoDB real: estatísticas isolam o workspace selecionado e rejeitam origem ambígua', async (t) => {
  const connection = new MongoConnectionManager({ uri: 'mongodb://127.0.0.1:27017', database: `ai_dev_assistant_e3_003_${randomUUID().replaceAll('-', '')}` });
  const originA = workspaceKey('C:/workspace-a')!;
  const originB = workspaceKey('C:/workspace-b')!;
  const originC = workspaceKey('C:/workspace-c')!;
  const origins = [
    { workspaceKey: originA, normalizedPath: normalizeWorkspacePath('C:/workspace-a')! },
    { workspaceKey: originB, normalizedPath: normalizeWorkspacePath('C:/workspace-b')! },
  ];
  try {
    try { await connection.database(); } catch (error) { if (error instanceof MongoMemoryUnavailableError) { t.skip('MongoDB local indisponível'); return; } throw error; }
    const interactions = new MongoInteractionStore(connection);
    const at = (second: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, second));
    const records = [
      { interactionId: 'a-pending', sessionId: 'a-pending', workspaceKey: originA, originalRequest: 'A pending', status: 'PENDING' as const, createdAt: at(1), metadata: { stack: 'MAVEN-SPRING' } },
      { interactionId: 'a-completed', sessionId: 'a-completed', workspaceKey: originA, originalRequest: 'A completed', status: 'COMPLETED' as const, createdAt: at(2), metadata: { stack: 'MAVEN-SPRING' } },
      { interactionId: 'a-failed', sessionId: 'a-failed', workspaceKey: originA, originalRequest: 'A failed', status: 'FAILED' as const, createdAt: at(3), metadata: { stack: 'MAVEN-SPRING' } },
      { interactionId: 'a-unavailable', sessionId: 'a-unavailable', workspaceKey: originA, originalRequest: 'A unavailable', status: 'RESPONSE_UNAVAILABLE' as const, createdAt: at(4), metadata: { stack: 'MAVEN-SPRING' } },
      { interactionId: 'a-legacy', sessionId: 'a-legacy', workspaceKey: originA, originalRequest: 'A legacy identity', status: 'COMPLETED' as const, createdAt: at(5), metadata: { stack: 'MAVEN-SPRING' } },
      { interactionId: 'a-subdirectory', sessionId: 'a-subdirectory', workspaceKey: workspaceKey('C:/workspace-a/apps/service')!, cwd: 'C:/workspace-a/apps/service/src', originalRequest: 'A subdirectory', status: 'COMPLETED' as const, createdAt: at(6), metadata: { stack: 'MAVEN-SPRING' } },
      { interactionId: 'b-pending', sessionId: 'b-pending', workspaceKey: originB, originalRequest: 'B pending', status: 'PENDING' as const, createdAt: at(7), metadata: { stack: 'MAVEN-SPRING' } },
      { interactionId: 'b-completed', sessionId: 'b-completed', workspaceKey: originB, originalRequest: 'B completed', status: 'COMPLETED' as const, createdAt: at(8), metadata: { stack: 'MAVEN-SPRING' } },
      { interactionId: 'b-unavailable', sessionId: 'b-unavailable', workspaceKey: originB, originalRequest: 'B unavailable', status: 'RESPONSE_UNAVAILABLE' as const, createdAt: at(9), metadata: { stack: 'MAVEN-SPRING' } },
      { interactionId: 'without-origin', sessionId: 'without-origin', originalRequest: 'Unknown origin', status: 'COMPLETED' as const, createdAt: at(10), metadata: { stack: 'MAVEN-SPRING' } },
      { interactionId: 'ambiguous-cwd', sessionId: 'ambiguous-cwd', workspaceKey: originA, cwd: 'C:/outside', originalRequest: 'Ambiguous origin', status: 'COMPLETED' as const, createdAt: at(11), metadata: { stack: 'MAVEN-SPRING' } },
    ];
    for (const record of records) await interactions.save(record);

    const statsA = await interactions.statistics(originA, origins);
    assert.equal(statsA.total, 6);
    assert.equal(statsA.pending, 1);
    assert.equal(statsA.completed, 3);
    assert.equal(statsA.unavailable, 2);
    assert.equal(statsA.last?.interactionId, 'a-subdirectory');

    const statsB = await interactions.statistics(originB, origins);
    assert.deepEqual({ total: statsB.total, pending: statsB.pending, completed: statsB.completed, unavailable: statsB.unavailable, last: statsB.last?.interactionId }, { total: 3, pending: 1, completed: 1, unavailable: 1, last: 'b-unavailable' });

    const statsEmpty = await interactions.statistics(originC, origins);
    assert.deepEqual({ total: statsEmpty.total, pending: statsEmpty.pending, completed: statsEmpty.completed, unavailable: statsEmpty.unavailable, last: statsEmpty.last }, { total: 0, pending: 0, completed: 0, unavailable: 0, last: undefined });
    assert.equal((await interactions.statistics(originA, origins)).last?.workspaceKey, workspaceKey('C:/workspace-a/apps/service'));
    assert.equal((await interactions.statistics(originB, origins)).last?.workspaceKey, originB);
  } finally {
    try { await (await connection.database()).dropDatabase(); } catch { /* no database to clean */ }
    await connection.close();
  }
});

test('MongoDB real: save -> exact e candidato semântico Maven/pom.xml', async (t) => {
  const connection = new MongoConnectionManager({ uri: 'mongodb://127.0.0.1:27017', database: `ai_dev_assistant_test_${randomUUID().replaceAll('-', '')}` });
  try {
    let database;
    try { database = await connection.database(); } catch (error) { if (error instanceof MongoMemoryUnavailableError) { t.skip('MongoDB local indisponível'); return; } throw error; }
    await connection.ensureIndexes();
    assert.ok((await database.collection('memories').indexes()).some((index) => index.name === 'memories_active_exact_unique'));
    assert.ok((await database.collection('interactions').indexes()).some((index) => index.name === 'interactions_interactionId_unique'));
    const embeddings: LocalEmbeddingProvider = { async generate(prompt) { return prompt.includes('procure conhecimento') ? [0.8, 0.6] : [1, 0]; } };
    const store = new MongoMemoryStore(connection);
    const interactions = new MongoInteractionStore(connection);
    const service = new LocalMemoryService(store, embeddings, { async capture() { return context; } });
    await service.save('este projeto utiliza Maven e possui um pom.xml', 'Maven usa pom.xml para dependências.');
    await service.save('este projeto Maven possui arquivo pom.xml', 'Maven usa pom.xml para dependências.');
    assert.equal((await store.statistics()).active, 1);
    assert.equal((await service.search('este projeto utiliza Maven e possui um pom.xml')).matchType, 'FULL');
    assert.equal((await service.search('procure conhecimento relacionado ao Maven e ao pom.xml deste projeto')).matchType, 'PARTIAL');
    const exact = await store.findExact('este projeto utiliza maven e possui um pom.xml', context);
    assert.equal(await store.invalidate(exact!.id), true);
    assert.equal((await service.search('este projeto utiliza Maven e possui um pom.xml')).matchType, 'NONE');
    await interactions.save({ interactionId: 'interaction-test', sessionId: 'session-test', workspaceKey: 'workspace-test', originalRequest: 'Pergunta literal', status: 'PENDING', createdAt: new Date() });
    assert.equal(await interactions.finishLatestPending('session-test', { response: 'Resposta capturada', completedAt: new Date() }), true);
    assert.equal((await interactions.statistics('workspace-test')).completed, 1);
  } finally {
    try { await (await connection.database()).dropDatabase(); } catch { /* no database to clean */ }
    await connection.close();
  }
});

test('MongoDB real: promoção seleciona somente a origem do workspace atual', async (t) => {
  const connection = new MongoConnectionManager({ uri: 'mongodb://127.0.0.1:27017', database: `ai_dev_assistant_test_${randomUUID().replaceAll('-', '')}` });
  const originA = workspaceKey('C:/workspace-a')!;
  const originB = workspaceKey('C:/workspace-b')!;
  try {
    let database;
    try { database = await connection.database(); } catch (error) { if (error instanceof MongoMemoryUnavailableError) { t.skip('MongoDB local indisponível'); return; } throw error; }
    const interactions = new MongoInteractionStore(connection);
    const memory = new MongoMemoryStore(connection);
    const service = new LocalMemoryService(memory, { async generate() { return [1, 0]; } }, { async capture() { return context; }, currentWorkspaceKeys() { return [originA]; } } as ProjectContextProvider & { currentWorkspaceKeys: () => readonly string[] });
    await interactions.save({ interactionId: 'origin-a', sessionId: 'session-a', workspaceKey: originA, originalRequest: 'pergunta A', response: 'resposta A', status: 'COMPLETED', completedAt: new Date(), createdAt: new Date(), promotionStatus: 'PENDING' });
    await interactions.save({ interactionId: 'origin-b', sessionId: 'session-b', workspaceKey: originB, originalRequest: 'pergunta B', response: 'resposta B', status: 'COMPLETED', completedAt: new Date(), createdAt: new Date(), promotionStatus: 'PENDING' });
    await interactions.save({ interactionId: 'without-origin', sessionId: 'session-c', originalRequest: 'pergunta sem origem', response: 'resposta sem origem', status: 'COMPLETED', completedAt: new Date(), createdAt: new Date(), promotionStatus: 'PENDING' });

    await new InteractionPromotionService(interactions, service, () => [originA]).promotePending();

    const promoted = await database.collection('interactions').find({}).sort({ interactionId: 1 }).toArray();
    assert.equal(promoted.find((entry) => entry.interactionId === 'origin-a')?.promotionStatus, 'PROMOTED');
    assert.equal(promoted.find((entry) => entry.interactionId === 'origin-b')?.promotionStatus, 'PENDING');
    assert.equal(promoted.find((entry) => entry.interactionId === 'without-origin')?.promotionStatus, 'PENDING');
    assert.equal((await database.collection('memories').countDocuments()), 1);
  } finally {
    try { await (await connection.database()).dropDatabase(); } catch { /* no database to clean */ }
    await connection.close();
  }
});

test('MongoDB real: promoção resolve cwd de subdiretório para a raiz aberta mais específica', async (t) => {
  const connection = new MongoConnectionManager({ uri: 'mongodb://127.0.0.1:27017', database: `ai_dev_assistant_test_${randomUUID().replaceAll('-', '')}` });
  const root = workspaceKey('C:/workspace-a')!;
  const child = workspaceKey('C:/workspace-a/apps/service')!;
  try {
    try { await connection.database(); } catch (error) { if (error instanceof MongoMemoryUnavailableError) { t.skip('MongoDB local indisponível'); return; } throw error; }
    const interactions = new MongoInteractionStore(connection);
    const memory = new MongoMemoryStore(connection);
    const provider = { async capture() { return context; }, currentWorkspaceKeys() { return [root]; } } as ProjectContextProvider & { currentWorkspaceKeys: () => readonly string[] };
    const service = new LocalMemoryService(memory, { async generate() { return [1, 0]; } }, provider);
    await interactions.save({ interactionId: 'subdir-origin', sessionId: 'session-subdir', workspaceKey: child, cwd: 'C:/workspace-a/apps/service/src', originalRequest: 'pergunta da subpasta', response: 'resposta da subpasta', status: 'COMPLETED', createdAt: new Date(), promotionStatus: 'PENDING' });

    const origins = [{ workspaceKey: root, normalizedPath: normalizeWorkspacePath('C:/workspace-a')! }];
    await new InteractionPromotionService(interactions, service, () => [root], () => origins).promotePending();

    assert.equal((await memory.listAll()).length, 1);
    assert.equal((await (await connection.database()).collection('interactions').findOne({ interactionId: 'subdir-origin' }))?.promotionStatus, 'PROMOTED');
  } finally {
    try { await (await connection.database()).dropDatabase(); } catch { /* no database to clean */ }
    await connection.close();
  }
});

test('MongoDB real: promoções iguais de workspaces distintos coexistem e a busca exata respeita a origem', async (t) => {
  const connection = new MongoConnectionManager({ uri: 'mongodb://127.0.0.1:27017', database: `ai_dev_assistant_test_${randomUUID().replaceAll('-', '')}` });
  const originA = workspaceKey('C:/workspace-a')!;
  const originB = workspaceKey('C:/workspace-b')!;
  try {
    let database;
    try { database = await connection.database(); } catch (error) { if (error instanceof MongoMemoryUnavailableError) { t.skip('MongoDB local indisponível'); return; } throw error; }
    const store = new MongoMemoryStore(connection);
    const provider = { async capture() { return context; }, currentWorkspaceKeys() { return [originA, originB]; } } as ProjectContextProvider & { currentWorkspaceKeys: () => readonly string[] };
    const service = new LocalMemoryService(store, { async generate() { return [1, 0]; } }, provider);

    await service.save('mesma pergunta técnica', 'Resposta do workspace A', originA);
    await service.save('mesma pergunta técnica', 'Resposta do workspace B', originB);

    assert.equal((await database.collection('memories').countDocuments({ active: true })), 2);
    assert.equal((await store.findExact('mesma pergunta técnica', context, { workspaceKey: originA }))?.response, 'Resposta do workspace A');
    assert.equal((await store.findExact('mesma pergunta técnica', context, { workspaceKey: originB }))?.response, 'Resposta do workspace B');
  } finally {
    try { await (await connection.database()).dropDatabase(); } catch { /* no database to clean */ }
    await connection.close();
  }
});

test('MongoDB real: promoção não substitui legado sem proveniência e índice novo o mantém coexistente', async (t) => {
  const connection = new MongoConnectionManager({ uri: 'mongodb://127.0.0.1:27017', database: `ai_dev_assistant_test_${randomUUID().replaceAll('-', '')}` });
  const originA = workspaceKey('C:/workspace-a')!;
  try {
    let database;
    try { database = await connection.database(); } catch (error) { if (error instanceof MongoMemoryUnavailableError) { t.skip('MongoDB local indisponível'); return; } throw error; }
    const store = new MongoMemoryStore(connection);
    const legacyId = 'legacy-without-provenance';
    const timestamp = new Date('2026-01-01T00:00:00.000Z');
    const memories = database.collection<Document & { _id: string; response: string; active: boolean }>('memories');
    await memories.insertOne({ _id: legacyId, schemaVersion: 2, originalRequest: 'mesma pergunta técnica', normalizedPrompt: 'mesma pergunta técnica', contextKey: JSON.stringify(context), response: 'Resposta legada', embedding: [1, 0], active: true, createdAt: timestamp, lastUsedAt: timestamp, reuseCount: 0 });
    const provider = { async capture() { return context; }, currentWorkspaceKeys() { return [originA]; } } as ProjectContextProvider & { currentWorkspaceKeys: () => readonly string[] };
    const service = new LocalMemoryService(store, { async generate() { return [1, 0]; } }, provider);

    await service.save('mesma pergunta técnica', 'Resposta nova automática', originA);

    assert.equal((await memories.countDocuments({ active: true })), 2);
    assert.equal((await memories.findOne({ _id: legacyId }))?.response, 'Resposta legada');
    assert.equal((await store.findExact('mesma pergunta técnica', context, { workspaceKey: originA, includeLegacy: false }))?.response, 'Resposta nova automática');
  } finally {
    try { await (await connection.database()).dropDatabase(); } catch { /* no database to clean */ }
    await connection.close();
  }
});

test('MongoDB real: memória compartilhada não deduplica promoção automática do workspace', async (t) => {
  const connection = new MongoConnectionManager({ uri: 'mongodb://127.0.0.1:27017', database: `ai_dev_assistant_test_${randomUUID().replaceAll('-', '')}` });
  const origin = workspaceKey('C:/workspace-a')!;
  try {
    try { await connection.database(); } catch (error) { if (error instanceof MongoMemoryUnavailableError) { t.skip('MongoDB local indisponível'); return; } throw error; }
    const store = new MongoMemoryStore(connection);
    const provider = { async capture() { return context; }, currentWorkspaceKeys() { return [origin]; } } as ProjectContextProvider & { currentWorkspaceKeys: () => readonly string[] };
    const service = new LocalMemoryService(store, { async generate() { return [1, 0]; } }, provider);

    const shared = await service.save('pergunta semanticamente equivalente compartilhada', 'Resposta compartilhada');
    const workspace = await service.save('outra formulação semanticamente equivalente', 'Resposta automática do workspace', origin);

    assert.equal(shared.reusedExistingKnowledge, false);
    assert.equal(workspace.reusedExistingKnowledge, false);
    assert.equal((await store.statistics()).active, 2);
  } finally {
    try { await (await connection.database()).dropDatabase(); } catch { /* no database to clean */ }
    await connection.close();
  }
});

test('MongoDB real: promoção automática não impede gravação manual compartilhada', async (t) => {
  const connection = new MongoConnectionManager({ uri: 'mongodb://127.0.0.1:27017', database: `ai_dev_assistant_test_${randomUUID().replaceAll('-', '')}` });
  const origin = workspaceKey('C:/workspace-a')!;
  try {
    try { await connection.database(); } catch (error) { if (error instanceof MongoMemoryUnavailableError) { t.skip('MongoDB local indisponível'); return; } throw error; }
    const store = new MongoMemoryStore(connection);
    const provider = { async capture() { return context; }, currentWorkspaceKeys() { return [origin]; } } as ProjectContextProvider & { currentWorkspaceKeys: () => readonly string[] };
    const service = new LocalMemoryService(store, { async generate() { return [1, 0]; } }, provider);

    const workspace = await service.save('pergunta automática semanticamente equivalente', 'Resposta do workspace', origin);
    const shared = await service.save('outra formulação semanticamente equivalente', 'Resposta manual compartilhada');

    assert.equal(workspace.reusedExistingKnowledge, false);
    assert.equal(shared.reusedExistingKnowledge, false);
    assert.equal((await store.statistics()).active, 2);
  } finally {
    try { await (await connection.database()).dropDatabase(); } catch { /* no database to clean */ }
    await connection.close();
  }
});

test('MongoDB real: busca prefere workspace atual antes da memória compartilhada', async (t) => {
  const connection = new MongoConnectionManager({ uri: 'mongodb://127.0.0.1:27017', database: `ai_dev_assistant_test_${randomUUID().replaceAll('-', '')}` });
  const origin = workspaceKey('C:/workspace-a')!;
  try {
    try { await connection.database(); } catch (error) { if (error instanceof MongoMemoryUnavailableError) { t.skip('MongoDB local indisponível'); return; } throw error; }
    const store = new MongoMemoryStore(connection);
    await store.save('mesma pergunta', 'mesma pergunta', context, 'Resposta compartilhada', [1, 0]);
    await store.save('mesma pergunta', 'mesma pergunta', context, 'Resposta do workspace', [1, 0], { provenance: 'AUTO_PROMOTED', scope: 'WORKSPACE', workspaceKey: origin });

    const selected = await store.findExact('mesma pergunta', context, { workspaceKey: origin });

    assert.equal(selected?.response, 'Resposta do workspace');
  } finally {
    try { await (await connection.database()).dropDatabase(); } catch { /* no database to clean */ }
    await connection.close();
  }
});

test('MongoDB real: busca semântica prefere workspace atual mesmo com compartilhada mais similar', async (t) => {
  const connection = new MongoConnectionManager({ uri: 'mongodb://127.0.0.1:27017', database: `ai_dev_assistant_test_${randomUUID().replaceAll('-', '')}` });
  const origin = workspaceKey('C:/workspace-a')!;
  try {
    try { await connection.database(); } catch (error) { if (error instanceof MongoMemoryUnavailableError) { t.skip('MongoDB local indisponível'); return; } throw error; }
    const store = new MongoMemoryStore(connection);
    await store.save('shared', 'shared', context, 'Resposta compartilhada', [1, 0]);
    await store.save('workspace', 'workspace', context, 'Resposta privada A', [0.95, 0.3122498999], { provenance: 'AUTO_PROMOTED', scope: 'WORKSPACE', workspaceKey: origin });
    const matches = await store.findSimilar([1, 0], context, { workspaceKey: origin });
    assert.equal(matches[0]?.knowledge.response, 'Resposta privada A');
    assert.ok(matches[0]!.similarity < matches[1]!.similarity);
  } finally {
    try { await (await connection.database()).dropDatabase(); } catch { /* no database to clean */ }
    await connection.close();
  }
});

test('MongoDB real: deduplicação aplica identidade no Mongo e preserva a semântica de acesso', async (t) => {
  const databaseName = `ai_dev_assistant_e3_004_dedup_${randomUUID().replaceAll('-', '')}`;
  const monitoredClient = new MongoClient('mongodb://127.0.0.1:27017', { monitorCommands: true });
  const returnedDocuments: number[] = [];
  monitoredClient.on('commandSucceeded', (event) => {
    if (event.commandName !== 'find' && event.commandName !== 'getMore') return;
    const reply = event.reply as { readonly cursor?: { readonly firstBatch?: readonly unknown[]; readonly nextBatch?: readonly unknown[] } };
    const batch = reply.cursor?.firstBatch ?? reply.cursor?.nextBatch ?? [];
    returnedDocuments.push(batch.length);
  });
  const connection = new MongoConnectionManager({ uri: 'mongodb://127.0.0.1:27017', database: databaseName }, () => monitoredClient);
  const originA = workspaceKey('C:/workspace-a')!;
  const originB = workspaceKey('C:/workspace-b')!;
  const timestamp = new Date('2026-01-01T00:00:00.000Z');
  const memoryDocument = (id: string, response: string, extra: Record<string, unknown>): Document & { readonly _id: string } => ({
    _id: id, schemaVersion: 2, originalRequest: id, normalizedPrompt: 'mesmo prompt', contextKey: JSON.stringify(context), response,
    embedding: [1, 0], active: true, createdAt: timestamp, updatedAt: timestamp, lastUsedAt: timestamp, reuseCount: 0, ...extra,
  });
  try {
    let database;
    try { database = await connection.database(); } catch (error) { if (error instanceof MongoMemoryUnavailableError) { t.skip('MongoDB local indisponível'); return; } throw error; }
    const memories = database.collection<Document & { readonly _id: string }>('memories');
    await memories.insertMany([
      memoryDocument('auto-a', 'A', { provenance: 'AUTO_PROMOTED', scope: 'WORKSPACE', workspaceKey: originA }),
      memoryDocument('auto-b', 'B', { provenance: 'AUTO_PROMOTED', scope: 'WORKSPACE', workspaceKey: originB }),
      memoryDocument('manual-shared', 'shared', { provenance: 'MANUAL', scope: 'SHARED' }),
      memoryDocument('legacy', 'legacy', {}),
      memoryDocument('auto-null', 'auto-null', { provenance: 'AUTO_PROMOTED', scope: 'WORKSPACE', workspaceKey: null }),
    ]);
    const store = new MongoMemoryStore(connection);

    returnedDocuments.length = 0;
    const autoA = await store.findSimilar([1, 0], context, { workspaceKey: originA, deduplication: { provenance: 'AUTO_PROMOTED', scope: 'WORKSPACE', workspaceKey: originA } });
    assert.deepEqual(autoA.map((match) => match.knowledge.id), ['auto-a']);
    assert.equal(returnedDocuments.reduce((sum, count) => sum + count, 0), 1, 'deduplicação deve transferir somente a identidade compatível');

    returnedDocuments.length = 0;
    const manualShared = await store.findSimilar([1, 0], context, { workspaceKey: originA, deduplication: { provenance: 'MANUAL', scope: 'SHARED' } });
    assert.deepEqual(manualShared.map((match) => match.knowledge.id), ['manual-shared']);
    assert.equal(returnedDocuments.reduce((sum, count) => sum + count, 0), 1);

    await memories.deleteOne({ _id: 'manual-shared' });
    await memories.insertOne(memoryDocument('manual-shared-null', 'shared-null', { provenance: 'MANUAL', scope: 'SHARED', workspaceKey: null }));
    returnedDocuments.length = 0;
    const manualSharedNull = await store.findSimilar([1, 0], context, { workspaceKey: originA, deduplication: { provenance: 'MANUAL', scope: 'SHARED' } });
    assert.deepEqual(manualSharedNull.map((match) => match.knowledge.id), ['manual-shared-null']);
    assert.equal(returnedDocuments.reduce((sum, count) => sum + count, 0), 1);

    const normal = await store.findSimilar([1, 0], context, { workspaceKey: originA });
    assert.deepEqual(new Set(normal.map((match) => match.knowledge.id)), new Set(['auto-a', 'manual-shared-null', 'legacy']));
    const withoutLegacy = await store.findSimilar([1, 0], context, { workspaceKey: originA, includeLegacy: false });
    assert.equal(withoutLegacy.some((match) => match.knowledge.id === 'legacy'), false);

    const service = new LocalMemoryService(store, { async generate() { return [1, 0]; } }, { async capture() { return context; }, currentWorkspaceKeys() { return [originA]; } } as ProjectContextProvider & { currentWorkspaceKeys: () => readonly string[] });
    const semantic = await service.save('nova formulação semântica', 'A atualizada', originA);
    assert.equal(semantic.reusedExistingKnowledge, true);
    assert.equal((await memories.findOne({ _id: 'auto-a' }))?.response, 'A atualizada');
    assert.equal((await memories.findOne({ _id: 'auto-b' }))?.response, 'B');

    await assert.doesNotReject(() => Promise.all([
      store.save('corrida E11000', 'corrida e11000', context, 'resposta 1', [1, 0]),
      store.save('corrida E11000', 'corrida e11000', context, 'resposta 2', [1, 0]),
    ]));
    assert.equal(await memories.countDocuments({ normalizedPrompt: 'corrida e11000', active: true }), 1);
  } finally {
    try { await (await connection.database()).dropDatabase(); } catch { /* no database to clean */ }
    await connection.close();
    await monitoredClient.close();
  }
});

test('MongoDB real: índice legado bloqueia inicialização sem alterar dados', async (t) => {
  const connection = new MongoConnectionManager({ uri: 'mongodb://127.0.0.1:27017', database: `ai_dev_assistant_test_${randomUUID().replaceAll('-', '')}` });
  try {
    let database;
    try { database = await connection.database(); } catch (error) { if (error instanceof MongoMemoryUnavailableError) { t.skip('MongoDB local indisponível'); return; } throw error; }
    const timestamp = new Date('2026-01-01T00:00:00.000Z');
    const memories = database.collection<Document & { _id: string; response?: string }>('memories');
    await memories.insertOne({ _id: 'legacy-index-data', schemaVersion: 2, originalRequest: 'legado', normalizedPrompt: 'legado', contextKey: 'ctx', response: 'preservar', embedding: [1, 0], active: true, createdAt: timestamp, lastUsedAt: timestamp, reuseCount: 0 });
    await memories.createIndex({ normalizedPrompt: 1, contextKey: 1 }, { name: 'memories_active_exact_unique', unique: true, partialFilterExpression: { active: true } });

    await assert.rejects(connection.ensureIndexes(), (error: unknown) => {
      assert.ok(error instanceof MongoSchemaMigrationRequiredError);
      assert.match((error as Error).message, /índice legado/);
      return true;
    });
    assert.equal(await memories.countDocuments({ _id: 'legacy-index-data' }), 1);
    assert.equal((await memories.findOne({ _id: 'legacy-index-data' }))?.response, 'preservar');
  } finally {
    try { await (await connection.database()).dropDatabase(); } catch { /* no database to clean */ }
    await connection.close();
  }
});

test('MongoDB real: gerencia ativacao e desativacao de memorias sem apagar dados', async (t) => {
  const connection = new MongoConnectionManager({
    uri: 'mongodb://127.0.0.1:27017',
    database: `ai_dev_assistant_test_${randomUUID().replaceAll('-', '')}`,
  });

  try {
    let database;

    try {
      database = await connection.database();
    } catch (error) {
      if (error instanceof MongoMemoryUnavailableError) {
        t.skip('MongoDB local indisponivel');
        return;
      }

      throw error;
    }

    const store = new MongoMemoryStore(connection);

    const memoryA = await store.save(
      'Pergunta A',
      'pergunta a',
      context,
      'Resposta A',
      [1, 0],
    );

    const memoryB = await store.save(
      'Pergunta B',
      'pergunta b',
      context,
      'Resposta B',
      [0.9, 0.1],
    );

    const memoryC = await store.save(
      'Pergunta C',
      'pergunta c',
      context,
      'Resposta C',
      [0.8, 0.2],
    );

    const collection = database.collection<{
  _id: string;
  active: boolean;
  invalidatedAt?: Date;
  originalRequest: string;
  response: string;
  embedding?: number[];
}>('memories');

    assert.equal(await collection.countDocuments(), 3);

    const deactivated = await store.deactivateAll();

    assert.equal(deactivated, 3);

    const afterDeactivate = await store.statistics();

    assert.equal(afterDeactivate.total, 3);
    assert.equal(afterDeactivate.active, 0);
    assert.equal(afterDeactivate.invalidated, 3);

    assert.equal(
      await collection.countDocuments(),
      3,
      'deactivateAll nao deve apagar documentos fisicamente',
    );

    const inactive = await store.listInactive();

    assert.equal(inactive.length, 3);

    const inactiveA = inactive.find((entry) => entry.id === memoryA.id);

    assert.equal(inactiveA?.originalRequest, 'Pergunta A');
    assert.equal(inactiveA?.response, 'Resposta A');
    assert.deepEqual(inactiveA?.embedding, [1, 0]);

    assert.equal(await store.reactivate(memoryA.id), true);
    assert.equal(await store.reactivate(memoryA.id), false);

    const reactivatedA = await collection.findOne({ _id: memoryA.id });

    assert.equal(reactivatedA?.active, true);
    assert.equal(reactivatedA?.invalidatedAt, undefined);
    assert.equal(reactivatedA?.originalRequest, 'Pergunta A');
    assert.equal(reactivatedA?.response, 'Resposta A');
    assert.deepEqual(reactivatedA?.embedding, [1, 0]);

    await collection.updateOne(
      { _id: memoryC.id },
      {
        $set: {
          active: false,
        },
        $unset: {
          invalidatedAt: '',
        },
      },
    );

    const reactivatedInvalidated = await store.reactivateAllInvalidated();

    assert.equal(
      reactivatedInvalidated,
      1,
      'somente a memoria B possui active=false e invalidatedAt',
    );

    const afterInvalidatedA = await collection.findOne({ _id: memoryA.id });
    const afterInvalidatedB = await collection.findOne({ _id: memoryB.id });
    const afterInvalidatedC = await collection.findOne({ _id: memoryC.id });

    assert.equal(afterInvalidatedA?.active, true);
    assert.equal(afterInvalidatedB?.active, true);
    assert.equal(afterInvalidatedB?.invalidatedAt, undefined);

    assert.equal(
      afterInvalidatedC?.active,
      false,
      'memoria inativa sem invalidatedAt nao deve ser reativada por reactivateAllInvalidated',
    );

    const reactivatedAll = await store.reactivateAll();

    assert.equal(
      reactivatedAll,
      1,
      'reactivateAll deve reativar qualquer memoria que ainda esteja inactive',
    );

    const finalA = await collection.findOne({ _id: memoryA.id });
    const finalB = await collection.findOne({ _id: memoryB.id });
    const finalC = await collection.findOne({ _id: memoryC.id });

    assert.equal(finalA?.active, true);
    assert.equal(finalB?.active, true);
    assert.equal(finalC?.active, true);

    assert.equal(finalA?.response, 'Resposta A');
    assert.equal(finalB?.response, 'Resposta B');
    assert.equal(finalC?.response, 'Resposta C');

    assert.deepEqual(finalA?.embedding, [1, 0]);
    assert.deepEqual(finalB?.embedding, [0.9, 0.1]);
    assert.deepEqual(finalC?.embedding, [0.8, 0.2]);

    const finalStats = await store.statistics();

    assert.equal(finalStats.total, 3);
    assert.equal(finalStats.active, 3);
    assert.equal(finalStats.invalidated, 0);

    assert.equal(
      await collection.countDocuments(),
      3,
      'ativar e desativar nao deve alterar a quantidade fisica de documentos',
    );
  } finally {
    try {
      await (await connection.database()).dropDatabase();
    } catch {
      /* no database to clean */
    }

    await connection.close();
  }
});

test('MongoDB real: reativacao em lote ignora memoria duplicada que ja possui equivalente ativa', async (t) => {
  const connection = new MongoConnectionManager({
    uri: 'mongodb://127.0.0.1:27017',
    database: `ai_dev_assistant_test_${randomUUID().replaceAll('-', '')}`,
  });

  try {
    try {
      await connection.database();
    } catch (error) {
      if (error instanceof MongoMemoryUnavailableError) {
        t.skip('MongoDB local indisponivel');
        return;
      }

      throw error;
    }

    const store = new MongoMemoryStore(connection);

    const oldMemory = await store.save(
      'Pergunta duplicada',
      'pergunta duplicada',
      context,
      'Resposta antiga',
      [1, 0],
    );

    assert.equal(await store.invalidate(oldMemory.id), true);

    await store.save(
      'Pergunta duplicada',
      'pergunta duplicada',
      context,
      'Resposta atual',
      [1, 0],
    );

    const before = await store.statistics();

    assert.equal(before.total, 2);
    assert.equal(before.active, 1);
    assert.equal(before.invalidated, 1);

    const reactivated = await store.reactivateAllInvalidated();

    assert.equal(
      reactivated,
      0,
      'a memoria invalidada duplicada deve permanecer inativa',
    );

    const after = await store.statistics();

    assert.equal(after.total, 2);
    assert.equal(after.active, 1);
    assert.equal(after.invalidated, 1);
  } finally {
    try {
      await (await connection.database()).dropDatabase();
    } catch {
      /* no database to clean */
    }

    await connection.close();
  }
});

test('MongoDB real: reativacao individual ignora memoria duplicada que ja possui equivalente ativa', async (t) => {
  const connection = new MongoConnectionManager({
    uri: 'mongodb://127.0.0.1:27017',
    database: `ai_dev_assistant_test_${randomUUID().replaceAll('-', '')}`,
  });

  try {
    try {
      await connection.database();
    } catch (error) {
      if (error instanceof MongoMemoryUnavailableError) {
        t.skip('MongoDB local indisponivel');
        return;
      }

      throw error;
    }

    const store = new MongoMemoryStore(connection);

    const oldMemory = await store.save(
      'Pergunta individual duplicada',
      'pergunta individual duplicada',
      context,
      'Resposta antiga',
      [1, 0],
    );

    assert.equal(await store.invalidate(oldMemory.id), true);

    await store.save(
      'Pergunta individual duplicada',
      'pergunta individual duplicada',
      context,
      'Resposta atual',
      [1, 0],
    );

    const reactivated = await store.reactivate(oldMemory.id);

    assert.equal(
      reactivated,
      false,
      'a memoria duplicada nao deve ser reativada',
    );

    const after = await store.statistics();

    assert.equal(after.total, 2);
    assert.equal(after.active, 1);
    assert.equal(after.invalidated, 1);
  } finally {
    try {
      await (await connection.database()).dropDatabase();
    } catch {
      /* no database to clean */
    }

    await connection.close();
  }
});

test('MongoDB real: reativacao de todas as memorias ignora duplicada que ja possui equivalente ativa', async (t) => {
  const connection = new MongoConnectionManager({
    uri: 'mongodb://127.0.0.1:27017',
    database: `ai_dev_assistant_test_${randomUUID().replaceAll('-', '')}`,
  });

  try {
    let database;

    try {
      database = await connection.database();
    } catch (error) {
      if (error instanceof MongoMemoryUnavailableError) {
        t.skip('MongoDB local indisponivel');
        return;
      }

      throw error;
    }

    const store = new MongoMemoryStore(connection);

    const oldMemory = await store.save(
      'Pergunta duplicada reactivate all',
      'pergunta duplicada reactivate all',
      context,
      'Resposta antiga',
      [1, 0],
    );

    assert.equal(await store.invalidate(oldMemory.id), true);

    await store.save(
      'Pergunta duplicada reactivate all',
      'pergunta duplicada reactivate all',
      context,
      'Resposta atual',
      [1, 0],
    );

    await database.collection('memories').updateOne(
      { _id: oldMemory.id as never },
      {
        $unset: {
          invalidatedAt: '',
        },
      },
    );

    const reactivated = await store.reactivateAll();

    assert.equal(
      reactivated,
      0,
      'a memoria inativa duplicada deve permanecer inativa',
    );

    const after = await store.statistics();

    assert.equal(after.total, 2);
    assert.equal(after.active, 1);
    assert.equal(after.invalidated, 1);
  } finally {
    try {
      await (await connection.database()).dropDatabase();
    } catch {
      /* no database to clean */
    }

    await connection.close();
  }
});

test('remove apenas o prefixo interno da tool', () => {
  assert.equal(stripToolReference(`'${SAVE_MEMORY_TOOL}' este projeto utiliza Maven e possui um pom.xml`, SAVE_MEMORY_TOOL), 'este projeto utiliza Maven e possui um pom.xml');
  assert.equal(stripToolReference(`'${SEARCH_MEMORY_TOOL}' procure conhecimento relacionado ao Maven`, SEARCH_MEMORY_TOOL), 'procure conhecimento relacionado ao Maven');
});
