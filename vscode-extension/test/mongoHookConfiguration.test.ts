import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { readFileSync, unlinkSync } from 'node:fs';
import test from 'node:test';
import { MongoClient } from 'mongodb';

import { installAgentScopedHookRunner } from '../src/interactionHookInstallation.js';
import { DEFAULT_MONGO_DATABASE, DEFAULT_MONGO_URI, MongoHookConfigurationError, loadMongoHookConfiguration, readMongoHookConfiguration, writeMongoHookConfiguration } from '../src/mongoHookConfiguration.js';

test('E3-001: o launcher do hook deve receber a mesma configuração Mongo da extensão', async () => {
  const home = await mkdtemp(join(tmpdir(), 'ai-dev-assistant-e3-001-'));
  try {
    const installation = await installAgentScopedHookRunner(home, 'node', 'runner.js');
    const launcher = await readFile(installation.powershellLauncher, 'utf8');
    assert.match(launcher, /mongodb-config\.json/);
    assert.deepEqual(await loadMongoHookConfiguration(installation.mongoConfiguration), { uri: DEFAULT_MONGO_URI, database: DEFAULT_MONGO_DATABASE });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('E3-001: configuração personalizada direciona o runner e mudanças substituem o snapshot anterior', async () => {
  const home = await mkdtemp(join(tmpdir(), 'ai-dev-assistant-e3-001-'));
  try {
    const first = await installAgentScopedHookRunner(home, 'node', 'runner.js', { uri: 'mongodb://127.0.0.1:27018', database: 'synthetic_capture_a' });
    assert.deepEqual(await readMongoHookConfiguration(first.mongoConfiguration), { uri: 'mongodb://127.0.0.1:27018', database: 'synthetic_capture_a' });
    const launcher = await readFile(first.powershellLauncher, 'utf8');
    assert.doesNotMatch(launcher, /27018|synthetic_capture_a/);

    await installAgentScopedHookRunner(home, 'node', 'runner.js', { uri: 'mongodb://127.0.0.1:27019', database: 'synthetic_capture_b' });
    assert.deepEqual(await readMongoHookConfiguration(first.mongoConfiguration), { uri: 'mongodb://127.0.0.1:27019', database: 'synthetic_capture_b' });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('E3-001: runner captura interação no database temporário configurado', async () => {
  const database = `ai_dev_assistant_e3_001_${randomUUID().replaceAll('-', '')}`;
  const testMongoUri = requiredHookTestMongoUri();
  const client = new MongoClient(testMongoUri, { serverSelectionTimeoutMS: 1_500, connectTimeoutMS: 1_500 });
  let home: string | undefined;
  let connected = false;
  try {
    await client.connect();
    connected = true;
    home = await mkdtemp(join(tmpdir(), 'ai-dev-assistant-e3-001-'));
    const installation = await installAgentScopedHookRunner(home, 'node', 'runner.js', { uri: testMongoUri, database });
    const runner = join(process.cwd(), 'out', 'src', 'interactionHookRunner.js');
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [runner, '--mongo-config', installation.mongoConfiguration], { stdio: ['pipe', 'pipe', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
      child.on('error', reject);
      child.on('close', (code) => code === 0 ? resolve() : reject(new Error(stderr || `runner exit ${code}`)));
      child.stdin.end(JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'synthetic E3-001 prompt', session_id: 'synthetic-session' }));
    });
    assert.equal(await client.db(database).collection('interactions').countDocuments({ originalRequest: 'synthetic E3-001 prompt' }), 1);
  } finally {
    if (connected) await client.db(database).dropDatabase();
    await client.close();
    if (home !== undefined) await rm(home, { recursive: true, force: true });
  }
});

test('E3-005: stdin acima do limite encerra a captura sem ecoar conteúdo', async () => {
  const runner = join(process.cwd(), 'out', 'src', 'interactionHookRunner.js');
  const result = await new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [runner], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stderr }));
    child.stdin.end(Buffer.alloc(1 * 1024 * 1024 + 1, 0x78));
  });

  assert.equal(result.code, 0);
  assert.match(result.stderr, /interaction capture unavailable/);
  assert.doesNotMatch(result.stderr, /x{100}/);
});

test('E3-005: transcript acima do limite marca RESPONSE_UNAVAILABLE sem persistir resposta parcial', async () => {
  const database = `ai_dev_assistant_e3_005_${randomUUID().replaceAll('-', '')}`;
  const testMongoUri = requiredHookTestMongoUri();
  const client = new MongoClient(testMongoUri, { serverSelectionTimeoutMS: 1_500, connectTimeoutMS: 1_500 });
  let home: string | undefined;
  let connected = false;
  try {
    await client.connect();
    connected = true;
    home = await mkdtemp(join(tmpdir(), 'ai-dev-assistant-e3-005-'));
    const installation = await installAgentScopedHookRunner(home, 'node', 'runner.js', { uri: testMongoUri, database });
    const transcript = join(home, 'oversized-transcript.json');
    await writeFile(transcript, Buffer.alloc(4 * 1024 * 1024 + 1, 0x78));
    const sessionId = 'synthetic-e3-005-session';
    await client.db(database).collection('interactions').insertOne({
      interactionId: randomUUID(),
      sessionId,
      status: 'PENDING',
      createdAt: new Date(),
      originalRequest: 'synthetic E3-005 request',
    });

    const runner = join(process.cwd(), 'out', 'src', 'interactionHookRunner.js');
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [runner, '--mongo-config', installation.mongoConfiguration], { stdio: ['pipe', 'pipe', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
      child.on('error', reject);
      child.on('close', (code) => code === 0 ? resolve() : reject(new Error(stderr || `runner exit ${code}`)));
      child.stdin.end(JSON.stringify({ hook_event_name: 'Stop', session_id: sessionId, transcript_path: transcript }));
    });

    const interaction = await client.db(database).collection('interactions').findOne({ sessionId });
    assert.equal(interaction?.status, 'RESPONSE_UNAVAILABLE');
    assert.equal(interaction?.promotionStatus, 'SKIPPED');
    assert.equal(interaction?.promotionReason, 'TRANSCRIPT_TOO_LARGE');
    assert.equal('response' in (interaction ?? {}), false);
  } finally {
    if (connected) await client.db(database).dropDatabase();
    await client.close();
    if (home !== undefined) await rm(home, { recursive: true, force: true });
  }
});

function requiredHookTestMongoUri(): string {
  const uri = process.env.AI_DEV_ASSISTANT_E3_HOOK_MONGODB_URI?.trim();
  if (uri === undefined || uri.length === 0) {
    throw new Error('E3-001/E3-005 exigem AI_DEV_ASSISTANT_E3_HOOK_MONGODB_URI explícita em uma porta efêmera diferente de 27017.');
  }
  if (!uri.startsWith('mongodb://')) {
    throw new Error('E3-001/E3-005 exigem uma URI mongodb:// explícita em uma porta efêmera diferente de 27017.');
  }
  const authority = uri.slice('mongodb://'.length).split(/[/?#]/)[0] ?? '';
  const hosts = authority.slice(authority.lastIndexOf('@') + 1).split(',');
  if (hosts.some((host) => !/:[0-9]+$/.test(host)) || hosts.some((host) => host.endsWith(':27017'))) {
    throw new Error('E3-001/E3-005 exigem uma URI MongoDB explícita com porta diferente de 27017.');
  }
  return uri;
}

test('E3-001: configuração inválida falha explicitamente sem cair silenciosamente no default', async () => {
  const home = await mkdtemp(join(tmpdir(), 'ai-dev-assistant-e3-001-'));
  try {
    const installation = await installAgentScopedHookRunner(home, 'node', 'runner.js');
    await writeFile(installation.mongoConfiguration, '{"schemaVersion":1,"database":""}', 'utf8');
    await assert.rejects(readMongoHookConfiguration(installation.mongoConfiguration), MongoHookConfigurationError);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('E3-001: o runner não deve resolver URI/database por ambiente ou defaults próprios', async () => {
  const runner = await readFile(join(process.cwd(), 'src', 'interactionHookRunner.ts'), 'utf8');
  assert.doesNotMatch(runner, /AI_DEV_ASSISTANT_MONGODB_(URI|DATABASE)/);
  assert.doesNotMatch(runner, /mongodb:\/\/127\.0\.0\.1:27017|ai_dev_assistant/);
});

test('E3-001: a extensão e o runner compartilham as Settings Mongo sem duplicar defaults', async () => {
  const extension = await readFile(join(process.cwd(), 'src', 'extension.ts'), 'utf8');
  assert.match(extension, /resolveAud13WorkspaceMongoConfiguration/);
  assert.doesNotMatch(extension, /getConfiguration\('aiDevAssistant\.mongodb'\)/);
  assert.match(extension, /readConfiguration: mongoConfiguration/);
  assert.match(extension, /syncInstalledHook:[\s\S]*installAgentScopedHookRunner/);
  assert.match(await readFile(join(process.cwd(), 'src', 'interactionHookRunner.ts'), 'utf8'), /loadMongoHookConfiguration/);
});

test('E3-001: URI com credenciais sintéticas fica somente no snapshot protegido e não nos launchers', async () => {
  const home = await mkdtemp(join(tmpdir(), 'ai-dev-assistant-e3-001-'));
  try {
    const syntheticUri = 'mongodb://synthetic-user:synthetic-password@127.0.0.1:27017';
    const installation = await installAgentScopedHookRunner(home, 'node', 'runner.js', { uri: syntheticUri, database: 'synthetic_credentials' });
    assert.match(await readFile(installation.mongoConfiguration, 'utf8'), /synthetic-user/);
    assert.doesNotMatch(await readFile(installation.powershellLauncher, 'utf8'), /synthetic-user|synthetic-password/);
    assert.doesNotMatch(await readFile(installation.shellLauncher, 'utf8'), /synthetic-user|synthetic-password/);
    if (process.platform === 'win32') {
      const acl = windowsAclSddl(installation.mongoConfiguration);
      const currentSid = currentWindowsSid();
      const identities = windowsAclIdentities(acl, currentSid);
      assert.ok(identities.has('S-1-5-18'));
      assert.ok(identities.has('S-1-5-32-544'));
      assert.ok(identities.has(currentSid));
      assert.doesNotMatch(acl, /;BU\)|;AU\)|;WD\)/);
      assert.equal(identities.has('S-1-5-32-545'), false);
      assert.equal(identities.has('S-1-5-11'), false);
      assert.equal(identities.has('S-1-1-0'), false);
      assert.doesNotMatch(acl, /synthetic-password/);
    }
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('E3-001: DACL controlada remove ACE ampla explícita preexistente do diretório e do arquivo final', async (t) => {
  if (process.platform !== 'win32') { t.skip('ACL NTFS requer Windows'); return; }
  const home = await mkdtemp(join(tmpdir(), 'ai-dev-assistant-e3-001-acl-'));
  const directory = join(home, 'config');
  const config = join(directory, 'mongodb-config.json');
  try {
    await mkdir(directory, { recursive: true });
    execFileSync('icacls.exe', [directory, '/grant', '*S-1-5-32-545:(OI)(CI)(M)', '/q'], { windowsHide: true });
    const before = windowsAclSddl(directory);
    assert.match(before, /;BU\)/);
    await writeMongoHookConfiguration(config, { uri: 'mongodb://127.0.0.1:27017', database: 'synthetic_acl' });
    const directoryAcl = windowsAclSddl(directory);
    const fileAcl = windowsAclSddl(config);
    const currentSid = currentWindowsSid();
    for (const acl of [directoryAcl, fileAcl]) {
      assert.doesNotMatch(acl, /;BU\)|;AU\)|;WD\)/);
      const identities = windowsAclIdentities(acl, currentSid);
      assert.ok(identities.has('S-1-5-32-544'));
      assert.ok(identities.has('S-1-5-18'));
      assert.ok(identities.has(currentSid));
      assert.equal(identities.has('S-1-5-32-545'), false);
      assert.equal(identities.has('S-1-5-11'), false);
      assert.equal(identities.has('S-1-1-0'), false);
    }
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

function currentWindowsSid(): string {
  const output = execFileSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true });
  const sid = output.match(/S-1-(?:\d+-)+\d+/)?.[0];
  assert.ok(sid);
  return sid;
}

function windowsAclSddl(path: string): string {
  const savePath = `${path}.acl-${process.pid}-${randomUUID()}`;
  try {
    execFileSync('icacls.exe', [path, '/save', savePath, '/c', '/q'], { windowsHide: true });
    return readFileSync(savePath, 'utf16le');
  } finally {
    try { unlinkSync(savePath); } catch { /* best effort cleanup */ }
  }
}

function windowsAclIdentities(sddl: string, currentSid: string, localAdministratorSid = process.platform === 'win32' ? localWindowsAdministratorSid() : undefined): Set<string> {
  const identities = new Set<string>();
  const aliases: Record<string, string> = {
    SY: 'S-1-5-18',
    BA: 'S-1-5-32-544',
    BU: 'S-1-5-32-545',
    AU: 'S-1-5-11',
    WD: 'S-1-1-0',
  };
  for (const match of sddl.matchAll(/\(([^)]*)\)/g)) {
    const fields = match[1]?.split(';');
    if (fields === undefined || fields.length < 6 || fields[0] !== 'A' || !/(?:^|,)F(?:$|,)|(?:^|,)FA(?:$|,)/.test(fields[2] ?? '')) continue;
    const identity = fields[5];
    if (identity === undefined) continue;
    if (identity === 'LA') {
      if (localAdministratorSid === undefined) throw new Error('Local Administrator SID is required to resolve SDDL alias LA.');
      assert.equal(currentSid, localAdministratorSid, 'SDDL alias LA must resolve to the current local Administrator SID.');
      identities.add(localAdministratorSid);
      continue;
    }
    identities.add(aliases[identity] ?? identity);
  }
  return identities;
}

function localWindowsAdministratorSid(): string {
  const output = execFileSync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    '(Get-LocalUser | Where-Object { $_.SID.Value -match \'-500$\' }).SID.Value',
  ], { encoding: 'utf8', windowsHide: true });
  const sid = output.match(/S-1-(?:\d+-)+500/)?.[0];
  assert.ok(sid, 'Local Administrator SID not found.');
  return sid;
}

test('E3-001: alias SDDL LA só resolve para o SID comprovado da conta Administrator local', () => {
  const localAdministratorSid = 'S-1-5-21-100-200-300-500';
  assert.ok(windowsAclIdentities('D:(A;;FA;;;LA)', localAdministratorSid, localAdministratorSid).has(localAdministratorSid));
  assert.throws(() => windowsAclIdentities('D:(A;;FA;;;LA)', 'S-1-5-21-100-200-300-1001', localAdministratorSid), /current local Administrator SID/);
  assert.equal(windowsAclIdentities('D:(D;;FA;;;SY)(A;;0;;;BA)(A;;FA;;;LA)', localAdministratorSid, localAdministratorSid).has('S-1-5-18'), false);
});

test('E3-001: validação de ACL usa SIDs e não depende do idioma do Windows', async (t) => {
  if (process.platform !== 'win32') { t.skip('ACL NTFS requer Windows'); return; }
  const source = await readFile(join(process.cwd(), 'src', 'mongoHookConfiguration.ts'), 'utf8');
  assert.match(source, /S-1-5-18/);
  assert.match(source, /S-1-5-32-544/);
  assert.doesNotMatch(source, /['"](?:Administrators|Administradores|SYSTEM|SISTEMA|USERDOMAIN|USERNAME)['"]/);
});

test('E3-001: falha de ACL depois da URI preserva o anterior, limpa o temporário e não expõe a URI', async (t) => {
  if (process.platform !== 'win32') { t.skip('ACL NTFS requer Windows'); return; }
  const home = await mkdtemp(join(tmpdir(), 'ai-dev-assistant-e3-001-acl-failure-'));
  const config = join(home, 'mongodb-config.json');
  const calls: string[][] = [];
  try {
    await writeMongoHookConfiguration(config, { uri: 'mongodb://127.0.0.1:27017', database: 'synthetic_acl_previous' }, async () => undefined);
    const previous = await readFile(config, 'utf8');
    await assert.rejects(writeMongoHookConfiguration(config, { uri: 'mongodb://synthetic-user:synthetic-password@127.0.0.1:27017', database: 'synthetic_acl_failure' }, async (path, args) => {
      calls.push([...args]);
      if (calls.length === 4) throw new Error('synthetic ACL failure');
    }), (error: unknown) => error instanceof Error && error.message === 'synthetic ACL failure' && !error.message.includes('synthetic-password'));
    assert.equal(calls.length, 4);
    assert.equal((await readdir(home)).some((entry) => entry.includes('.tmp-')), false);
    assert.equal(await readFile(config, 'utf8'), previous);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('E3-001: falha da limpeza do temporário relança a falha de ACL, preserva o anterior e não expõe a URI', async (t) => {
  if (process.platform !== 'win32') { t.skip('ACL NTFS requer Windows'); return; }
  const home = await mkdtemp(join(tmpdir(), 'ai-dev-assistant-e3-001-acl-cleanup-failure-'));
  const config = join(home, 'mongodb-config.json');
  const relocated = join(home, 'relocated-secret.tmp');
  const calls: string[][] = [];
  try {
    await writeMongoHookConfiguration(config, { uri: 'mongodb://127.0.0.1:27017', database: 'synthetic_acl_previous' }, async () => undefined);
    const previous = await readFile(config, 'utf8');
    await assert.rejects(writeMongoHookConfiguration(config, { uri: 'mongodb://synthetic-user:synthetic-password@127.0.0.1:27017', database: 'synthetic_acl_cleanup_failure' }, async (path, args) => {
      calls.push([...args]);
      if (calls.length === 4) {
        await rename(path, relocated);
        await mkdir(path);
        throw new Error('synthetic ACL failure with cleanup failure');
      }
    }), (error: unknown) => error instanceof Error && error.message === 'synthetic ACL failure with cleanup failure' && !error.message.includes('synthetic-password'));
    assert.equal(calls.length, 4);
    assert.equal(await readFile(config, 'utf8'), previous);
    assert.equal((await readdir(home)).some((entry) => entry.includes('synthetic-password')), false);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('E3-001: runner rejeita --mongo-config ausente ou sem argumento e não usa o default', async () => {
  const runner = join(process.cwd(), 'out', 'src', 'interactionHookRunner.js');
  for (const args of [[], ['--mongo-config']]) {
    const result = await new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [runner, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, stderr }));
      child.stdin.end(JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'synthetic missing config', session_id: 'synthetic-session' }));
    });
    assert.equal(result.code, 0);
    assert.match(result.stderr, /exige --mongo-config com um caminho explícito/);
  }
});
