import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { MongoClient } from 'mongodb';
import type { Document } from 'mongodb';

import { MongoConnectionManager } from '../src/mongoConnectionManager.js';
import { MongoMemoryStore } from '../src/mongoMemoryStore.js';

test('E3-007: reativação em lote e individual ignora memórias sensíveis', async (t) => {
  const uri = ephemeralMongoUri();
  if (uri === undefined) {
    t.skip('AI_DEV_ASSISTANT_E3_007_MONGODB_URI não configurada para MongoDB efêmero');
    return;
  }

  const databaseName = `ai_dev_assistant_e3_007_${randomUUID().replaceAll('-', '')}`;
  const connection = new MongoConnectionManager({ uri, database: databaseName });
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 1_500, connectTimeoutMS: 1_500 });
  const timestamp = new Date('2026-01-01T00:00:00.000Z');
  try {
    const database = await connection.database();
    await connection.ensureIndexes();
    await client.connect();
    const collection = client.db(databaseName).collection<Document & { _id: string }>('memories');
    await collection.insertMany([
      memory('sensitive-invalidated', `token=${'u'.repeat(24)}`, false, timestamp, timestamp),
      memory('safe-invalidated', 'resposta legítima', false, timestamp, timestamp),
      memory('sensitive-inactive', `Authorization: Basic ${'v'.repeat(24)}`, false, undefined, timestamp),
      memory('safe-inactive', 'resposta legítima 2', false, undefined, timestamp),
    ]);

    const store = new MongoMemoryStore(connection);
    assert.equal(await store.reactivateAllInvalidated(), 1);
    assert.equal(await collection.countDocuments({ active: true }), 1);
    assert.equal((await collection.findOne({ _id: 'sensitive-invalidated' }))?.active, false);
    assert.equal((await collection.findOne({ _id: 'safe-invalidated' }))?.active, true);

    assert.equal(await store.reactivateAll(), 1);
    assert.equal(await collection.countDocuments({ active: true }), 2);
    assert.equal((await collection.findOne({ _id: 'sensitive-inactive' }))?.active, false);
    assert.equal((await collection.findOne({ _id: 'safe-inactive' }))?.active, true);

    await collection.updateOne({ _id: 'sensitive-inactive' }, { $set: { active: false } });
    assert.equal(await store.reactivate('sensitive-inactive'), false);
    assert.equal((await collection.findOne({ _id: 'sensitive-inactive' }))?.active, false);

    await collection.updateOne({ _id: 'safe-inactive' }, { $set: { active: false } });
    assert.equal(await store.reactivate('safe-inactive'), true);
    assert.equal((await collection.findOne({ _id: 'safe-inactive' }))?.active, true);
  } finally {
    try { await client.db(databaseName).dropDatabase(); } catch { /* database may not exist */ }
    await client.close();
    await connection.close();
  }
});

test('E3-007: valida URI efêmera sem conexão e rejeita destinos ambíguos', () => {
  for (const uri of [
    'mongodb://127.0.0.1:27017',
    'mongodb://127.0.0.1',
    'mongodb://127.0.0.1:27017,127.0.0.1:27018',
    'mongodb://127.0.0.1:27018,127.0.0.1:27019',
    'mongodb://localhost:27018',
    'mongodb://192.0.2.10:27018',
    'mongodb://user:password@127.0.0.1:27018',
    'mongodb+srv://127.0.0.1/test',
  ]) {
    assert.equal(ephemeralMongoUri(uri), undefined, uri);
  }

  assert.equal(ephemeralMongoUri('mongodb://127.0.0.1:27018/test?directConnection=true'), 'mongodb://127.0.0.1:27018/test?directConnection=true');
  assert.equal(ephemeralMongoUri('mongodb://[::1]:27019/test?directConnection=true'), 'mongodb://[::1]:27019/test?directConnection=true');
  for (const uri of [
    'mongodb://127.0.0.1:27018/test',
    'mongodb://127.0.0.1:27018/test?directConnection=false',
    'mongodb://127.0.0.1:27018/test?directConnection=true&replicaSet=rs0',
    'mongodb://127.0.0.1:27018/test?directConnection=true&loadBalanced=true',
    'mongodb://127.0.0.1:27018/test?directConnection=true&proxyHost=127.0.0.1',
    'mongodb://127.0.0.1:27018/test?directConnection=true&authSource=admin',
  ]) {
    assert.equal(ephemeralMongoUri(uri), undefined, uri);
  }
});

function memory(id: string, response: string, active: boolean, invalidatedAt: Date | undefined, timestamp: Date): Document & { _id: string } {
  return {
    _id: id,
    schemaVersion: 2,
    originalRequest: id,
    normalizedPrompt: id,
    contextKey: 'ctx',
    response,
    embedding: [1, 0],
    active,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastUsedAt: timestamp,
    reuseCount: 0,
    ...(invalidatedAt === undefined ? {} : { invalidatedAt }),
    provenance: 'MANUAL',
    scope: 'SHARED',
  };
}

function ephemeralMongoUri(candidate?: string): string | undefined {
  const uri = (candidate ?? process.env.AI_DEV_ASSISTANT_E3_007_MONGODB_URI)?.trim();
  if (uri === undefined || !uri.startsWith('mongodb://')) return undefined;
  const authority = uri.slice('mongodb://'.length).split(/[/?#]/)[0] ?? '';
  if (authority.includes(',') || authority.includes('@')) return undefined;
  let parsed: URL;
  try { parsed = new URL(uri); } catch { return undefined; }
  const hostname = parsed.hostname.toLowerCase();
  if (hostname !== '127.0.0.1' && hostname !== '[::1]' && hostname !== '::1') return undefined;
  const port = Number(parsed.port);
  if (parsed.port === '' || !Number.isInteger(port) || port <= 0 || port === 27017) return undefined;
  if (parsed.searchParams.size !== 1 || parsed.searchParams.get('directConnection') !== 'true') return undefined;
  return uri;
}
