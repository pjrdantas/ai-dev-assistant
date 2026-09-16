import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ProjectContext } from '../src/contracts.js';
import { LocalEmbeddingProvider } from '../src/localEmbeddingProvider.js';
import { LocalMemoryService, SEMANTIC_DEDUPLICATION_THRESHOLD } from '../src/localMemoryService.js';
import { FileLocalMemoryStore, LocalKnowledge, LocalMemoryMatch, LocalMemoryStore } from '../src/localMemoryStore.js';
import { MongoMemoryUnavailableError } from '../src/mongoConnectionManager.js';

test('persiste, deduplica e registra reuso de conhecimento exato', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-dev-assistant-memory-'));
  try {
    const store = new FileLocalMemoryStore(join(directory, 'knowledge-v1.json'));
    const service = new LocalMemoryService(store, embeddings(), contextProvider(javaContext('21')));
    const first = await service.save('Explique endpoint REST', 'Resposta reutilizável');
    const second = await service.save('Explique endpoint REST', 'Resposta diferente ignorada pela deduplicação');
    const result = await service.search('Explique endpoint REST');

    assert.equal(first.reusedExistingKnowledge, false);
    assert.equal(second.reusedExistingKnowledge, true);
    assert.equal(result.matchType, 'FULL');
    assert.equal(result.memoryId, first.memoryId);
    assert.equal(result.reusableSolution, 'Resposta reutilizável');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('um exact match não inicializa o provider de embedding', async () => {
  let embeddingCalls = 0;
  const exact = knowledge('exact', 'Solução exata');
  const service = new LocalMemoryService(
    {
      async findExact(): Promise<LocalKnowledge> { return exact; },
      async findSimilar(): Promise<readonly LocalMemoryMatch[]> { return []; },
      async registerReuse(): Promise<LocalKnowledge> { return exact; },
      async save(): Promise<LocalKnowledge> { return exact; },
    },
    { async generate(): Promise<readonly number[]> { embeddingCalls += 1; return [1, 0]; } },
    contextProvider(javaContext('21')),
  );

  const result = await service.search('Solicitação já conhecida');

  assert.equal(result.matchType, 'FULL');
  assert.equal(embeddingCalls, 0);
});

test('deduplica semanticamente após exact miss e reutiliza um único embedding', async () => {
  const duplicate = knowledge('duplicate', 'Solução anterior'); let generated = 0; let replaced = 0;
  const service = new LocalMemoryService({
    async findExact(): Promise<undefined> { return undefined; },
    async findSimilar(): Promise<readonly LocalMemoryMatch[]> { return [match(duplicate, 0.98, true)]; },
    async registerReuse(): Promise<LocalKnowledge> { return duplicate; },
    async save(): Promise<LocalKnowledge> { throw new Error('não deve inserir'); },
    async replace(): Promise<LocalKnowledge> { replaced += 1; return duplicate; },
  }, { async generate(): Promise<readonly number[]> { generated += 1; return [1, 0]; } }, contextProvider(javaContext('21')));
  const result = await service.save('prompt semanticamente equivalente', 'Solução corrigida');
  assert.equal(result.reusedExistingKnowledge, true); assert.equal(generated, 1); assert.equal(replaced, 1);
});

test('recupera o exemplo real do pom.xml como PARTIAL quando a similaridade satisfaz o threshold', async () => {
  const stored = knowledge('pom', 'Dependências principais do pom.xml');
  const diagnostics: object[] = [];
  const service = new LocalMemoryService(
    memory({ matches: [match(stored, 0.772113440972, true)] }), embeddings(), contextProvider(javaContext('21')),
    (diagnostic) => diagnostics.push(diagnostic),
  );

  const result = await service.search('procure na memória local conhecimento relacionado ao pom.xml deste projeto');

  assert.equal(result.matchType, 'PARTIAL');
  assert.equal(result.memoryId, 'pom');
  assert.deepEqual(diagnostics, [{
    normalizedPrompt: 'procure na memória local conhecimento relacionado ao pom.xml deste projeto',
    candidates: [{ memoryId: 'pom', similarity: 0.772113440972, contextCompatible: true }],
    matchType: 'PARTIAL', reason: 'SEMANTIC_PARTIAL', selectedMemoryId: 'pom',
  }]);
});

test('deduplica as duas formulações reais de pom.xml no mesmo contexto a partir da similaridade calibrada', async () => {
  const duplicate = knowledge('pom', 'Solução anterior'); let replaced = 0;
  const service = new LocalMemoryService({
    async findExact(): Promise<undefined> { return undefined; },
    async findSimilar(): Promise<readonly LocalMemoryMatch[]> { return [match(duplicate, 0.850090208950, true)]; },
    async registerReuse(): Promise<LocalKnowledge> { return duplicate; },
    async save(): Promise<LocalKnowledge> { throw new Error('não deve inserir duplicata'); },
    async replace(): Promise<LocalKnowledge> { replaced += 1; return duplicate; },
  }, embeddings(), contextProvider(javaContext('21')));

  const result = await service.save('Registrar conhecimento reutilizável sobre o pom.xml do projeto desafio-votacao-apenas service.', 'Solução atualizada');

  assert.equal(SEMANTIC_DEDUPLICATION_THRESHOLD, 0.85);
  assert.equal(result.reusedExistingKnowledge, true);
  assert.equal(replaced, 1);
});

test('seleciona o melhor candidato compatível para FULL mesmo que outro incompatível seja mais similar', async () => {
  const compatible = knowledge('compatible', 'Solução compatível');
  const incompatible = knowledge('incompatible', 'Solução incompatível');
  let reusedId: string | undefined;
  const service = new LocalMemoryService(
    memory({
      matches: [match(incompatible, 0.94, false), match(compatible, 0.92, true)],
      onReuse: (id) => { reusedId = id; return id === compatible.id ? compatible : incompatible; },
    }),
    embeddings(),
    contextProvider(javaContext('21')),
  );

  const result = await service.search('Como atualizar endpoint?');

  assert.equal(result.matchType, 'FULL');
  assert.equal(result.memoryId, compatible.id);
  assert.equal(result.similarity, 0.92);
  assert.equal(reusedId, compatible.id);
});

test('retorna PARTIAL para conhecimento relevante incompatível e NONE sem candidato suficiente', async () => {
  const incompatible = knowledge('incompatible', 'Solução de outra versão');
  const partialService = new LocalMemoryService(
    memory({ matches: [match(incompatible, 0.80, false)] }), embeddings(), contextProvider(javaContext('21')),
  );
  const noneService = new LocalMemoryService(memory({ matches: [] }), embeddings(), contextProvider(javaContext('21')));

  const partial = await partialService.search('Como atualizar endpoint?');
  const none = await noneService.search('Como atualizar endpoint?');

  assert.deepEqual(partial, {
    matchType: 'PARTIAL', similarity: 0.80, contextCompatible: false,
    memoryId: incompatible.id, reusableSolution: incompatible.response,
  });
  assert.deepEqual(none, { matchType: 'NONE', contextCompatible: false });
});

test('bloqueia segredo, falha de embedding e falha de armazenamento', async () => {
  const healthy = new LocalMemoryService(memory({ matches: [] }), embeddings(), contextProvider(javaContext('21')));
  await assert.rejects(() => healthy.search('ghp_abcdefghijklmnopqrstuvwxyz123456'), /sensível/);

  const embeddingFailure = new LocalMemoryService(
    memory({ matches: [] }), { async generate() { throw new Error('model unavailable'); } }, contextProvider(javaContext('21')),
  );
  await assert.rejects(() => embeddingFailure.search('Pergunta segura'), /model unavailable/);

  const storageFailure = new LocalMemoryService(
    memory({ matches: [], failSave: true }), embeddings(), contextProvider(javaContext('21')),
  );
  await assert.rejects(() => storageFailure.save('Pergunta segura', 'Solução segura'), /storage unavailable/);
});

test('MongoDB indisponível não impede o agent loop de receber estado claro', async () => {
  const unavailable = new LocalMemoryService({
    async findExact(): Promise<undefined> { throw new MongoMemoryUnavailableError(new Error('connection refused')); },
    async findSimilar(): Promise<readonly LocalMemoryMatch[]> { return []; },
    async registerReuse(): Promise<undefined> { return undefined; },
    async save(): Promise<LocalKnowledge> { throw new MongoMemoryUnavailableError(new Error('connection refused')); },
  }, embeddings(), contextProvider(javaContext('21')));

  assert.deepEqual(await unavailable.search('Pergunta técnica'), { matchType: 'NONE', contextCompatible: false, memoryUnavailable: true });
  assert.deepEqual(await unavailable.save('Pergunta técnica', 'Solução'), { memoryId: '', reusedExistingKnowledge: false, memoryUnavailable: true });
});

function javaContext(version: string): ProjectContext {
  return { languages: [{ name: 'JAVA', version }], frameworks: [{ name: 'SPRING_BOOT', version: '4.1.1' }], buildTool: 'MAVEN' };
}

function contextProvider(context: ProjectContext) {
  return { async capture(): Promise<ProjectContext> { return context; } };
}

function embeddings(): LocalEmbeddingProvider {
  return { async generate(): Promise<readonly number[]> { return [1, 0]; } };
}

function knowledge(id: string, response: string): LocalKnowledge {
  return { id, originalRequest: 'prompt', normalizedPrompt: 'prompt', contextKey: 'context', response, createdAt: '2026-09-14T00:00:00.000Z', lastUsedAt: '2026-09-14T00:00:00.000Z', reuseCount: 0, embedding: [1, 0] };
}

function match(knowledgeEntry: LocalKnowledge, similarity: number, contextCompatible: boolean): LocalMemoryMatch {
  return { knowledge: knowledgeEntry, similarity, contextCompatible };
}

function memory(options: {
  readonly matches: readonly LocalMemoryMatch[];
  readonly onReuse?: (id: string) => LocalKnowledge;
  readonly failSave?: boolean;
}): LocalMemoryStore {
  return {
    async findExact(): Promise<undefined> { return undefined; },
    async findSimilar(): Promise<readonly LocalMemoryMatch[]> { return options.matches; },
    async registerReuse(id: string): Promise<LocalKnowledge> { return options.onReuse?.(id) ?? knowledge(id, 'Resposta'); },
    async save(): Promise<LocalKnowledge> {
      if (options.failSave) {
        throw new Error('storage unavailable');
      }
      return knowledge('stored', 'Resposta');
    },
  };
}
