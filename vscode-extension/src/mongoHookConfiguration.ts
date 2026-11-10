import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';

export const DEFAULT_MONGO_URI = 'mongodb://127.0.0.1:27017';
export const DEFAULT_MONGO_DATABASE = 'ai_dev_assistant_v2';
const LEGACY_MONGO_DATABASE = 'ai_dev_assistant';

export interface MongoHookConfiguration {
  readonly uri: string;
  readonly database: string;
}

export class MongoHookConfigurationError extends Error {
  public constructor(message: string, public readonly kind: 'missing' | 'unreadable' | 'invalid' | 'validation' = 'validation') {
    super(message);
    this.name = 'MongoHookConfigurationError';
  }
}

type WindowsAclRunner = (path: string, args: readonly string[]) => Promise<void>;

const WINDOWS_SYSTEM_SID = 'S-1-5-18';
const WINDOWS_BUILTIN_ADMINISTRATORS_SID = 'S-1-5-32-544';

export function normalizeMongoHookConfiguration(configuration: Partial<MongoHookConfiguration>): MongoHookConfiguration {
  const uri = configuration.uri?.trim();
  const database = configuration.database?.trim();
  if (uri === undefined || !/^mongodb(?:\+srv)?:\/\/\S+$/.test(uri)) {
    throw new MongoHookConfigurationError('URI MongoDB ausente ou inválida.');
  }
  if (database === undefined || database.length === 0 || /[\\/\."$\0]/.test(database)) {
    throw new MongoHookConfigurationError('Database MongoDB ausente ou inválido.');
  }
  // A distribuição 0.1.14 não consulta nem altera a base antiga, inclusive quando
  // ela ainda está fixada nas Settings ou em snapshots de hooks instalados.
  return { uri, database: database === LEGACY_MONGO_DATABASE ? DEFAULT_MONGO_DATABASE : database };
}

export function defaultMongoHookConfiguration(): MongoHookConfiguration {
  return { uri: DEFAULT_MONGO_URI, database: DEFAULT_MONGO_DATABASE };
}

export function mongoHookConfigurationPath(directory: string): string {
  return join(directory, 'mongodb-config.json');
}

export async function writeMongoHookConfiguration(path: string, configuration: MongoHookConfiguration, aclRunner?: WindowsAclRunner): Promise<void> {
  const normalized = normalizeMongoHookConfiguration(configuration);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    if (process.platform === 'win32') await restrictWindowsFilePermissions(dirname(path), true, aclRunner);
    await writeFile(temporary, JSON.stringify({ schemaVersion: 1, ...normalized }) + '\n', { encoding: 'utf8', mode: 0o600 });
    await chmod(temporary, 0o600);
    if (process.platform === 'win32') await restrictWindowsFilePermissions(temporary, false, aclRunner);
    await rename(temporary, path);
  } catch (error) {
    try { await unlink(temporary); } catch { /* best effort cleanup */ }
    throw error;
  }
}

export async function readMongoHookConfiguration(path: string): Promise<MongoHookConfiguration> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if (isMissing(error)) throw new MongoHookConfigurationError('Arquivo de configuração MongoDB do hook não encontrado.', 'missing');
    throw new MongoHookConfigurationError('Não foi possível ler a configuração MongoDB do hook.', 'unreadable');
  }
  try {
    const parsed = JSON.parse(raw) as Partial<MongoHookConfiguration> & { schemaVersion?: unknown };
    if (parsed.schemaVersion !== 1) throw new Error('schema');
    return normalizeMongoHookConfiguration(parsed);
  } catch (error) {
    if (error instanceof MongoHookConfigurationError) throw error;
    throw new MongoHookConfigurationError('Arquivo de configuração MongoDB do hook inválido.', 'invalid');
  }
}

export async function loadMongoHookConfiguration(path: string | undefined): Promise<MongoHookConfiguration> {
  return path === undefined ? defaultMongoHookConfiguration() : readMongoHookConfiguration(path);
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

async function restrictWindowsFilePermissions(path: string, directory: boolean, aclRunner = defaultWindowsAclRunner): Promise<void> {
  const currentUserSid = await currentWindowsUserSid();
  const currentUserPermission = directory ? '(OI)(CI)(F)' : '(F)';
  await aclRunner(path, ['/reset', '/q']);
  await aclRunner(path, [
    '/inheritance:r',
    '/grant:r', `*${WINDOWS_SYSTEM_SID}:(F)`,
    '/grant:r', `*${WINDOWS_BUILTIN_ADMINISTRATORS_SID}:(F)`,
    '/grant:r', `*${currentUserSid}:${currentUserPermission}`,
  ]);
}

async function defaultWindowsAclRunner(path: string, args: readonly string[]): Promise<void> {
  await promisify(execFile)('icacls.exe', [path, ...args], { windowsHide: true, windowsVerbatimArguments: false });
}

async function currentWindowsUserSid(): Promise<string> {
  const { stdout } = await promisify(execFile)('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { windowsHide: true, windowsVerbatimArguments: false });
  const sid = stdout.match(/S-1-(?:\d+-)+\d+/)?.[0];
  if (sid === undefined) throw new Error('SID do usuário Windows ausente para proteger a configuração MongoDB.');
  return sid;
}
