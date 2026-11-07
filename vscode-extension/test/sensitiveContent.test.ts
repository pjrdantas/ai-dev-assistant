import assert from 'node:assert/strict';
import test from 'node:test';
import { containsSensitiveContent } from '../src/sensitiveContent.js';

test('detecta formatos sintéticos de credenciais e tokens estruturados', () => {
  const cases = [
    `ghp_${'a'.repeat(36)}`,
    `github_pat_${'b'.repeat(36)}`,
    `glpat-${'c'.repeat(24)}`,
    `AKIA${'D'.repeat(16)}`,
    `Authorization: Bearer ${'e'.repeat(24)}`,
    `Authorization: Basic ${'l'.repeat(24)}`,
    `Authorization: Token ${'m'.repeat(24)}`,
    `API_KEY=${'f'.repeat(24)}`,
    `AWS_SECRET_ACCESS_KEY=${'g'.repeat(24)}`,
    `mongodb://user:${'h'.repeat(20)}@db.example.test/app`,
    `eyJ${'i'.repeat(20)}.${'j'.repeat(20)}.${'k'.repeat(20)}`,
    '-----BEGIN PRIVATE KEY-----',
  ];

  for (const value of cases) assert.equal(containsSensitiveContent(value), true, value.slice(0, 12));
});

test('não bloqueia explicações, nomes de variáveis ou placeholders', () => {
  const safe = [
    'Use a variável API_KEY no ambiente de execução.',
    'Exemplo incompleto: ghp_abc123.',
    'API_KEY=<your-token>',
    'password=example',
    'Authorization: Bearer <token>',
  ];

  for (const value of safe) assert.equal(containsSensitiveContent(value), false, value);
});
