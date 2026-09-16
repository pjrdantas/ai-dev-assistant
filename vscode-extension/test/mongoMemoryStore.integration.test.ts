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

test('remove apenas o prefixo interno da tool', () => {
  assert.equal(stripToolReference(`'${SAVE_MEMORY_TOOL}' este projeto utiliza Maven e possui um pom.xml`, SAVE_MEMORY_TOOL), 'este projeto utiliza Maven e possui um pom.xml');
  assert.equal(stripToolReference(`'${SEARCH_MEMORY_TOOL}' procure conhecimento relacionado ao Maven`, SEARCH_MEMORY_TOOL), 'procure conhecimento relacionado ao Maven');
});
