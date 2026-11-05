import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeWorkspacePath, resolveWorkspaceOrigin, workspaceKey } from '../src/interactionCapture.js';
import { InteractionPromotionService } from '../src/interactionPromotionService.js';
import { LocalMemoryService } from '../src/localMemoryService.js';
import type { LocalKnowledge } from '../src/localMemoryStore.js';
import { manifestBelongsToWorkspaceOrigin } from '../src/interactionCapture.js';
import type { ProjectContext, ProjectContextProvider } from '../src/contracts.js';
import type { InteractionRecord } from '../src/mongoInteractionStore.js';

const contextA: ProjectContext = { languages: [{ name: 'JAVA', version: '21' }], frameworks: [{ name: 'SPRING_BOOT', version: '3.5' }], buildTool: 'MAVEN' };
const contextB: ProjectContext = { languages: [{ name: 'JAVA', version: '21' }], frameworks: [{ name: 'SPRING_BOOT', version: '3.5' }], buildTool: 'MAVEN' };

test('baseline E3-002: a seleção global reproduz a contaminação A -> B', () => {
  const a = completed('a', workspaceKey('C:/workspace-a')!);
  const b = completed('b', workspaceKey('C:/workspace-b')!);
  const claimed = [a, b].filter((entry) => entry.promotionStatus === 'PENDING').slice(0, 3);
  const memoriesWrittenUnderB = claimed.map(() => contextB);
  assert.equal(claimed[0]?.workspaceKey, workspaceKey('C:/workspace-a'));
  assert.deepEqual(memoriesWrittenUnderB[0], contextB, 'o algoritmo antigo usava o contexto capturado do workspace atual');
});

test('promove A com A aberto e deixa B pendente quando ambos estão concluídos', async () => {
  const a = completed('a', workspaceKey('C:/workspace-a')!);
  const b = completed('b', workspaceKey('C:/workspace-b')!);
  const interactions = new FakeInteractions([a, b]);
  const saved: string[] = [];
  const memory = createMemoryProvider(() => [workspaceKey('C:/workspace-a')!], contextA, saved);

  await new InteractionPromotionService(interactions as never, memory, () => [workspaceKey('C:/workspace-a')!]).promotePending();

  assert.deepEqual(saved, ['a']);
  assert.equal(interactions.record('a').promotionStatus, 'PROMOTED');
  assert.equal(interactions.record('b').promotionStatus, 'PENDING');
});

test('não promove interação sem workspace identificável', async () => {
  const interaction = completed('without-origin', undefined);
  const interactions = new FakeInteractions([interaction]);
  const saved: string[] = [];
  const memory = createMemoryProvider(() => [workspaceKey('C:/workspace-a')!], contextA, saved);

  await new InteractionPromotionService(interactions as never, memory, () => [workspaceKey('C:/workspace-a')!]).promotePending();

  assert.deepEqual(saved, []);
  assert.equal(interactions.record('without-origin').promotionStatus, 'PENDING');
});

test('duas execuções concorrentes reivindicam cada interação no máximo uma vez', async () => {
  const interactions = new FakeInteractions([
    completed('a', workspaceKey('C:/workspace-a')!),
    completed('b', workspaceKey('C:/workspace-a')!),
    completed('c', workspaceKey('C:/workspace-a')!),
  ]);
  const saved: string[] = [];
  const memory = createMemoryProvider(() => [workspaceKey('C:/workspace-a')!], contextA, saved);
  const service = new InteractionPromotionService(interactions as never, memory, () => [workspaceKey('C:/workspace-a')!]);

  await Promise.all([service.promotePending(), service.promotePending()]);

  assert.equal(saved.length, 3);
  assert.equal(new Set(saved).size, 3);
  assert.ok(saved.every((id) => interactions.record(id).promotionStatus === 'PROMOTED'));
});

test('mudança de workspace durante a operação assíncrona devolve a interação a PENDING', async () => {
  let current = [workspaceKey('C:/workspace-a')!];
  let unblockEmbedding!: () => void;
  const embeddingBlocked = new Promise<void>((resolve) => { unblockEmbedding = resolve; });
  const interactions = new FakeInteractions([completed('a', current[0])]);
  const provider = createMemoryProvider(() => current, contextA, [], embeddingBlocked);
  const service = new InteractionPromotionService(interactions as never, provider, () => current);
  const run = service.promotePending();
  current = [workspaceKey('C:/workspace-b')!];
  unblockEmbedding();
  await run;

  assert.equal(interactions.record('a').promotionStatus, 'PENDING');
  assert.equal(interactions.record('a').promotionReason, 'WORKSPACE_CHANGED_OR_UNAVAILABLE');
});

test('projetos com a mesma stack não compartilham promoção automática', async () => {
  const a = completed('same-stack-a', workspaceKey('C:/workspace-a')!);
  const b = completed('same-stack-b', workspaceKey('C:/workspace-b')!);
  const interactions = new FakeInteractions([a, b]);
  const saved: string[] = [];
  const memory = createMemoryProvider(() => [workspaceKey('C:/workspace-b')!], contextB, saved);

  await new InteractionPromotionService(interactions as never, memory, () => [workspaceKey('C:/workspace-b')!]).promotePending();

  assert.deepEqual(saved, ['same-stack-b']);
  assert.equal(interactions.record('same-stack-a').promotionStatus, 'PENDING');
});

test('identidade de caminho Windows ignora maiúsculas, barras e separador final', () => {
  assert.equal(workspaceKey('C:\\Projetos\\App\\'), workspaceKey('c:/projetos/app'));
  assert.notEqual(workspaceKey('C:\\Projetos\\App'), workspaceKey('C:\\Projetos\\Outro'));
});

test('resolve a raiz aberta mais específica para cwd em subdiretório', () => {
  const roots = [
    { workspaceKey: workspaceKey('C:/repo')!, normalizedPath: normalizeWorkspacePath('C:/repo')! },
    { workspaceKey: workspaceKey('C:/repo/apps')!, normalizedPath: normalizeWorkspacePath('C:/repo/apps')! },
  ];
  assert.equal(resolveWorkspaceOrigin('C:/repo/apps/service/src', roots)?.workspaceKey, roots[1]!.workspaceKey);
  assert.equal(resolveWorkspaceOrigin('C:/repo/appshell/src', roots)?.workspaceKey, roots[0]!.workspaceKey);
  assert.equal(resolveWorkspaceOrigin('C:/repository/apps', roots), undefined);
});

test('resolve descendentes das raízes de volume Windows e POSIX sem ampliar a fronteira', () => {
  const roots = [
    { workspaceKey: workspaceKey('C:/')!, normalizedPath: normalizeWorkspacePath('C:/')! },
    { workspaceKey: workspaceKey('/')!, normalizedPath: normalizeWorkspacePath('/')! },
  ];
  assert.equal(resolveWorkspaceOrigin('C:/repo/src', roots)?.workspaceKey, roots[0]!.workspaceKey);
  assert.equal(resolveWorkspaceOrigin('/repo/src', roots)?.workspaceKey, roots[1]!.workspaceKey);
  assert.equal(resolveWorkspaceOrigin('C:/outside', [{ workspaceKey: 'repo', normalizedPath: normalizeWorkspacePath('C:/repo')! }]), undefined);
});

test('resolve raízes UNC e escolhe a mais específica sem confundir nomes semelhantes', () => {
  const roots = [
    { workspaceKey: workspaceKey('\\\\server\\share')!, normalizedPath: normalizeWorkspacePath('\\\\server\\share')! },
    { workspaceKey: workspaceKey('\\\\server\\share\\repo')!, normalizedPath: normalizeWorkspacePath('\\\\server\\share\\repo')! },
  ];
  assert.equal(resolveWorkspaceOrigin('\\\\server\\share\\repo\\src', roots)?.workspaceKey, roots[1]!.workspaceKey);
  assert.equal(resolveWorkspaceOrigin('\\\\server\\share\\repository\\src', roots)?.workspaceKey, roots[0]!.workspaceKey);
  assert.equal(resolveWorkspaceOrigin('\\\\server\\share-other\\repo\\src', roots), undefined);
});

test('raiz aninhada ambígua não é associada silenciosamente', () => {
  const path = normalizeWorkspacePath('C:/repo/apps')!;
  const roots = [
    { workspaceKey: 'key-a', normalizedPath: path },
    { workspaceKey: 'key-b', normalizedPath: path },
  ];
  assert.equal(resolveWorkspaceOrigin('C:/repo/apps/src', roots), undefined);
});

test('normalização UNC preserva servidor e compartilhamento', () => {
  assert.equal(normalizeWorkspacePath('\\\\Server\\Share\\Project\\'), '//server/share/project');
  assert.equal(normalizeWorkspacePath('//server/share/project'), '//server/share/project');
  assert.notEqual(normalizeWorkspacePath('//server/share-a/project'), normalizeWorkspacePath('//server/share-b/project'));
});

test('normaliza segmentos . e .. sem escapar das raízes', () => {
  assert.equal(normalizeWorkspacePath('C:/repo/../outro'), 'c:/outro');
  assert.equal(normalizeWorkspacePath('//server/share/repo/../outro'), '//server/share/outro');
  assert.equal(normalizeWorkspacePath('C:/'), 'c:/');
  assert.equal(normalizeWorkspacePath('C:/outro/..'), 'c:/');
  assert.equal(normalizeWorkspacePath('/'), '/');
  assert.equal(normalizeWorkspacePath('/repo/../outro'), '/outro');
  assert.equal(normalizeWorkspacePath('/outro/..'), '/');
});

test('não incorpora manifesto da raiz B aninhada ao capturar A', () => {
  const origins = [
    { workspaceKey: workspaceKey('C:/repo')!, normalizedPath: normalizeWorkspacePath('C:/repo')! },
    { workspaceKey: workspaceKey('C:/repo/nested')!, normalizedPath: normalizeWorkspacePath('C:/repo/nested')! },
  ];
  assert.equal(manifestBelongsToWorkspaceOrigin('C:/repo/pom.xml', origins[0]!.workspaceKey, origins), true);
  assert.equal(manifestBelongsToWorkspaceOrigin('C:/repo/nested/package.json', origins[0]!.workspaceKey, origins), false);
  assert.equal(manifestBelongsToWorkspaceOrigin('C:/repo/nested/package.json', origins[1]!.workspaceKey, origins), true);
});

test('não entrega memória privada de A após mudança para B durante embedding', async () => {
  const originA = workspaceKey('C:/workspace-a')!;
  const originB = workspaceKey('C:/workspace-b')!;
  let current = originA;
  let unblock!: () => void;
  const pending = new Promise<void>((resolve) => { unblock = resolve; });
  const privateA: LocalKnowledge = { id: 'private-a', originalRequest: 'prompt', normalizedPrompt: 'prompt', contextKey: 'ctx', response: 'solução privada de A', createdAt: '', lastUsedAt: '', reuseCount: 0, scope: 'WORKSPACE', provenance: 'AUTO_PROMOTED', workspaceKey: originA, embedding: [1, 0] };
  const provider = { currentSearchWorkspaceKey: () => current, currentWorkspaceKeys: () => [current], capture: async () => contextA } as ProjectContextProvider & { currentSearchWorkspaceKey: () => string; currentWorkspaceKeys: () => readonly string[] };
  const service = new LocalMemoryService({
    findExact: async () => undefined,
    findSimilar: async () => [{ knowledge: privateA, similarity: 0.99, contextCompatible: true }],
    registerReuse: async () => privateA,
    save: async () => privateA,
  }, { generate: async () => { await pending; return [1, 0]; } }, provider);
  const run = service.search('pergunta privada');
  current = originB;
  unblock();
  const result = await run;
  assert.equal(result.matchType, 'NONE');
  assert.equal(result.reusableSolution, undefined);
});

test('não entrega memória privada de A se o workspace mudar durante registerReuse', async () => {
  const originA = workspaceKey('C:/workspace-a')!;
  const originB = workspaceKey('C:/workspace-b')!;
  let current = originA;
  let unblock!: () => void;
  const pending = new Promise<void>((resolve) => { unblock = resolve; });
  const privateA: LocalKnowledge = { id: 'private-a-register', originalRequest: 'prompt', normalizedPrompt: 'prompt', contextKey: 'ctx', response: 'solução privada de A', createdAt: '', lastUsedAt: '', reuseCount: 0, scope: 'WORKSPACE', provenance: 'AUTO_PROMOTED', workspaceKey: originA, embedding: [1, 0] };
  const provider = { currentSearchWorkspaceKey: () => current, currentWorkspaceKeys: () => [current], capture: async () => contextA } as ProjectContextProvider & { currentSearchWorkspaceKey: () => string; currentWorkspaceKeys: () => readonly string[] };
  const service = new LocalMemoryService({
    findExact: async () => undefined,
    findSimilar: async () => [{ knowledge: privateA, similarity: 0.99, contextCompatible: true }],
    registerReuse: async () => { await pending; return privateA; },
    save: async () => privateA,
  }, { generate: async () => [1, 0] }, provider);
  const run = service.search('pergunta privada registerReuse');
  await new Promise<void>((resolve) => setImmediate(resolve));
  current = originB;
  unblock();
  const result = await run;
  assert.equal(result.matchType, 'NONE');
  assert.equal(result.reusableSolution, undefined);
});

test('busca em multi-root usa apenas a raiz do documento ativo', async () => {
  const requested: string[] = [];
  const rootA = workspaceKey('C:/workspace-a')!;
  const rootB = workspaceKey('C:/workspace-b')!;
  const provider = {
    currentWorkspaceKeys: () => [rootA, rootB],
    currentSearchWorkspaceKey: () => rootB,
    capture: async (origin?: string) => { requested.push(origin ?? 'none'); return contextB; },
  } as ProjectContextProvider & { currentWorkspaceKeys: () => readonly string[]; currentSearchWorkspaceKey: () => string | undefined };
  const lookups: string[] = [];
  const service = new LocalMemoryService({
    findExact: async (_prompt, _context, lookup) => { lookups.push(lookup?.workspaceKey ?? 'none'); return undefined; },
    findSimilar: async () => [],
    registerReuse: async () => undefined,
    save: async () => { throw new Error('não esperado'); },
  }, { generate: async () => [1, 0] }, provider);

  const result = await service.search('pergunta multi-root');

  assert.equal(result.matchType, 'NONE');
  assert.deepEqual(requested, [rootB]);
  assert.deepEqual(lookups, [rootB]);
});

test('busca em multi-root sem documento ativo permanece segura e explícita', async () => {
  const provider = {
    currentWorkspaceKeys: () => [workspaceKey('C:/workspace-a')!, workspaceKey('C:/workspace-b')!],
    currentSearchWorkspaceKey: () => undefined,
    capture: async (origin?: string) => { assert.equal(origin, undefined); return undefined; },
  } as ProjectContextProvider & { currentWorkspaceKeys: () => readonly string[]; currentSearchWorkspaceKey: () => string | undefined };
  const service = new LocalMemoryService({
    findExact: async (_prompt, context, lookup) => { assert.equal(context, undefined); assert.equal(lookup?.workspaceKey, undefined); return undefined; },
    findSimilar: async () => [],
    registerReuse: async () => undefined,
    save: async () => { throw new Error('não esperado'); },
  }, { generate: async () => [1, 0] }, provider);

  assert.equal((await service.search('pergunta sem origem inequívoca')).matchType, 'NONE');
});

test('multi-root permite as raízes explicitamente abertas e nada além delas', async () => {
  const a = completed('root-a', workspaceKey('C:/workspace-a')!);
  const b = completed('root-b', workspaceKey('C:/workspace-b')!);
  const outside = completed('outside', workspaceKey('C:/workspace-c')!);
  const interactions = new FakeInteractions([a, b, outside]);
  const saved: string[] = [];
  const keys = [workspaceKey('C:/workspace-a')!, workspaceKey('C:/workspace-b')!];
  const memory = createMemoryProvider(() => keys, contextA, saved);

  await new InteractionPromotionService(interactions as never, memory, () => keys).promotePending();

  assert.deepEqual(saved, ['root-a', 'root-b']);
  assert.equal(interactions.record('outside').promotionStatus, 'PENDING');
});

function completed(id: string, origin: string | undefined): MutableInteraction {
  return {
    interactionId: id,
    sessionId: `session-${id}`,
    workspaceKey: origin,
    originalRequest: `pergunta técnica ${id}`,
    response: `resposta ${id}`,
    status: 'COMPLETED',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    completedAt: new Date('2026-01-01T00:00:01.000Z'),
    promotionStatus: 'PENDING',
  };
}

type MutableInteraction = { -readonly [Key in keyof InteractionRecord]: InteractionRecord[Key] };

class FakeInteractions {
  public constructor(private readonly records: MutableInteraction[]) {}
  public record(id: string): MutableInteraction { return this.records.find((entry) => entry.interactionId === id)!; }
  public async claimCompletedForPromotionInWorkspaces(limit: number, keys: readonly string[]): Promise<InteractionRecord[]> {
    return this.records
      .filter((entry) => entry.status === 'COMPLETED' && entry.promotionStatus === 'PENDING' && entry.workspaceKey !== undefined && keys.includes(entry.workspaceKey))
      .slice(0, limit)
      .map((entry) => { entry.promotionStatus = 'PROCESSING'; return entry; });
  }
  public async finishPromotion(id: string, status: 'PROMOTED' | 'SKIPPED' | 'FAILED', reason: string): Promise<void> {
    const entry = this.record(id);
    entry.promotionStatus = status;
    entry.promotionReason = reason;
  }
  public async releasePromotion(id: string, reason: string): Promise<void> {
    const entry = this.record(id);
    entry.promotionStatus = 'PENDING';
    entry.promotionReason = reason;
  }
}

function createMemoryProvider(
  currentKeys: () => readonly string[],
  context: ProjectContext,
  saved: string[],
  embeddingBlocked?: Promise<void>,
): LocalMemoryService {
  const provider: ProjectContextProvider & { currentWorkspaceKeys: () => readonly string[] } = {
    capture: async () => context,
    currentWorkspaceKeys: currentKeys,
  };
  return new LocalMemoryService({
    findExact: async () => undefined,
    findSimilar: async () => [],
    registerReuse: async () => undefined,
    save: async (request) => {
      saved.push(request.split(' ').at(-1)!);
      return { id: request, originalRequest: request, normalizedPrompt: request, contextKey: JSON.stringify(context), response: 'saved', createdAt: '', lastUsedAt: '', reuseCount: 0 };
    },
  }, { generate: async () => { await embeddingBlocked; return [1, 0]; } }, provider);
}
