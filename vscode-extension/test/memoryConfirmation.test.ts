import assert from 'node:assert/strict';
import test from 'node:test';
import { MANUAL_SAVE_CONFIRMATION_MESSAGE } from '../src/memoryConfirmation.js';

test('confirma explicitamente que saveMemory manual é MANUAL/SHARED', () => {
  assert.match(MANUAL_SAVE_CONFIRMATION_MESSAGE, /MANUAL\/SHARED/);
  assert.match(MANUAL_SAVE_CONFIRMATION_MESSAGE, /mesmo quando um workspace estiver identificado/);
});
