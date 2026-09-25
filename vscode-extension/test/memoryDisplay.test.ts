import assert from 'node:assert/strict';
import test from 'node:test';

import { memoryDisplayTitle } from '../src/memoryDisplay.js';

test('preserva títulos normais e normaliza espaços', () => {
  assert.equal(
    memoryDisplayTitle('  Qual versão do Java   este projeto utiliza?  '),
    'Qual versão do Java este projeto utiliza?',
  );
});

test('remove prefixo legado do saveMemory apenas para exibição', () => {
  assert.equal(
    memoryDisplayTitle("'ai-dev-assistant_saveMemory' salve como conhecimento reutilizável que este projeto utiliza Maven e possui um pom.xml"),
    'Este projeto utiliza Maven e possui um pom.xml',
  );
});

test('aceita variação sem que após reutilizável', () => {
  assert.equal(
    memoryDisplayTitle('ai-dev-assistant_saveMemory salve como conhecimento reutilizavel projeto usa Java 21'),
    'Projeto usa Java 21',
  );
});
