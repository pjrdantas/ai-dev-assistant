import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { FileLocalMemoryStore, MAX_CORRUPTION_BACKUPS, normalizePrompt } from '../src/localMemoryStore.js';
import { LocalMemoryService } from '../src/localMemoryService.js';

const context = { languages: [{ name: 'NODE', version: '22' }], frameworks: [], buildTool: 'NPM' };

test('versiona revisões, invalida, exclui e limpa memória', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-dev-assistant-store-'));
  try {
    const store = new FileLocalMemoryStore(join(directory, 'knowledge-v1.json'));
    const entry = await store.save('Prompt', 'prompt', context, 'solução', [1, 0]);
    assert.equal((await store.statistics()).revision, 1);
    assert.equal(await store.invalidate(entry.id), true);
    assert.equal(await store.findExact('prompt', context), undefined);
    assert.equal((await store.findSimilar([1, 0], context)).length, 0);
    assert.equal(await store.delete(entry.id), true);
    await store.clear();
    assert.deepEqual(await store.statistics(), { total: 0, active: 0, invalidated: 0, schemaVersion: 2, revision: 4, approximateBytes: (await readFile(join(directory, 'knowledge-v1.json'))).byteLength, location: join(directory, 'knowledge-v1.json') });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('recupera JSON corrompido preservando backup', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-dev-assistant-store-'));
  try {
    const path = join(directory, 'knowledge-v1.json'); await writeFile(path, '{corrompido');
    const store = new FileLocalMemoryStore(path);
    const stats = await store.statistics();
    assert.equal(stats.total, 0);
    assert.equal((await readdir(directory)).some((name) => name.startsWith('knowledge-v1.corrupt.')), true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('mantém de zero a cinco backups próprios de corrupção', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-dev-assistant-store-'));
  try {
    const path = join(directory, 'knowledge-v1.json');
    assert.equal((await corruptionBackups(directory)).length, 0);
    const clock = sequenceClock();
    for (let count = 1; count <= MAX_CORRUPTION_BACKUPS; count += 1) {
      await recoverCorruption(path, clock);
      assert.equal((await corruptionBackups(directory)).length, count);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('retém somente os cinco backups próprios mais recentes após seis e dez corrupções', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-dev-assistant-store-'));
  try {
    const path = join(directory, 'knowledge-v1.json'); const clock = sequenceClock();
    for (let count = 0; count < 6; count += 1) await recoverCorruption(path, clock);
    const afterSix = await corruptionBackups(directory);
    assert.equal(afterSix.length, MAX_CORRUPTION_BACKUPS);
    for (let count = 0; count < 4; count += 1) await recoverCorruption(path, clock);
    const afterTen = await corruptionBackups(directory);
    assert.equal(afterTen.length, MAX_CORRUPTION_BACKUPS);
    assert.equal(afterTen.some((name) => afterSix[0] === name), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('não remove arquivos de nome parecido nem o arquivo principal durante a retenção', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-dev-assistant-store-'));
  try {
    const path = join(directory, 'knowledge-v1.json'); const foreign = join(directory, 'knowledge-v1.corrupt.manual.json');
    await writeFile(foreign, 'preservar');
    const clock = sequenceClock();
    for (let count = 0; count < 6; count += 1) await recoverCorruption(path, clock);
    await new FileLocalMemoryStore(path, clock).save('Válido', 'válido', context, 'resposta', [1, 0]);
    assert.equal(await readFile(foreign, 'utf8'), 'preservar');
    assert.equal((await readFile(path, 'utf8')).includes('válido'), true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('mantém o backup recém-criado após a limpeza de retenção', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-dev-assistant-store-'));
  try {
    const path = join(directory, 'knowledge-v1.json'); const clock = sequenceClock();
    for (let count = 0; count < MAX_CORRUPTION_BACKUPS; count += 1) await recoverCorruption(path, clock);
    await recoverCorruption(path, clock);
    const backups = await corruptionBackups(directory);
    assert.equal(backups.length, MAX_CORRUPTION_BACKUPS);
    assert.equal(backups.some((name) => name.includes('20260101T000000005Z')), true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('remove lock comprovadamente obsoleto antes de gravar', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-dev-assistant-store-'));
  try {
    const path = join(directory, 'knowledge-v1.json'); const lockPath = `${path}.lock`;
    await writeFile(lockPath, 'abandonado');
    const old = new Date(Date.now() - 10_000); await utimes(lockPath, old, old);
    const store = new FileLocalMemoryStore(path, undefined, { staleLockAgeMs: 100, lockTimeoutMs: 100 });
    await store.save('Prompt', 'prompt', context, 'resposta', [1, 0]);
    assert.equal((await store.statistics()).total, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('falha em tempo finito para lock ativo', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-dev-assistant-store-'));
  try {
    const path = join(directory, 'knowledge-v1.json'); await writeFile(`${path}.lock`, 'ativo');
    const store = new FileLocalMemoryStore(path, undefined, { lockTimeoutMs: 20, lockRetryDelayMs: 1, staleLockAgeMs: 60_000 });
    await assert.rejects(store.save('Prompt', 'prompt', context, 'resposta', [1, 0]), /ocupada/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('libera o lock após erro e permite nova operação', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-dev-assistant-store-'));
  try {
    const path = join(directory, 'knowledge-v1.json'); const store = new FileLocalMemoryStore(path);
    await assert.rejects(store.save('Erro', 'erro', context, 'resposta', []), /embedding/);
    await store.save('Válido', 'válido', context, 'resposta', [1, 0]);
    assert.equal((await store.statistics()).total, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('ignora temporário abandonado e nunca o interpreta como memória', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-dev-assistant-store-'));
  try {
    const path = join(directory, 'knowledge-v1.json'); const temporary = `${path}.abandoned.tmp`;
    await writeFile(temporary, '{não é memória');
    const store = new FileLocalMemoryStore(path);
    assert.equal((await store.statistics()).total, 0);
    await store.save('Válido', 'válido', context, 'resposta', [1, 0]);
    assert.equal(await readFile(temporary, 'utf8'), '{não é memória');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

function sequenceClock(): () => Date {
  let milliseconds = 0;
  return () => new Date(Date.UTC(2026, 0, 1, 0, 0, 0, milliseconds++));
}

async function recoverCorruption(path: string, now: () => Date): Promise<void> {
  await writeFile(path, '{corrompido');
  await new FileLocalMemoryStore(path, now).statistics();
}

async function corruptionBackups(directory: string): Promise<string[]> {
  return (await readdir(directory)).filter((name) => /^knowledge-v1\.corrupt\.\d{8}T\d{9}Z\.[0-9a-f-]+\.json$/.test(name)).sort();
}

test('dois stores não perdem atualizações concorrentes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-dev-assistant-store-'));
  try {
    const path = join(directory, 'knowledge-v1.json'); const left = new FileLocalMemoryStore(path); const right = new FileLocalMemoryStore(path);
    await Promise.all([left.save('Prompt A', 'prompt a', context, 'A', [1, 0]), right.save('Prompt B', 'prompt b', context, 'B', [0, 1])]);
    assert.equal((await left.statistics()).total, 2);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('preserva a solicitação original e recupera exact, variação trivial e paráfrase de pom.xml', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-dev-assistant-store-'));
  try {
    const path = join(directory, 'knowledge-v1.json');
    const service = new LocalMemoryService(
      new FileLocalMemoryStore(path),
      { async generate(): Promise<readonly number[]> { return [1, 0]; } },
      { async capture() { return context; } },
    );
    const originalRequest = 'Localize o pom.xml e me mostre as dependências principais';
    await service.save(originalRequest, 'Dependências principais do projeto');

    const persisted = JSON.parse(await readFile(path, 'utf8')) as { schemaVersion: number; entries: { originalRequest: string; normalizedPrompt: string }[] };
    assert.equal(persisted.schemaVersion, 2);
    assert.equal(persisted.entries[0]?.originalRequest, originalRequest);
    assert.equal(persisted.entries[0]?.normalizedPrompt, normalizePrompt(originalRequest));
    assert.equal((await service.search(originalRequest)).matchType, 'FULL');
    assert.equal((await service.search(' Localize o pom.xml e me mostre as dependências principais ')).matchType, 'FULL');
    assert.equal((await service.search('Localize o pom.xml e as dependências principais')).matchType, 'FULL');
    assert.equal((await service.search('Quais são as principais bibliotecas Maven utilizadas neste projeto?')).matchType, 'FULL');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('migra schema v1 preservando conhecimento e usando normalizedPrompt como fallback de originalRequest', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-dev-assistant-store-'));
  try {
    const path = join(directory, 'knowledge-v1.json');
    await writeFile(path, JSON.stringify({ schemaVersion: 1, revision: 3, entries: [{
      id: 'legacy', normalizedPrompt: 'conhecimento sobre pom.xml', contextKey: JSON.stringify({ buildTool: 'NPM', frameworks: [], languages: [{ name: 'NODE', version: '22' }] }), response: 'preservada', createdAt: '2026-01-01T00:00:00.000Z', lastUsedAt: '2026-01-01T00:00:00.000Z', reuseCount: 0, embedding: [1, 0],
    }] }));
    const store = new FileLocalMemoryStore(path);
    const legacy = await store.findExact('conhecimento sobre pom.xml', context);
    assert.equal(legacy?.originalRequest, 'conhecimento sobre pom.xml');
    const migrated = JSON.parse(await readFile(path, 'utf8')) as { schemaVersion: number; entries: { originalRequest: string }[] };
    assert.equal(migrated.schemaVersion, 2);
    assert.equal(migrated.entries[0]?.originalRequest, 'conhecimento sobre pom.xml');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
