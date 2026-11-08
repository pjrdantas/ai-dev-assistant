import assert from 'node:assert/strict';
import test from 'node:test';

import { runBeforeSearch } from '../src/searchPreparation.js';

test('AUD-01 continua a busca quando a promoção falha e sanitiza o diagnóstico', async () => {
  let searched = false;
  let diagnostic: unknown;
  await runBeforeSearch(
    async () => { throw new Error('MongoDB mongodb://user:secret@example.test:27017 indisponível'); },
    (value) => { diagnostic = value; },
  );
  searched = true;
  assert.equal(searched, true);
  assert.deepEqual(diagnostic, { reason: 'PROMOTION_FAILED', message: 'MongoDB mongodb://***@example.test:27017 indisponível' });
});

test('AUD-01 não intercepta falhas próprias da busca', async () => {
  await assert.rejects(async () => {
    await runBeforeSearch(undefined, undefined);
    throw new Error('falha própria da busca');
  }, /falha própria da busca/);
});
