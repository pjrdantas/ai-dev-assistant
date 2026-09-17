import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { ProjectContext } from '../src/contracts.js';
import { LocalEmbeddingProvider } from '../src/localEmbeddingProvider.js';
import { LocalMemoryService } from '../src/localMemoryService.js';
import { MongoConnectionManager, MongoMemoryUnavailableError } from '../src/mongoConnectionManager.js';
import { MongoMemoryStore } from '../src/mongoMemoryStore.js';
import { MongoInteractionStore } from '../src/mongoInteractionStore.js';
import { stripToolReference } from '../src/toolReferenceUtils.js';

const SEARCH_MEMORY_TOOL = 'ai-dev-assistant_searchMemory';
const SAVE_MEMORY_TOOL = 'ai-dev-assistant_saveMemory';

const context: ProjectContext = { buildTool: 'MAVEN', frameworks: [{ name: 'SPRING_BOOT', version: '3.5.14' }], languages: [{ name: 'JAVA', version: '21' }] };

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
