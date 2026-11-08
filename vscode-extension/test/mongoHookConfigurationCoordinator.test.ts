import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { MongoHookConfigurationCoordinator } from '../src/mongoHookConfigurationCoordinator.js';
import { MongoHookConfigurationError } from '../src/mongoHookConfiguration.js';
import { installAgentScopedHookRunner, isAgentScopedHookRunnerInstalled, installationAt } from '../src/interactionHookInstallation.js';

const configuration = (database: string) => ({ uri: 'mongodb://127.0.0.1:27017', database });

function createCoordinator(overrides: Partial<ConstructorParameters<typeof MongoHookConfigurationCoordinator>[0]> = {}) {
  const calls = { sync: 0, disable: 0, updates: [] as string[], issues: [] as string[] };
  let current = configuration('synthetic_current');
  const dependencies: ConstructorParameters<typeof MongoHookConfigurationCoordinator>[0] = {
    readConfiguration: () => configuration('synthetic_current'),
    getActiveConfiguration: () => current,
    isInstalled: async () => true,
    readInstalledConfiguration: async () => configuration('synthetic_current'),
    updateConnection: async (value) => { current = value; calls.updates.push(value.database); },
    syncInstalledHook: async () => { calls.sync++; },
    disableInstalledHook: async () => { calls.disable++; return true; },
    reportIssue: (issue) => { calls.issues.push(issue); },
    ...overrides,
  };
  return { coordinator: new MongoHookConfigurationCoordinator(dependencies), calls };
}

test('5B.5: snapshot ausente preserva hooks e informa inconsistência', async () => {
  const { coordinator, calls } = createCoordinator({ readInstalledConfiguration: async () => { throw new Error('ausente'); } });
  await coordinator.reconcile();
  assert.equal(calls.sync, 0);
  assert.equal(calls.disable, 0);
  assert.match(calls.issues[0] ?? '', /snapshot/);
});

test('5B.5: snapshot JSON inválido preserva hooks e informa inconsistência', async () => {
  const { coordinator, calls } = createCoordinator({ readInstalledConfiguration: async () => { throw new Error('inválido'); } });
  await coordinator.reconcile();
  assert.equal(calls.disable, 0);
  assert.match(calls.issues[0] ?? '', /não foi considerada segura/);
});

test('5B.5: configuração igual não reescreve launchers durante reconciliação', async () => {
  const { coordinator, calls } = createCoordinator();
  await coordinator.reconcile();
  assert.equal(calls.sync, 0);
  assert.equal(calls.disable, 0);
});

test('AUD-11: reconcilia launcher obsoleto somente quando a instalação é reconhecida como gerenciada', async () => {
  const { coordinator, calls } = createCoordinator({
    installedHookState: async () => 'stale',
  });
  await coordinator.reconcile();
  assert.equal(calls.sync, 1);
});

test('AUD-11: launcher marcado desconhecido não é sobrescrito durante reinício', async () => {
  const { coordinator, calls } = createCoordinator({
    installedHookState: async () => 'unknown',
  });
  await coordinator.reconcile();
  assert.equal(calls.sync, 0);
  assert.match(calls.issues[0] ?? '', /foi sobrescrito/);
});

test('5B.5: configuração divergente não sincroniza silenciosamente e informa o risco', async () => {
  const { coordinator, calls } = createCoordinator({ readInstalledConfiguration: async () => configuration('synthetic_previous') });
  await coordinator.reconcile();
  assert.equal(calls.sync, 0);
  assert.match(calls.issues[0] ?? '', /database anterior/);
});

test('5B.5: launchers sem marcador não são tocados pela reconciliação', async () => {
  const { coordinator, calls } = createCoordinator({ isInstalled: async () => false });
  await coordinator.reconcile();
  assert.equal(calls.sync, 0);
  assert.equal(calls.disable, 0);
});

test('5B.5: falha de leitura do marcador não remove instalação preexistente', async () => {
  const { coordinator, calls } = createCoordinator({ isInstalled: async () => { throw new Error('permissão'); } });
  await coordinator.reconcile();
  assert.equal(calls.disable, 0);
  assert.match(calls.issues[0] ?? '', /estado dos hooks/);
});

test('5B.5: mudança de Settings atualiza somente a conexão e nunca o launcher', async () => {
  let selected = configuration('synthetic_before');
  const { coordinator, calls } = createCoordinator({
    readConfiguration: () => selected,
    readInstalledConfiguration: async () => configuration('synthetic_previous'),
  });
  await coordinator.reconcile();
  selected = configuration('synthetic_after');
  await coordinator.reconcile();
  assert.deepEqual(calls.updates, ['synthetic_before', 'synthetic_after']);
  assert.equal(calls.sync, 0);
});

test('5B.5: enable não desinstala quando a leitura da instalação existente falha', async () => {
  const { coordinator, calls } = createCoordinator({ readInstalledConfiguration: async () => { throw new Error('leitura falhou'); } });
  await assert.rejects(coordinator.enable(), /leitura falhou/);
  assert.equal(calls.disable, 0);
  assert.equal(calls.sync, 0);
});

test('5B.5A: enable repara instalação gerenciada com snapshot ausente somente no caminho explícito', async () => {
  let installed = true;
  let hook: string | undefined = 'launcher-anterior';
  const { coordinator, calls } = createCoordinator({
    readInstalledConfiguration: async () => { throw new MongoHookConfigurationError('Arquivo de configuração MongoDB do hook não encontrado.', 'missing'); },
    syncInstalledHook: async () => { hook = 'launcher-reparado'; calls.sync++; },
    updateConnection: async (value) => { calls.updates.push(value.database); },
  });
  await coordinator.enable();
  assert.equal(installed, true);
  assert.equal(hook, 'launcher-reparado');
  assert.equal(calls.sync, 1);
  assert.deepEqual(calls.updates, ['synthetic_current']);
});

test('5B.5B: snapshot ausente bloqueia antes de substituir hooks quando updateConnection falha', async () => {
  const home = await mkdtemp(join(tmpdir(), 'ai-dev-assistant-hook-'));
  try {
    const installation = await installAgentScopedHookRunner(home, process.execPath, 'runner.js', configuration('synthetic_previous'));
    await unlink(installation.mongoConfiguration);
    const before = await Promise.all([
      readFile(join(installation.directory, '.ai-dev-assistant-managed')),
      readFile(installation.powershellLauncher),
      readFile(installation.shellLauncher),
    ]);
    let syncCalls = 0;
    let disableCalls = 0;
    let active = configuration('synthetic_previous');
    const coordinator = new MongoHookConfigurationCoordinator({
      readConfiguration: () => configuration('synthetic_current'),
      getActiveConfiguration: () => active,
      isInstalled: () => isAgentScopedHookRunnerInstalled(home),
      readInstalledConfiguration: async () => {
        throw new MongoHookConfigurationError('Arquivo de configuração MongoDB do hook não encontrado.', 'missing');
      },
      updateConnection: async (value) => {
        if (value.database === 'synthetic_current') throw new Error('falha injetada em updateConnection');
        active = value;
      },
      syncInstalledHook: async (value) => {
        syncCalls++;
        await installAgentScopedHookRunner(home, process.execPath, 'runner.js', value);
      },
      disableInstalledHook: async () => { disableCalls++; return true; },
    });

    await assert.rejects(coordinator.enable(), /falha injetada em updateConnection/);
    const after = await Promise.all([
      readFile(join(installation.directory, '.ai-dev-assistant-managed')),
      readFile(installation.powershellLauncher),
      readFile(installation.shellLauncher),
    ]);
    assert.equal(syncCalls, 0);
    assert.equal(disableCalls, 0);
    assert.deepEqual(after, before);
    await assert.rejects(readFile(installation.mongoConfiguration), { code: 'ENOENT' });
    assert.deepEqual(active, configuration('synthetic_previous'));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('5B.5A: snapshot inválido não autoriza substituição no enable', async () => {
  const { coordinator, calls } = createCoordinator({ readInstalledConfiguration: async () => { throw new Error('inválido'); } });
  await assert.rejects(coordinator.enable(), /inválido/);
  assert.equal(calls.sync, 0);
  assert.equal(calls.disable, 0);
});

test('5B.5: falha parcial de instalação não dispara remoção adicional no rollback', async () => {
  let installed = false;
  const { coordinator, calls } = createCoordinator({
    isInstalled: async () => installed,
    syncInstalledHook: async () => { installed = true; throw new Error('instalação parcial'); },
    disableInstalledHook: async () => { calls.disable++; installed = false; return true; },
  });
  await assert.rejects(coordinator.enable(), /instalação parcial/);
  assert.equal(calls.disable, 0);
});

test('5B.5A: falha de instalação preserva a ausência anterior', async () => {
  let installed = false;
  const { coordinator, calls } = createCoordinator({
    isInstalled: async () => installed,
    syncInstalledHook: async () => { throw new Error('falha de instalação'); },
  });
  await assert.rejects(coordinator.enable(), /falha de instalação/);
  assert.equal(installed, false);
  assert.equal(calls.disable, 0);
});

test('5B.5A: falha de conexão após instalação nova remove somente a instalação nova', async () => {
  let installed = false;
  let active = configuration('synthetic_previous');
  const { coordinator, calls } = createCoordinator({
    isInstalled: async () => installed,
    syncInstalledHook: async () => { installed = true; },
    updateConnection: async (value) => { if (value.database === 'synthetic_current') throw new Error('conexão falhou'); active = value; },
    getActiveConfiguration: () => active,
    disableInstalledHook: async () => { calls.disable++; installed = false; return true; },
  });
  await assert.rejects(coordinator.enable(), /conexão falhou/);
  assert.equal(installed, false);
  assert.equal(calls.disable, 1);
  assert.equal(active.database, 'synthetic_previous');
});

test('5B.5A: falha de conexão preserva instalação anterior válida', async () => {
  let hook = configuration('synthetic_previous');
  const { coordinator, calls } = createCoordinator({
    readConfiguration: () => configuration('synthetic_current'),
    readInstalledConfiguration: async () => hook,
    syncInstalledHook: async (value) => { hook = value; },
    updateConnection: async (value) => { if (value.database === 'synthetic_current') throw new Error('conexão falhou'); },
  });
  await assert.rejects(coordinator.enable(), /conexão falhou/);
  assert.equal(hook.database, 'synthetic_previous');
  assert.equal(calls.disable, 0);
});

test('5B.5A: falha de conexão antes da sincronização permanece visível e não remove instalação anterior', async () => {
  let hook = configuration('synthetic_previous');
  const { coordinator, calls } = createCoordinator({
    readConfiguration: () => configuration('synthetic_current'),
    readInstalledConfiguration: async () => hook,
    syncInstalledHook: async (value) => { hook = value; },
    updateConnection: async (value) => { if (value.database === 'synthetic_current') throw new Error('conexão falhou'); },
  });
  await assert.rejects(coordinator.enable(), /conexão falhou/);
  assert.equal(calls.disable, 0);
  assert.equal(hook.database, 'synthetic_previous');
});

test('5B.5: desabilitação continua explícita e delegada ao instalador', async () => {
  const { coordinator, calls } = createCoordinator({ disableInstalledHook: async () => { calls.disable++; return true; } });
  assert.equal(await coordinator.disable(), true);
  assert.equal(calls.disable, 1);
});

test('regressão: habilitação explícita restaura o snapshot quando a conexão falha', async () => {
  let hook = configuration('synthetic_previous');
  let active = configuration('synthetic_previous');
  const { coordinator, calls } = createCoordinator({
    readConfiguration: () => configuration('synthetic_new'),
    getActiveConfiguration: () => active,
    readInstalledConfiguration: async () => hook,
    syncInstalledHook: async (value) => { hook = value; },
    updateConnection: async (value) => { if (value.database === 'synthetic_new') throw new Error('conexão falhou'); active = value; },
  });
  await assert.rejects(coordinator.enable(), /conexão falhou/);
  assert.equal(hook.database, 'synthetic_previous');
  assert.equal(calls.disable, 0);
});

test('B1: falha ao sincronizar após atualizar a conexão restaura a configuração anterior', async () => {
  let active = configuration('before');
  const hook = configuration('before');
  const { coordinator } = createCoordinator({
    readConfiguration: () => configuration('after'),
    getActiveConfiguration: () => active,
    readInstalledConfiguration: async () => hook,
    updateConnection: async (value) => { active = value; },
    syncInstalledHook: async () => { throw new Error('sync falhou'); },
  });
  await assert.rejects(coordinator.enable(), /sync falhou/);
  assert.deepEqual(active, configuration('before'));
  assert.deepEqual(hook, configuration('before'));
});

test('regressão: falha no rollback permanece visível sem apagar hook preexistente', async () => {
  let active = configuration('synthetic_previous');
  const { coordinator, calls } = createCoordinator({
    readConfiguration: () => configuration('synthetic_new'),
    getActiveConfiguration: () => active,
    syncInstalledHook: async (value) => { if (value.database === 'synthetic_new') throw new Error('sync falhou'); },
    updateConnection: async (value) => { if (value.database === 'synthetic_previous') throw new Error('rollback falhou'); active = value; },
  });
  await assert.rejects(coordinator.enable(), /rollback também falhou/);
  assert.equal(calls.disable, 0);
});

test('regressão: operações concorrentes permanecem serializadas e a desabilitação explícita vence', async () => {
  let current = configuration('synthetic_a');
  let installed = false;
  const { coordinator, calls } = createCoordinator({
    readConfiguration: () => current,
    isInstalled: async () => installed,
    syncInstalledHook: async () => { installed = true; },
    updateConnection: async (value) => { current = value; calls.updates.push(value.database); },
    disableInstalledHook: async () => { installed = false; calls.disable++; return true; },
  });
  const enabling = coordinator.enable();
  current = configuration('synthetic_b');
  const disabling = coordinator.disable();
  const reconciling = coordinator.reconcile();
  await Promise.all([enabling, disabling, reconciling]);
  assert.equal(installed, false);
  assert.equal(calls.disable, 1);
  assert.equal(current.database, 'synthetic_b');
});
