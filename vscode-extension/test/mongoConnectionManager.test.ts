import assert from 'node:assert/strict';
import test from 'node:test';

import { MongoConnectionManager, redactUri, sanitizeDiagnosticText } from '../src/mongoConnectionManager.js';

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

test('não encerra o cliente enquanto a conexão está em andamento', async () => {
  let releaseConnect!: () => void;
  const connectStarted = new Promise<void>((resolve) => { releaseConnect = resolve; });
  let closes = 0;
  const database = { collection() { return {}; } };
  const client = {
    async connect() { await connectStarted; },
    db() { return database; },
    async close() { closes += 1; },
  };
  const manager = new MongoConnectionManager(
    { uri: 'mongodb://127.0.0.1:27017', database: 'ai_dev_assistant' },
    () => client as never,
  );

  const databasePromise = manager.database();
  await Promise.resolve();
  const closePromise = manager.close();
  await Promise.resolve();
  assert.equal(closes, 0);

  releaseConnect();
  assert.equal(await databasePromise, database);
  await closePromise;
  assert.equal(closes, 1);
});

test('cria um novo cliente após encerramento e não reutiliza cliente com conexão falha', async () => {
  const databases = [{ collection() { return {}; } }, { collection() { return {}; } }];
  let factoryCalls = 0;
  let closeCalls = 0;
  const manager = new MongoConnectionManager(
    { uri: 'mongodb://127.0.0.1:27017', database: 'ai_dev_assistant' },
    () => {
      const index = factoryCalls++;
      return {
        async connect() { if (index === 0) throw new Error('first connection failed'); },
        db() { return databases[index]; },
        async close() { closeCalls += 1; },
      } as never;
    },
  );

  await assert.rejects(manager.database(), /MongoDB local indisponível/);
  assert.equal(await manager.database(), databases[1]);
  await manager.close();
  assert.equal(factoryCalls, 2);
  assert.equal(closeCalls, 1);

  const secondManager = new MongoConnectionManager(
    { uri: 'mongodb://127.0.0.1:27017', database: 'ai_dev_assistant' },
    () => {
      factoryCalls += 1;
      return {
        async connect() {},
        db() { return databases[0]; },
        async close() { closeCalls += 1; },
      } as never;
    },
  );
  await secondManager.database();
  await secondManager.close();
  await secondManager.database();
  assert.equal(factoryCalls, 4);
});

test('serializa alteração de configuração com conexão em andamento e preserva URI/database', async () => {
  let releaseConnect!: () => void;
  const connectStarted = new Promise<void>((resolve) => { releaseConnect = resolve; });
  const created: Array<{ uri: string; database: string }> = [];
  const databases = [{ collection() { return {}; } }, { collection() { return {}; } }];
  let clientIndex = 0;
  const manager = new MongoConnectionManager(
    { uri: 'mongodb://old:27017', database: 'old_db' },
    (uri) => {
      const index = clientIndex++;
      created.push({ uri, database: index === 0 ? 'old_db' : 'new_db' });
      return {
        async connect() { if (index === 0) await connectStarted; },
        db(database: string) { assert.equal(database, index === 0 ? 'old_db' : 'new_db'); return databases[index]; },
        async close() {},
      } as never;
    },
  );

  const first = manager.database();
  await Promise.resolve();
  const update = manager.updateConfiguration({ uri: 'mongodb://new:27017', database: 'new_db' });
  await Promise.resolve();
  assert.deepEqual(manager.currentConfiguration(), { uri: 'mongodb://old:27017', database: 'old_db' });
  releaseConnect();
  assert.equal(await first, databases[0]);
  await update;
  assert.deepEqual(manager.currentConfiguration(), { uri: 'mongodb://new:27017', database: 'new_db' });
  assert.equal(await manager.database(), databases[1]);
  assert.deepEqual(created, [
    { uri: 'mongodb://old:27017', database: 'old_db' },
    { uri: 'mongodb://new:27017', database: 'new_db' },
  ]);
});

test('consulta somente o database configurado ao criar índices', async () => {
  const accessed: string[] = [];
  const database = {
    collection(name: string) {
      accessed.push(name);
      return { async createIndexes() {} };
    },
  };
  const client = {
    async connect() {},
    db(name: string) { accessed.push(name); return database; },
    async close() {},
  };
  const manager = new MongoConnectionManager(
    { uri: 'mongodb://127.0.0.1:27017', database: 'only_this_database' },
    () => client as never,
  );

  await manager.ensureIndexes();
  assert.deepEqual(accessed, ['only_this_database', 'memories', 'memories', 'interactions']);
});

test('redige credenciais ao apresentar URI MongoDB', () => {
  assert.equal(redactUri('mongodb://user:secret@127.0.0.1:27017'), 'mongodb://***@127.0.0.1:27017');
  assert.equal(redactUri('mongodb://127.0.0.1:27017/?password=secret&retryWrites=true'), 'mongodb://127.0.0.1:27017/?password=***&retryWrites=true');
});

test('registra diagnóstico sanitizado e preserva a exceção original no erro genérico', async () => {
  const logs: string[] = [];
  class FakeMongoError extends Error {
    public readonly code = 18;
    public constructor() {
      super('Authentication failed for mongodb://user:secret@127.0.0.1:27017/?password=secret token=abc');
      this.name = 'MongoServerError';
      this.cause = new Error('nested secret=hidden');
    }
  }
  const original = new FakeMongoError();
  const client = { async connect() { throw original; }, db() { throw new Error('not reached'); }, async close() {} };
  const manager = new MongoConnectionManager(
    { uri: 'mongodb://user:secret@127.0.0.1:27017/?password=secret', database: 'ai_dev_assistant_homolog_20261105' },
    () => client as never,
    (line) => logs.push(line),
  );

  await assert.rejects(manager.database(), (error: unknown) => {
    assert.equal(error instanceof Error && error.message, 'MongoDB local indisponível. A memória local não foi consultada nem gravada.');
    assert.equal(error instanceof Error && error.cause, original);
    return true;
  });

  const output = logs.join('\n');
  assert.match(output, /connection attempt/);
  assert.match(output, /database=ai_dev_assistant_homolog_20261105/);
  assert.match(output, /class=FakeMongoError, name=MongoServerError, code=18/);
  assert.match(output, /message=Authentication failed/);
  assert.doesNotMatch(output, /password=secret|token=abc|secret=hidden|hidden/);
});

test('registra tentativa, configuração efetiva e sucesso da conexão', async () => {
  const logs: string[] = [];
  const database = { collection() { return {}; } };
  const client = { async connect() {}, db() { return database; }, async close() {} };
  const manager = new MongoConnectionManager(
    { uri: 'mongodb://127.0.0.1:27017', database: 'ai_dev_assistant_homolog_20261105' },
    () => client as never,
    (line) => logs.push(line),
  );

  assert.equal(await manager.database(), database);
  const output = logs.join('\n');
  assert.match(output, /connection attempt: uri=mongodb:\/\/127\.0\.0\.1:27017, database=ai_dev_assistant_homolog_20261105/);
  assert.match(output, /connection success: uri=mongodb:\/\/127\.0\.0\.1:27017, database=ai_dev_assistant_homolog_20261105/);
});

test('recusa mensagem diagnóstica com controle não sanitizável', () => {
  assert.equal(sanitizeDiagnosticText('erro\u0000secreto'), undefined);
});
