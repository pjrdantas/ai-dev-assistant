import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { installAgentScopedHookRunner, installationAt, removeLegacyGlobalInteractionHook, uninstallAgentScopedHookRunner } from '../src/interactionHookInstallation.js';

test('instala launchers próprios sem criar hook global do usuário', async () => {
  const home = await mkdtemp(join(tmpdir(), 'ai-dev-assistant-hook-'));
  try {
    const installation = await installAgentScopedHookRunner(home, 'C:/VS Code/Code.exe', 'C:/extensions/runner.js');
    assert.equal(installation.directory, join(home, '.copilot', 'ai-dev-assistant'));
    assert.match(await readFile(installation.powershellLauncher, 'utf8'), /ELECTRON_RUN_AS_NODE/);
    assert.match(await readFile(installation.powershellLauncher, 'utf8'), /Code\.exe/);
    assert.match(await readFile(installation.shellLauncher, 'utf8'), /runner\.js/);
    await assert.rejects(readFile(join(home, '.copilot', 'hooks', 'ai-dev-assistant.json'), 'utf8'), { code: 'ENOENT' });
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('desinstala somente os artefatos marcados do AI Dev Assistant', async () => {
  const home = await mkdtemp(join(tmpdir(), 'ai-dev-assistant-hook-'));
  try {
    const installation = await installAgentScopedHookRunner(home, 'node', 'runner.js');
    const foreign = join(installation.directory, 'other-product.txt');
    await writeFile(foreign, 'preservar', 'utf8');
    assert.equal(await uninstallAgentScopedHookRunner(home), true);
    assert.equal(await readFile(foreign, 'utf8'), 'preservar');
    assert.equal(await uninstallAgentScopedHookRunner(home), false);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('não remove diretório sem marcador próprio', async () => {
  const home = await mkdtemp(join(tmpdir(), 'ai-dev-assistant-hook-'));
  try {
    const installation = installationAt(home);
    await mkdir(installation.directory, { recursive: true });
    await writeFile(join(installation.directory, 'other-product.txt'), 'preservar', 'utf8');
    assert.equal(await uninstallAgentScopedHookRunner(home), false);
    assert.equal(await readFile(join(installation.directory, 'other-product.txt'), 'utf8'), 'preservar');
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('remove apenas o hook global legado que contém o runner do AI Dev Assistant', async () => {
  const home = await mkdtemp(join(tmpdir(), 'ai-dev-assistant-hook-'));
  try {
    const hooks = join(home, '.copilot', 'hooks');
    await mkdir(hooks, { recursive: true });
    const legacy = join(hooks, 'ai-dev-assistant.json');
    const thirdParty = join(hooks, 'other-product.json');
    await writeFile(legacy, JSON.stringify({ hooks: { UserPromptSubmit: [{ type: 'command', command: 'node interactionHookRunner.js' }] } }), 'utf8');
    await writeFile(thirdParty, 'preservar', 'utf8');
    assert.equal(await removeLegacyGlobalInteractionHook(home), true);
    await assert.rejects(readFile(legacy, 'utf8'), { code: 'ENOENT' });
    assert.equal(await readFile(thirdParty, 'utf8'), 'preservar');
  } finally { await rm(home, { recursive: true, force: true }); }
});
