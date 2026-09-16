import assert from 'node:assert/strict';
import test from 'node:test';

import { MongoConnectionManager, redactUri } from '../src/mongoConnectionManager.js';

test('reutiliza um único MongoClient e cria índices de forma idempotente', async () => {
  let connects = 0; let memoryIndexes = 0; let interactionIndexes = 0;
  const client = {
    async connect() { connects += 1; },
    db() { return { collection(name: string) { return { async createIndexes() { if (name === 'memories') memoryIndexes += 1; else interactionIndexes += 1; } }; } }; },
    async close() {},
  };
  const manager = new MongoConnectionManager({ uri: 'mongodb://127.0.0.1:27017', database: 'ai_dev_assistant' }, () => client as never);
  await Promise.all([manager.database(), manager.database()]);
  await Promise.all([manager.ensureIndexes(), manager.ensureIndexes()]);
  assert.equal(connects, 1);
  assert.equal(memoryIndexes, 1);
  assert.equal(interactionIndexes, 1);
});

test('redige credenciais ao apresentar URI MongoDB', () => {
  assert.equal(redactUri('mongodb://user:secret@127.0.0.1:27017'), 'mongodb://***@127.0.0.1:27017');
});
