import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);

test('AUD-13: agrega pares A/B, ordem alternada e separa estimativa local de faturamento', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-dev-assistant-aud13-'));
  try {
    const rows = [
      { runId: 'r1', taskId: 't1', modelId: 'model-x', contextId: 'ctx-1', scenario: 'A', order: 1, latencyMs: 100, copilotCalls: 2, memorySearchCalls: 0, memoryMatch: 'NONE', request: 'tarefa', response: 'solução nova', effectiveReuse: false, qualityPreserved: true },
      { runId: 'r2', taskId: 't1', modelId: 'model-x', contextId: 'ctx-1', scenario: 'B', order: 1, latencyMs: 70, copilotCalls: 1, memorySearchCalls: 1, memoryMatch: 'FULL', request: 'tarefa', response: 'solução reutilizada', effectiveReuse: true, qualityPreserved: true },
      { runId: 'r3', taskId: 't1', modelId: 'model-x', contextId: 'ctx-1', scenario: 'B', order: 2, latencyMs: 80, copilotCalls: 1, memorySearchCalls: 1, memoryMatch: 'PARTIAL', request: 'tarefa', response: 'solução adaptada', effectiveReuse: true, qualityPreserved: true },
      { runId: 'r4', taskId: 't1', modelId: 'model-x', contextId: 'ctx-1', scenario: 'A', order: 2, latencyMs: 110, copilotCalls: 2, memorySearchCalls: 0, memoryMatch: 'NONE', request: 'tarefa', response: 'solução nova', effectiveReuse: false, qualityPreserved: true },
    ];
    const input = join(directory, 'runs.jsonl');
    const output = join(directory, 'result.json');
    await writeFile(input, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
    await execFileAsync(process.execPath, [resolve('..', 'scripts', 'measure-copilot-memory-reuse.mjs'), input, output], { cwd: resolve('.') });
    const report = JSON.parse(await readFile(output, 'utf8')) as { methodology: { alternatingOrder: boolean }; effectiveReuseCount: number; billedSavingsPercent: number | null; scenarioA: { copilotCalls: number }; scenarioB: { copilotCalls: number } };
    assert.equal(report.methodology.alternatingOrder, true);
    assert.equal(report.effectiveReuseCount, 2);
    assert.equal(report.scenarioA.copilotCalls, 4);
    assert.equal(report.scenarioB.copilotCalls, 2);
    assert.equal(report.billedSavingsPercent, null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
