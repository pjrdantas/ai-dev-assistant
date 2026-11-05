import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { MongoClient } from 'mongodb';
import type { Document } from 'mongodb';

import { ProjectContext } from '../src/contracts.js';
import { MongoConnectionManager } from '../src/mongoConnectionManager.js';
import { MongoMemoryStore } from '../src/mongoMemoryStore.js';
import { LocalMemoryService } from '../src/localMemoryService.js';

const context: ProjectContext = { buildTool: 'MAVEN', frameworks: [], languages: [{ name: 'JAVA', version: '21' }] };
const testMongoUri = requiredEphemeralMongoUri();

test('E3-006: rejeita a porta MongoDB habitual antes de criar qualquer conexão', () => {
  for (const uri of [
    'mongodb://127.0.0.1:27017',
    'mongodb://localhost/',
    'mongodb://user:password@mongo-host:27017/test?retryWrites=false',
    'mongodb://[::1]:27017/?authSource=admin',
    'mongodb://mongo-a:27018,mongo-b:27017/test',
  ]) {
    assert.throws(() => validateEphemeralMongoUri(uri), /porta 27017|porto 27017|porta explícita|porta explicita/);
  }
});

test('E3-006: aceita somente URI explícita em uma porta efêmera diferente de 27017', () => {
  assert.equal(validateEphemeralMongoUri('mongodb://user:password@127.0.0.1:27018/test?authSource=admin'), 'mongodb://user:password@127.0.0.1:27018/test?authSource=admin');
  assert.equal(validateEphemeralMongoUri('mongodb://[::1]:27019/'), 'mongodb://[::1]:27019/');
  assert.throws(() => validateEphemeralMongoUri('mongodb://localhost'), /porta explícita|porta explicita/);
  assert.throws(() => validateEphemeralMongoUri('mongodb+srv://mongo.example/test'), /mongodb:\/\//);
});

test('E3-006: reativacoes concorrentes de duplicatas inativas sao idempotentes e nao escapam E11000', async (t) => {
  const databaseName = `ai_dev_assistant_e3_006_${randomUUID().replaceAll('-', '')}`;
  const connection = new MongoConnectionManager({ uri: testMongoUri, database: databaseName });
  const client = new MongoClient(testMongoUri, { serverSelectionTimeoutMS: 1_500, connectTimeoutMS: 1_500 });
  try {
    const database = await connection.database();
    await connection.ensureIndexes();
    await client.connect();
    const collection = client.db(databaseName).collection<Document & { _id: string }>('memories');
    const timestamp = new Date('2026-01-01T00:00:00.000Z');
    await collection.insertMany([
      { _id: 'inactive-a', schemaVersion: 2, originalRequest: 'mesmo prompt', normalizedPrompt: 'mesmo prompt', contextKey: JSON.stringify(context), response: 'A', embedding: [1, 0], active: false, createdAt: timestamp, updatedAt: timestamp, lastUsedAt: timestamp, reuseCount: 0, invalidatedAt: timestamp, provenance: 'MANUAL', scope: 'SHARED' },
      { _id: 'inactive-b', schemaVersion: 2, originalRequest: 'mesmo prompt', normalizedPrompt: 'mesmo prompt', contextKey: JSON.stringify(context), response: 'B', embedding: [1, 0], active: false, createdAt: timestamp, updatedAt: timestamp, lastUsedAt: timestamp, reuseCount: 0, invalidatedAt: timestamp, provenance: 'MANUAL', scope: 'SHARED' },
    ]);

    const store = new MongoMemoryStore(connection);
    let duplicateKeyErrors = 0;
    let successfulReactivations = 0;
    for (let iteration = 0; iteration < 20; iteration += 1) {
      await collection.updateMany({ _id: { $in: ['inactive-a', 'inactive-b'] } }, { $set: { active: false } });
      const results = await Promise.allSettled([store.reactivate('inactive-a'), store.reactivate('inactive-b')]);
      duplicateKeyErrors += results.filter((result) => result.status === 'rejected' && isDuplicateKey(result.reason)).length;
      successfulReactivations += results.filter((result) => result.status === 'fulfilled' && result.value === true).length;
      assert.equal(results.filter((result) => result.status === 'rejected').length, 0);
      assert.equal(await collection.countDocuments({ active: true }), 1);
      await collection.updateMany({ _id: { $in: ['inactive-a', 'inactive-b'] } }, { $set: { active: false } });
    }

    assert.equal(duplicateKeyErrors, 0);
    assert.equal(successfulReactivations, 20);
    assert.equal(await database.collection('memories').countDocuments({ active: true }), 0);
  } finally {
    try { await client.db(databaseName).dropDatabase(); } catch { /* database may not exist */ }
    await client.close();
    await connection.close();
  }
});

test('E3-006: LocalMemoryService deduplica gravacoes manuais compartilhadas concorrentes', async (t) => {
  await withStore(t, async (store) => {
    const service = serviceFor(store);
    const results = await Promise.all(Array.from({ length: 20 }, (_, index) => service.save('manual concorrente', `resposta-${index}`)));
    assert.equal(new Set(results.map((result) => result.memoryId)).size, 1);
    assert.equal((await store.statistics()).active, 1);
  });
});

test('E3-006: gravacoes automáticas concorrentes de workspaces diferentes coexistem', async (t) => {
  await withStore(t, async (store) => {
    const [left, right] = await Promise.all([
      serviceFor(store, 'workspace-a').save('prompt entre workspaces', 'workspace A', 'workspace-a'),
      serviceFor(store, 'workspace-b').save('prompt entre workspaces', 'workspace B', 'workspace-b'),
    ]);
    assert.notEqual(left.memoryId, right.memoryId);
    assert.equal((await store.statistics()).active, 2);
    assert.equal((await store.findExact('prompt entre workspaces', context, { workspaceKey: 'workspace-a' }))?.response, 'workspace A');
    assert.equal((await store.findExact('prompt entre workspaces', context, { workspaceKey: 'workspace-b' }))?.response, 'workspace B');
  });
});

test('E3-006: salvar enquanto invalida a mesma memória não cria duplicata indevida', async (t) => {
  await withStore(t, async (store) => {
    const original = await store.save('salvar e invalidar', 'original', context, 'original', [1, 0]);
    const results = await Promise.allSettled([
      store.save('salvar e invalidar', 'salvar e invalidar', context, 'nova', [1, 0]),
      store.invalidate(original.id),
    ]);
    assert.equal(results.filter((result) => result.status === 'rejected').length, 0);
    assert.ok((await store.statistics()).active <= 1);
    assert.equal((await store.listAll()).filter((entry) => entry.active).length, (await store.statistics()).active);
  });
});

test('E3-006: substituicoes concorrentes preservam uma memória ativa e uma revisão por operação', async (t) => {
  await withStore(t, async (store) => {
    const original = await store.save('substituição concorrente', 'substituição concorrente', context, 'original', [1, 0]);
    const results = await Promise.allSettled([
      store.replace(original.id, 'solução A', [1, 0]),
      store.replace(original.id, 'solução B', [0.9, 0.1]),
    ]);
    assert.equal(results.filter((result) => result.status === 'rejected').length, 0);
    const stored = (await store.listAll()).find((entry) => entry.knowledge.id === original.id);
    assert.equal(stored?.active, true);
    assert.ok(stored?.knowledge.response === 'solução A' || stored?.knowledge.response === 'solução B');
    assert.equal(stored?.knowledge.revision, 2);
  });
});

test('E3-006: replace ignora memória invalidada sem alterar seus campos', async (t) => {
  await withStore(t, async (store) => {
    const original = await store.save('replace invalidado', 'replace invalidado', context, 'resposta original', [1, 0]);
    await store.invalidate(original.id);
    const before = (await store.listAll()).find((entry) => entry.knowledge.id === original.id)?.knowledge;
    assert.ok(before?.invalidatedAt);

    assert.equal(await store.replace(original.id, 'resposta nova', [0, 1]), undefined);

    const after = (await store.listAll()).find((entry) => entry.knowledge.id === original.id);
    assert.equal(after?.active, false);
    assert.equal(after?.knowledge.response, before?.response);
    assert.equal(after?.knowledge.revision, before?.revision);
    assert.equal(after?.knowledge.invalidatedAt, before?.invalidatedAt);
  });
});

test('E3-006: replace propaga erro MongoDB inesperado', async () => {
  const unexpected = new Error('falha MongoDB sintética');
  const store = new MongoMemoryStore({
    async database() { return { collection() { return { findOneAndUpdate: async () => { throw unexpected; } }; } } as never; },
    async ensureIndexes() {},
  } as never);
  await assert.rejects(store.replace('memory-id', 'resposta', [1, 0]), (error) => error === unexpected);
});

test('E3-006: reexecução depois de uma reativação concorrente é idempotente', async (t) => {
  await withStore(t, async (store) => {
    const original = await store.save('reativação repetida', 'reativação repetida', context, 'resposta', [1, 0]);
    await store.invalidate(original.id);
    const concurrent = await Promise.all([store.reactivate(original.id), store.reactivate(original.id)]);
    assert.equal(concurrent.filter(Boolean).length, 1);
    assert.equal(await store.reactivate(original.id), false);
    assert.equal((await store.statistics()).active, 1);
  });
});

test('E3-006: memórias LEGACY podem ser reativadas sem erro de índice novo', async (t) => {
  await withStore(t, async (store, database) => {
    const timestamp = new Date('2026-01-01T00:00:00.000Z');
    const collection = database.collection<Document & { _id: string }>('memories');
    await collection.insertMany([
      { _id: 'legacy-a', schemaVersion: 2, originalRequest: 'legado', normalizedPrompt: 'legado', contextKey: JSON.stringify(context), response: 'A', embedding: [1, 0], active: false, createdAt: timestamp, updatedAt: timestamp, lastUsedAt: timestamp, reuseCount: 0 },
      { _id: 'legacy-b', schemaVersion: 2, originalRequest: 'legado', normalizedPrompt: 'legado', contextKey: JSON.stringify(context), response: 'B', embedding: [1, 0], active: false, createdAt: timestamp, updatedAt: timestamp, lastUsedAt: timestamp, reuseCount: 0 },
    ]);
    const results = await Promise.allSettled([store.reactivate('legacy-a'), store.reactivate('legacy-b')]);
    assert.equal(results.filter((result) => result.status === 'rejected').length, 0);
    assert.equal((await store.listAll()).filter((entry) => entry.active).length, 2);
    assert.ok((await store.listAll()).every((entry) => entry.knowledge.provenance === 'LEGACY'));
  });
});

function serviceFor(store: MongoMemoryStore, currentWorkspaceKey?: string): LocalMemoryService {
  return new LocalMemoryService(store, { async generate() { return [1, 0]; } }, {
    async capture() { return context; },
    currentWorkspaceKeys() { return currentWorkspaceKey === undefined ? [] : [currentWorkspaceKey]; },
  } as import('../src/contracts.js').ProjectContextProvider & { currentWorkspaceKeys: () => readonly string[] });
}

async function withStore(
  t: { skip(message?: string): void },
  callback: (store: MongoMemoryStore, database: Awaited<ReturnType<MongoConnectionManager['database']>>) => Promise<void>,
): Promise<void> {
  const databaseName = `ai_dev_assistant_e3_006_${randomUUID().replaceAll('-', '')}`;
  const connection = new MongoConnectionManager({ uri: testMongoUri, database: databaseName });
  let database: Awaited<ReturnType<MongoConnectionManager['database']>> | undefined;
  try {
    database = await connection.database();
    await callback(new MongoMemoryStore(connection), database);
  } finally {
    try { await database?.dropDatabase(); } catch { /* database may not exist */ }
    await connection.close();
  }
}

function requiredEphemeralMongoUri(): string {
  const uri = process.env.AI_DEV_ASSISTANT_E3_006_MONGODB_URI?.trim();
  if (uri === undefined || uri.length === 0) {
    throw new Error('E3-006 exige AI_DEV_ASSISTANT_E3_006_MONGODB_URI apontando para uma instância MongoDB efêmera de testes.');
  }
  return validateEphemeralMongoUri(uri);
}

function validateEphemeralMongoUri(uri: string): string {
  if (!uri.startsWith('mongodb://')) {
    throw new Error('E3-006 exige uma URI mongodb:// explícita para uma instância efêmera de testes.');
  }

  const authority = uri.slice('mongodb://'.length).split(/[/?#]/)[0] ?? '';
  const hostList = authority.slice(authority.lastIndexOf('@') + 1).split(',');
  if (hostList.length === 0 || hostList.some((host) => host.length === 0)) {
    throw new Error('E3-006 exige uma URI mongodb:// válida com host explícito.');
  }

  for (const hostEntry of hostList) {
    const port = parseMongoPort(hostEntry);
    if (port === 27017) {
      throw new Error('E3-006 rejeita conexões à porta 27017; configure uma instância efêmera exclusiva.');
    }
    if (port === undefined) {
      throw new Error('E3-006 exige uma porta explícita diferente de 27017 para a instância efêmera.');
    }
  }

  return uri;
}

function parseMongoPort(hostEntry: string): number | undefined {
  if (hostEntry.startsWith('[')) {
    const closingBracket = hostEntry.indexOf(']');
    if (closingBracket < 0 || hostEntry.slice(closingBracket + 1, closingBracket + 2) !== ':') {
      return undefined;
    }
    return parsePort(hostEntry.slice(closingBracket + 2));
  }

  const separator = hostEntry.lastIndexOf(':');
  if (separator < 0 || hostEntry.indexOf(':') !== separator) {
    return undefined;
  }
  return parsePort(hostEntry.slice(separator + 1));
}

function parsePort(value: string): number | undefined {
  if (!/^\d+$/.test(value)) {
    return undefined;
  }
  const port = Number(value);
  return port >= 1 && port <= 65_535 ? port : undefined;
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { readonly code?: unknown }).code === 11000;
}
