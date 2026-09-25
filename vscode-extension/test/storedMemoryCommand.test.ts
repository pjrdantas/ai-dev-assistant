import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { estimateStoredMemoryTokens, estimateTokenCount } from '../src/tokenEstimation.js';

const extensionRoot = process.cwd();

test('estima localmente tokens do conteúdo armazenado sem declarar consumo exato do Copilot', () => {
  assert.equal(estimateTokenCount(''), 0);
  assert.equal(estimateTokenCount('abcd'), 1);
  assert.equal(estimateTokenCount('abcdefgh'), 2);

  const usage = estimateStoredMemoryTokens('12345678', 'abcdefghijkl');
  assert.deepEqual(usage, {
    request: 2,
    response: 3,
    total: 5,
  });
});

test('registra comando para consultar títulos e tokens estimados das memórias', async () => {
  const manifest = JSON.parse(await readFile(join(extensionRoot, 'package.json'), 'utf8')) as {
    readonly contributes: {
      readonly commands?: readonly { readonly command: string; readonly title: string }[];
    };
  };

  const command = manifest.contributes.commands?.find(
    (candidate) => candidate.command === 'aiDevAssistant.showStoredMemories',
  );
  assert.deepEqual(command, {
    command: 'aiDevAssistant.showStoredMemories',
    title: 'AI Dev Assistant: Show Stored Memories',
  });

  const extension = await readFile(join(extensionRoot, 'src', 'extension.ts'), 'utf8');
  assert.match(extension, /registerCommand\('aiDevAssistant\.showStoredMemories'/);
  assert.match(extension, /memory\.listAll\(\)/);
  assert.match(extension, /estimateStoredMemoryTokens/);
  assert.match(extension, /tokens estimados armazenados/);
  assert.match(extension, /não o consumo exato do GitHub Copilot/);
});
