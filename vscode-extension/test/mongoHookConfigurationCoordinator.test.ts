import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { MongoHookConfigurationCoordinator } from '../src/mongoHookConfigurationCoordinator.js';

const configuration = (database: string) => ({ uri: 'mongodb://127.0.0.1:27017', database });

test('E3-001: alteração das Settings após ativação atualiza o Mongo mesmo sem captura instalada', async () => {
  let current = configuration('synthetic_before');
  const updates: string[] = [];
  let hookChecks = 0;
  const coordinator = new MongoHookConfigurationCoordinator({
    readConfiguration: () => current,
    getActiveConfiguration: () => configuration(updates.at(-1) ?? 'synthetic_active'),
    isInstalled: async () => { hookChecks++; return false; },
    readInstalledConfiguration: async () => configuration('synthetic_unused'),
    updateConnection: async (value) => { updates.push(value.database); },
    syncInstalledHook: async () => { throw new Error('não deve sincronizar hook ausente'); },
    disableInstalledHook: async () => false,
  });
  await coordinator.reconcile();
  current = configuration('synthetic_after');
  await coordinator.reconcile();
  assert.deepEqual(updates, ['synthetic_before', 'synthetic_after']);
  assert.equal(hookChecks, 2);
});

test('E3-001: reconciliação serializa a configuração mais recente e sincroniza somente hook existente', async () => {
  let current = configuration('synthetic_latest');
  const order: string[] = [];
  const coordinator = new MongoHookConfigurationCoordinator({
    readConfiguration: () => current,
    getActiveConfiguration: () => configuration('synthetic_active'),
    isInstalled: async () => { order.push('check'); return true; },
    readInstalledConfiguration: async () => configuration('synthetic_old'),
    updateConnection: async (value) => { order.push(`connection:${value.database}`); },
    syncInstalledHook: async (value) => { order.push(`hook:${value.database}`); },
    disableInstalledHook: async () => { order.push('disable'); return false; },
  });
  await Promise.all([coordinator.reconcile(), coordinator.reconcile()]);
  assert.deepEqual(order, ['check', 'hook:synthetic_latest', 'connection:synthetic_latest', 'check', 'hook:synthetic_latest', 'connection:synthetic_latest']);
});

test('E3-001: falha ao sincronizar restaura imediatamente extensão e hook ao mesmo database', async () => {
  let active = configuration('synthetic_old');
  let hook = configuration('synthetic_old');
  let installed = true;
  const coordinator = new MongoHookConfigurationCoordinator({
    readConfiguration: () => configuration('synthetic_new'),
    getActiveConfiguration: () => active,
    isInstalled: async () => installed,
    readInstalledConfiguration: async () => hook,
    updateConnection: async (value) => { active = value; },
    syncInstalledHook: async (value) => { hook = value; if (value.database === 'synthetic_new') throw new Error('synthetic sync failure'); },
    disableInstalledHook: async () => { installed = false; return false; },
  });
  await assert.rejects(coordinator.reconcile(), /synthetic sync failure/);
  assert.equal(active.database, 'synthetic_old');
  assert.equal(hook.database, 'synthetic_old');
  assert.equal(installed, true);
});

test('E3-001: falha depois de atualizar o hook restaura o snapshot quando a conexão da extensão falha', async () => {
  let active = configuration('synthetic_old');
  let hook = configuration('synthetic_old');
  let installed = true;
  const coordinator = new MongoHookConfigurationCoordinator({
    readConfiguration: () => configuration('synthetic_new'),
    getActiveConfiguration: () => active,
    isInstalled: async () => installed,
    readInstalledConfiguration: async () => configuration('synthetic_old'),
    updateConnection: async (value) => {
      if (value.database === 'synthetic_new') throw new Error('synthetic connection failure');
      active = value;
    },
    syncInstalledHook: async (value) => { hook = value; },
    disableInstalledHook: async () => { installed = false; return false; },
  });
  await assert.rejects(coordinator.reconcile(), /synthetic connection failure/);
  assert.equal(active.database, 'synthetic_old');
  assert.equal(hook.database, 'synthetic_old');
  assert.equal(installed, true);
});

test('E3-001: habilitar, desabilitar e Settings concorrentes terminam sem reinstalar ou manter snapshot antigo', async () => {
  let current = configuration('synthetic_a');
  let active = configuration('synthetic_old');
  let hook: typeof active | undefined;
  let installed = false;
  const coordinator = new MongoHookConfigurationCoordinator({
    readConfiguration: () => current,
    getActiveConfiguration: () => active,
    isInstalled: async () => installed,
    readInstalledConfiguration: async () => hook ?? configuration('synthetic_old'),
    updateConnection: async (value) => { active = value; },
    syncInstalledHook: async (value) => { hook = value; installed = true; },
    disableInstalledHook: async () => { installed = false; hook = undefined; return false; },
  });
  const enabling = coordinator.enable();
  current = configuration('synthetic_b');
  const disabling = coordinator.disable();
  const changing = coordinator.reconcile();
  await Promise.all([enabling, disabling, changing]);
  assert.equal(installed, false);
  assert.equal(hook, undefined);
  assert.equal(active.database, 'synthetic_b');
});

test('E3-001: falha de rollback desabilita a captura em vez de manter configuração divergente', async () => {
  let active = configuration('synthetic_old');
  let hook = configuration('synthetic_old');
  let installed = true;
  const coordinator = new MongoHookConfigurationCoordinator({
    readConfiguration: () => configuration('synthetic_new'),
    getActiveConfiguration: () => active,
    isInstalled: async () => installed,
    readInstalledConfiguration: async () => hook,
    updateConnection: async (value) => { active = value; },
    syncInstalledHook: async (value) => { hook = value; if (value.database === 'synthetic_new' || value.database === 'synthetic_old') throw new Error('synthetic rollback failure'); },
    disableInstalledHook: async () => { installed = false; return false; },
  });
  await assert.rejects(coordinator.reconcile(), /rollback também falhou/);
  assert.equal(installed, false);
});

test('E3-001: desabilitar propaga se os artefatos de captura foram removidos', async () => {
  const coordinator = new MongoHookConfigurationCoordinator({
    readConfiguration: () => configuration('synthetic_current'),
    getActiveConfiguration: () => configuration('synthetic_current'),
    isInstalled: async () => true,
    readInstalledConfiguration: async () => configuration('synthetic_current'),
    updateConnection: async () => undefined,
    syncInstalledHook: async () => undefined,
    disableInstalledHook: async () => true,
  });
  assert.equal(await coordinator.disable(), true);
});

test('E3-001: mensagem de desabilitação usa o resultado real da remoção', async () => {
  const source = await readFile(join(process.cwd(), 'src', 'extension.ts'), 'utf8');
  assert.match(source, /const removed = await configurationCoordinator\.disable\(\);[\s\S]*const legacyRemoved = await removeLegacyGlobalInteractionHook\(homedir\(\)\);[\s\S]*removed \|\| legacyRemoved/);
});
