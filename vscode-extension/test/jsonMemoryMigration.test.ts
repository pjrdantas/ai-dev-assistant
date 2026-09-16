import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { migrateJsonMemory } from '../src/jsonMemoryMigration.js';
import { LocalKnowledge } from '../src/localMemoryStore.js';

test('migra JSON para destino idempotente e preserva o arquivo histórico', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-dev-assistant-migration-'));
  try {
    const path = join(directory, 'knowledge-v1.json');
    const source = { schemaVersion: 2, revision: 1, entries: [entry('legacy-memory')] };
    await writeFile(path, JSON.stringify(source));
    const stored = new Map<string, LocalKnowledge>();
    const target = {
      async upsertMigrated(value: LocalKnowledge): Promise<void> { stored.set(value.id, value); },
      async countByIds(ids: readonly string[]): Promise<number> { return ids.filter((id) => stored.has(id)).length; },
    };

    const first = await migrateJsonMemory(path, target);
    const second = await migrateJsonMemory(path, target);

    assert.deepEqual(first, { status: 'MIGRATED', migrated: 1, sourceEntries: 1 });
    assert.deepEqual(second, { status: 'MIGRATED', migrated: 1, sourceEntries: 1 });
    assert.equal(stored.size, 1);
    assert.equal(stored.get('legacy-memory')?.originalRequest, 'Solicitação original');
    assert.equal(await readFile(path, 'utf8'), JSON.stringify(source));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('arquivo legado ausente retorna NOTHING_TO_MIGRATE sem alterar destino', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-dev-assistant-migration-'));
  try {
    let writes = 0;
    const result = await migrateJsonMemory(join(directory, 'knowledge-v1.json'), {
      async upsertMigrated(): Promise<void> { writes += 1; },
      async countByIds(): Promise<number> { return 0; },
    });
    assert.deepEqual(result, { status: 'NOTHING_TO_MIGRATE', migrated: 0, sourceEntries: 0 });
    assert.equal(writes, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('JSON inválido e erro de filesystem diferente de ENOENT continuam visíveis', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-dev-assistant-migration-'));
  try {
    const invalid = join(directory, 'knowledge-v1.json');
    await writeFile(invalid, '{invalid');
    const target = { async upsertMigrated(): Promise<void> {}, async countByIds(): Promise<number> { return 0; } };
    await assert.rejects(() => migrateJsonMemory(invalid, target));
    await assert.rejects(() => migrateJsonMemory(directory, target), /EISDIR/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

function entry(id: string): LocalKnowledge {
  return { id, originalRequest: 'Solicitação original', normalizedPrompt: 'solicitação original', contextKey: 'context', response: 'Solução', embedding: [1, 0], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', lastUsedAt: '2026-01-01T00:00:00.000Z', reuseCount: 2 };
}
