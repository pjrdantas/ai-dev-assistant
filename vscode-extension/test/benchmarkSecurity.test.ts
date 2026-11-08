import assert from 'node:assert/strict';
import test from 'node:test';

import { createBenchmarkMongoClient, validateBenchmarkMongoUri } from '../src/benchmarkMongoConfiguration.js';

test('AUD-10: rejeita 27017 antes de construir um MongoClient', () => {
  let factoryCalls = 0;
  assert.throws(
    () => createBenchmarkMongoClient('mongodb://127.0.0.1:27017/test?directConnection=true', () => { factoryCalls += 1; return undefined as never; }),
    /porta 27017/,
  );
  assert.equal(factoryCalls, 0);
});

test('AUD-10: exige alvo loopback efêmero isolado e rejeita roteamento', () => {
  assert.equal(validateBenchmarkMongoUri('mongodb://127.0.0.1:27018/test?directConnection=true'), 'mongodb://127.0.0.1:27018/test?directConnection=true');
  for (const uri of [
    undefined,
    'mongodb://127.0.0.1:27017',
    'mongodb://127.0.0.1',
    'mongodb://127.0.0.1:27018',
    'mongodb://127.0.0.1:27018,127.0.0.1:27019/test?directConnection=true',
    'mongodb://192.0.2.10:27018/test?directConnection=true',
    'mongodb+srv://example.test/test',
    'mongodb://127.0.0.1:27018/test?directConnection=true&replicaSet=rs0',
    'mongodb://127.0.0.1:27018/test?directConnection=true&loadBalanced=true',
  ]) {
    assert.throws(() => validateBenchmarkMongoUri(uri), /AUD-10/);
  }
});
