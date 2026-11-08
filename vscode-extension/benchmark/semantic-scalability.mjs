import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { writeFile } from 'node:fs/promises';
import { BSON } from 'mongodb';

const OUT = process.env.BENCHMARK_OUTPUT ?? 'AUD_10_SEMANTIC_SCALABILITY_RESULTS.json';
const { createBenchmarkMongoClient, validateBenchmarkMongoUri } = await import(new URL('../out/src/benchmarkMongoConfiguration.js', import.meta.url));
const URI = validateBenchmarkMongoUri(process.env.MONGODB_URI);
const DIMENSION = 384;
const WORKSPACE_A = 'workspace-a';
const WORKSPACE_B = 'workspace-b';
const SIZES = [100, 1000, 10000];
const SAMPLES = 11;

const { MongoConnectionManager } = await import(new URL('../out/src/mongoConnectionManager.js', import.meta.url));
const { MongoMemoryStore } = await import(new URL('../out/src/mongoMemoryStore.js', import.meta.url));
const { OnnxLocalEmbeddingProvider } = await import(new URL('../out/src/localEmbeddingProvider.js', import.meta.url));
const { isDeduplicationMatch, memoryScope, projectContextKey } = await import(new URL('../out/src/localMemoryStore.js', import.meta.url));

function vectorFor(seed, offset = 0) {
  const hash = createHash('sha256').update(`${seed}:${offset}`).digest();
  const vector = Array.from({ length: DIMENSION }, (_, index) => Math.sin(((hash[index % hash.length] ?? 0) + 1) * (index + 1) * 0.017 + offset * 0.13));
  const norm = Math.hypot(...vector);
  return vector.map((value) => value / norm);
}

function representativeVector(index) {
  const topic = ['maven dependencies', 'angular cpf login', 'terraform ecs health check', 'typescript tests'][index % 4];
  const base = vectorFor(topic);
  const noise = vectorFor(`example:${index}`, index % 11);
  const mixed = base.map((value, dimension) => value * 0.96 + (noise[dimension] ?? 0) * 0.04);
  const norm = Math.hypot(...mixed);
  return mixed.map((value) => value / norm);
}

function documentFor(index) {
  const workspace = index % 10 < 2 ? WORKSPACE_A : index % 10 === 2 ? WORKSPACE_B : undefined;
  const shared = workspace === undefined;
  return {
    _id: `synthetic-${index}`, schemaVersion: 2,
    originalRequest: `Representativo: ${['Maven dependencies', 'Angular CPF login', 'Terraform ECS health check', 'TypeScript tests'][index % 4]} #${index}`,
    normalizedPrompt: `synthetic prompt ${index}`, contextKey: index % 7 === 0 ? 'context-b' : 'context-a',
    response: `Synthetic reusable response ${index}`, embedding: representativeVector(index), active: index % 97 !== 0,
    createdAt: new Date(1700000000000 + index), updatedAt: new Date(1700000000000 + index), lastUsedAt: new Date(1700000000000 + index), reuseCount: 0,
    provenance: shared ? 'MANUAL' : 'AUTO_PROMOTED', scope: shared ? 'SHARED' : 'WORKSPACE', ...(workspace === undefined ? {} : { workspaceKey: workspace }),
  };
}

async function insertSynthetic(collection, size) {
  for (let start = 0; start < size; start += 1000) {
    await collection.insertMany(Array.from({ length: Math.min(1000, size - start) }, (_, offset) => documentFor(start + offset)), { ordered: false });
  }
}

function accessibleFilter(lookup) {
  return { $or: [{ provenance: { $exists: false } }, { provenance: 'LEGACY' }, { scope: 'SHARED' }, ...(lookup.workspaceKey === undefined ? [] : [{ scope: 'WORKSPACE', workspaceKey: lookup.workspaceKey }])] };
}

function dedupFilter(options) {
  return { provenance: options.provenance, scope: options.scope, ...(options.workspaceKey === undefined ? { $or: [{ workspaceKey: { $exists: false } }, { workspaceKey: null }] } : { workspaceKey: options.workspaceKey }) };
}

function findQuery(lookup, pushdown) {
  const predicates = [accessibleFilter(lookup)];
  if (pushdown && lookup.deduplication !== undefined) predicates.push(dedupFilter(lookup.deduplication));
  return { active: true, embedding: { $exists: true }, $and: predicates };
}

function cosine(left, right) {
  let dot = 0; let leftNorm = 0; let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index]; leftNorm += left[index] ** 2; rightNorm += right[index] ** 2;
  }
  return Math.max(-1, Math.min(1, dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm))));
}

function mapSynthetic(document) {
  return { id: document._id, contextKey: document.contextKey, response: document.response, embedding: document.embedding, provenance: document.provenance ?? 'LEGACY', scope: document.scope ?? 'LEGACY_UNSCOPED', workspaceKey: document.workspaceKey ?? undefined };
}

function priority(entry, lookup) {
  return lookup.workspaceKey !== undefined && memoryScope(entry) === 'WORKSPACE' && entry.workspaceKey === lookup.workspaceKey ? 2 : memoryScope(entry) === 'SHARED' ? 1 : 0;
}

async function oldFindSimilar(collection, embedding, context, lookup) {
  const contextKey = projectContextKey(context);
  const documents = await collection.find(findQuery(lookup, false)).toArray();
  return documents
    .filter((document) => isDeduplicationMatch(mapSynthetic(document), lookup))
    .filter((document) => document.embedding?.length === embedding.length)
    .map((document) => ({ knowledge: mapSynthetic(document), similarity: cosine(embedding, document.embedding), contextCompatible: document.contextKey === contextKey }))
    .sort((left, right) => priority(right.knowledge, lookup) - priority(left.knowledge, lookup) || right.similarity - left.similarity || left.knowledge.id.localeCompare(right.knowledge.id));
}

function instrument(client) {
  const state = { documents: 0, bytes: 0, findCommands: 0, getMoreCommands: 0 };
  const handler = (event) => {
    if (event.commandName !== 'find' && event.commandName !== 'getMore') return;
    if (event.commandName === 'find') state.findCommands += 1;
    if (event.commandName === 'getMore') state.getMoreCommands += 1;
    const batch = event.reply?.cursor?.firstBatch ?? event.reply?.cursor?.nextBatch ?? [];
    state.documents += batch.length;
    state.bytes += batch.reduce((sum, document) => sum + BSON.calculateObjectSize(document), 0);
  };
  client.on('commandSucceeded', handler);
  return { state, stop: () => client.off('commandSucceeded', handler) };
}

async function explain(collection, lookup, pushdown) {
  const stats = (await collection.find(findQuery(lookup, pushdown)).explain('executionStats')).executionStats ?? {};
  return { nReturned: stats.nReturned, totalDocsExamined: stats.totalDocsExamined, totalKeysExamined: stats.totalKeysExamined, executionTimeMillis: stats.executionTimeMillis };
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] ?? 0;
}

async function measure(operation) {
  const elapsed = []; let value; let maxHeapUsed = 0; const cpuStart = process.cpuUsage();
  for (let index = 0; index < SAMPLES; index += 1) {
    const start = performance.now(); value = await operation(); elapsed.push(performance.now() - start); maxHeapUsed = Math.max(maxHeapUsed, process.memoryUsage().heapUsed);
  }
  const cpu = process.cpuUsage(cpuStart);
  return { p50Ms: percentile(elapsed, 0.5), p95Ms: percentile(elapsed, 0.95), samplesMs: elapsed, value, cpuMicrosUser: cpu.user, cpuMicrosSystem: cpu.system, processHeapUsedMaxBytes: maxHeapUsed };
}

async function main() {
  const results = { generatedAt: new Date().toISOString(), uri: URI.replace(/\/\/[^@/]*@/, '//***@'), dimension: DIMENSION, samples: SAMPLES, acceptanceCriteria: { sizes: [100, 1000, 10000], noArbitraryQueryLimit: true, deterministicTopK: true, documentsExaminedAndPeakMemoryRecorded: true, cpuNote: 'O ranqueamento local continua O(n); não declarar escalabilidade irrestrita.' }, percentiles: 'p50=ordem estatística 0.50; p95=ordem estatística 0.95 sobre amostras completas', sizes: [], embedding: {}, environment: { node: process.version, platform: process.platform } };
  const embeddingProvider = new OnnxLocalEmbeddingProvider(new URL('../models/paraphrase-multilingual-minilm/', import.meta.url).pathname.replace(/^\/(?:([A-Za-z]):)/, '$1:').replaceAll('/', '\\'));
  const coldStart = process.hrtime.bigint(); await embeddingProvider.generate('Localize o pom.xml e explique as dependências Maven reutilizáveis.');
  const coldMs = Number(process.hrtime.bigint() - coldStart) / 1e6;
  const warm = await measure(() => embeddingProvider.generate('Como atualizar o endpoint de votação sem quebrar os testes?'));
  results.embedding = { coldMs, warmP50Ms: warm.p50Ms, warmP95Ms: warm.p95Ms, dimensions: (await embeddingProvider.generate('dimensão')).length };

  for (const size of SIZES) {
    const dbName = `ai_dev_assistant_benchmark_e3_004_${process.pid}_${size}_${Date.now()}`;
    const client = createBenchmarkMongoClient(URI); await client.connect();
    try {
      const connection = new MongoConnectionManager({ uri: URI, database: dbName }, () => client);
      await connection.ensureIndexes();
      const db = client.db(dbName); const collection = db.collection('memories');
      const insertStart = performance.now(); await insertSynthetic(collection, size); const insertMs = performance.now() - insertStart;
      const store = new MongoMemoryStore(connection);
      const queryEmbedding = representativeVector(17); const context = { buildTool: 'Maven', frameworks: [{ name: 'Spring Boot', version: '3' }], languages: [{ name: 'JAVA', version: '21' }] };
      const normalInstrumentation = instrument(client); const normal = await measure(() => store.findSimilar(queryEmbedding, context, { workspaceKey: WORKSPACE_A })); normalInstrumentation.stop();
      const lookup = { workspaceKey: WORKSPACE_A, deduplication: { provenance: 'AUTO_PROMOTED', scope: 'WORKSPACE', workspaceKey: WORKSPACE_A } };
      const beforeInstrumentation = instrument(client); const before = await measure(() => oldFindSimilar(collection, queryEmbedding, context, lookup)); beforeInstrumentation.stop();
      const afterInstrumentation = instrument(client); const after = await measure(() => store.findSimilar(queryEmbedding, context, lookup)); afterInstrumentation.stop();
      const normalExplain = await explain(collection, { workspaceKey: WORKSPACE_A }, false);
      const beforeExplain = await explain(collection, lookup, false);
      const afterExplain = await explain(collection, lookup, true);
      const beforeTopIds = before.value.slice(0, after.value.length).map((match) => match.knowledge.id); const afterIds = after.value.map((match) => match.knowledge.id);
      results.sizes.push({ size, insertMs, normal: { p50Ms: normal.p50Ms, p95Ms: normal.p95Ms, candidatesReturned: normalExplain.nReturned, topK: normal.value.length, documentsTransferred: normalInstrumentation.state.documents, bytesTransferred: normalInstrumentation.state.bytes, cpuMicrosUser: normal.cpuMicrosUser, cpuMicrosSystem: normal.cpuMicrosSystem, processHeapUsedMaxBytes: normal.processHeapUsedMaxBytes, explain: normalExplain }, deduplicationBefore: { p50Ms: before.p50Ms, p95Ms: before.p95Ms, candidatesReturned: before.value.length, topK: before.value.slice(0, after.value.length).length, documentsTransferred: beforeInstrumentation.state.documents, bytesTransferred: beforeInstrumentation.state.bytes, cpuMicrosUser: before.cpuMicrosUser, cpuMicrosSystem: before.cpuMicrosSystem, processHeapUsedMaxBytes: before.processHeapUsedMaxBytes, explain: beforeExplain }, deduplicationAfter: { p50Ms: after.p50Ms, p95Ms: after.p95Ms, candidatesReturned: afterExplain.nReturned, topK: after.value.length, documentsTransferred: afterInstrumentation.state.documents, bytesTransferred: afterInstrumentation.state.bytes, cpuMicrosUser: after.cpuMicrosUser, cpuMicrosSystem: after.cpuMicrosSystem, processHeapUsedMaxBytes: after.processHeapUsedMaxBytes, explain: afterExplain }, equivalence: { sameTopKIds: JSON.stringify(beforeTopIds) === JSON.stringify(afterIds), beforeTopIds, afterIds, sameTopKCount: beforeTopIds.length === afterIds.length } });
      await db.dropDatabase();
      await connection.close();
    } finally {
      await client.close();
    }
  }
  await writeFile(OUT, JSON.stringify(results, null, 2), 'utf8');
}

await main();
