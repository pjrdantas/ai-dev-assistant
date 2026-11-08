import { readFile, writeFile } from 'node:fs/promises';

const MATCHES = new Set(['FULL', 'PARTIAL', 'NONE']);
const SCENARIOS = new Set(['A', 'B']);

export function estimateLocalTokens(text) {
  const bytes = Buffer.byteLength(String(text ?? '').trim(), 'utf8');
  return bytes === 0 ? 0 : Math.ceil(bytes / 4);
}

function requiredString(row, field) {
  if (typeof row[field] !== 'string' || row[field].trim() === '') throw new Error(`Campo obrigatório inválido: ${field}`);
  return row[field];
}

function requiredNumber(row, field) {
  if (!Number.isFinite(row[field]) || row[field] < 0) throw new Error(`Campo numérico inválido: ${field}`);
  return row[field];
}

function normalize(row, line) {
  const scenario = requiredString(row, 'scenario');
  if (!SCENARIOS.has(scenario)) throw new Error(`Linha ${line}: scenario deve ser A ou B`);
  const match = requiredString(row, 'memoryMatch');
  if (!MATCHES.has(match)) throw new Error(`Linha ${line}: memoryMatch deve ser FULL, PARTIAL ou NONE`);
  const request = requiredString(row, 'request');
  const response = requiredString(row, 'response');
  const normalized = {
    runId: requiredString(row, 'runId'), taskId: requiredString(row, 'taskId'), modelId: requiredString(row, 'modelId'),
    contextId: requiredString(row, 'contextId'), scenario, order: requiredNumber(row, 'order'), latencyMs: requiredNumber(row, 'latencyMs'),
    copilotCalls: requiredNumber(row, 'copilotCalls'), memorySearchCalls: requiredNumber(row, 'memorySearchCalls'), memoryMatch: match,
    effectiveReuse: row.effectiveReuse === true, qualityPreserved: row.qualityPreserved === true,
    estimatedRequestTokens: row.estimatedRequestTokens ?? estimateLocalTokens(request),
    estimatedResponseTokens: row.estimatedResponseTokens ?? estimateLocalTokens(response),
    officialUsage: row.officialUsage ?? null,
  };
  for (const field of ['estimatedRequestTokens', 'estimatedResponseTokens']) requiredNumber(normalized, field);
  if (normalized.officialUsage !== null && typeof normalized.officialUsage !== 'object') throw new Error(`Linha ${line}: officialUsage inválido`);
  return normalized;
}

export function aggregateRuns(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('É necessário fornecer múltiplas execuções A/B.');
  const normalized = rows.map((row, index) => normalize(row, index + 1));
  const groups = new Map();
  for (const row of normalized) {
    const key = `${row.taskId}\u0000${row.modelId}\u0000${row.contextId}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const pairs = [];
  for (const [key, group] of groups) {
    const a = group.filter((row) => row.scenario === 'A');
    const b = group.filter((row) => row.scenario === 'B');
    if (a.length === 0 || b.length === 0) throw new Error(`Par A/B incompleto para ${key.replaceAll('\u0000', '/')}`);
    if (a.length !== b.length) throw new Error(`Quantidade A/B desigual para ${key.replaceAll('\u0000', '/')}`);
    pairs.push({ key, executions: group.length, scenarioA: a.length, scenarioB: b.length, orders: [...new Set(group.map((row) => row.order))].sort((x, y) => x - y) });
  }
  const orderCounts = new Map();
  for (const pair of pairs) {
    for (const row of normalized.filter((item) => item.taskId + '\u0000' + item.modelId + '\u0000' + item.contextId === pair.key)) {
      const orderKey = `${pair.key}\u0000${row.order}`;
      const counts = orderCounts.get(orderKey) ?? { A: 0, B: 0 };
      counts[row.scenario] += 1;
      orderCounts.set(orderKey, counts);
    }
  }
  const alternating = [...orderCounts.values()].every((counts) => counts.A > 0 && counts.B > 0);
  const summarize = (scenario) => {
    const selected = normalized.filter((row) => row.scenario === scenario);
    const total = (field) => selected.reduce((sum, row) => sum + row[field], 0);
    const estimate = total('estimatedRequestTokens') + total('estimatedResponseTokens');
    const official = selected.every((row) => row.officialUsage?.totalTokens !== undefined);
    return {
      executions: selected.length, latencyMs: { total: total('latencyMs'), average: selected.length ? total('latencyMs') / selected.length : 0 },
      copilotCalls: total('copilotCalls'), memorySearchCalls: total('memorySearchCalls'), estimatedLocalTokens: estimate,
      officialTokenTotalsAvailable: official,
      officialTokenTotal: official ? selected.reduce((sum, row) => sum + row.officialUsage.totalTokens, 0) : null,
    };
  };
  const scenarioA = summarize('A');
  const scenarioB = summarize('B');
  const reusable = normalized.filter((row) => row.scenario === 'B' && row.effectiveReuse && row.qualityPreserved && row.memoryMatch !== 'NONE').length;
  const localSavings = scenarioA.estimatedLocalTokens > 0 ? ((scenarioA.estimatedLocalTokens - scenarioB.estimatedLocalTokens) / scenarioA.estimatedLocalTokens) * 100 : null;
  const officialSavings = scenarioA.officialTokenTotal !== null && scenarioB.officialTokenTotal !== null
    ? ((scenarioA.officialTokenTotal - scenarioB.officialTokenTotal) / scenarioA.officialTokenTotal) * 100 : null;
  return {
    schemaVersion: 1, generatedAt: new Date().toISOString(), methodology: { sameModelTaskContext: true, multipleExecutions: true, alternatingOrder: alternating, noExternalServices: true },
    pairs, scenarioA, scenarioB, effectiveReuseCount: reusable,
    estimatedLocalSavingsPercent: localSavings, billedSavingsPercent: officialSavings,
    billingStatus: officialSavings === null ? 'NOT_AVAILABLE_FROM_OFFICIAL_SOURCE' : 'CALCULATED_FROM_SUPPLIED_OFFICIAL_USAGE',
    limitations: ['Local token counts are byte/4 estimates and are not GitHub Copilot billing.', 'Exact Copilot model tokens, credits and billed cost remain unavailable unless an official export is supplied per run.'],
  };
}

async function main() {
  const input = process.argv[2];
  const output = process.argv[3] ?? 'AUD_13_TOKEN_ECONOMY_RESULTS.json';
  if (input === undefined) throw new Error('Uso: node scripts/measure-copilot-memory-reuse.mjs <runs.jsonl> [output.json]');
  const rows = (await readFile(input, 'utf8')).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  await writeFile(output, `${JSON.stringify(aggregateRuns(rows), null, 2)}\n`, 'utf8');
}

if (process.argv[1]?.endsWith('measure-copilot-memory-reuse.mjs')) await main();
