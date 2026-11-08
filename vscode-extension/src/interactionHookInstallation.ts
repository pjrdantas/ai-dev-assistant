import { mkdir, readFile, readdir, rmdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MongoHookConfiguration, defaultMongoHookConfiguration, mongoHookConfigurationPath, normalizeMongoHookConfiguration, writeMongoHookConfiguration } from './mongoHookConfiguration.js';

const MANAGED_MARKER = '.ai-dev-assistant-managed';
const POWERSHELL_LAUNCHER = 'run-interaction-hook.ps1';
const SHELL_LAUNCHER = 'run-interaction-hook.sh';
const MANAGED_MARKER_CONTENT = 'AI Dev Assistant agent-scoped interaction capture\n';

export interface InteractionHookInstallation {
  readonly directory: string;
  readonly powershellLauncher: string;
  readonly shellLauncher: string;
  readonly mongoConfiguration: string;
}

export type AgentScopedHookRunnerState = 'current' | 'stale' | 'unknown' | 'not-installed';

export async function installAgentScopedHookRunner(homeDirectory: string, nodeExecutable: string, runner: string, configuration: MongoHookConfiguration = defaultMongoHookConfiguration()): Promise<InteractionHookInstallation> {
  const normalizedConfiguration = normalizeMongoHookConfiguration(configuration);
  const installation = installationAt(homeDirectory);
  const markerPath = join(installation.directory, MANAGED_MARKER);
  const existingMarker = await readOptional(markerPath);
  const existingLaunchers = await Promise.all([installation.powershellLauncher, installation.shellLauncher].map(readOptional));
  if (existingMarker !== MANAGED_MARKER_CONTENT && existingLaunchers.some((content) => content !== undefined)) {
    throw new Error('Launchers preexistentes sem marcador válido do AI Dev Assistant; habilitação recusada para preservar a propriedade dos arquivos.');
  }
  if (existingMarker === MANAGED_MARKER_CONTENT && existingLaunchers.some((content, index) => content !== undefined && !isRecognizableManagedLauncher(content, index === 0))) {
    throw new Error('A instalação marcada contém launcher não reconhecido; nenhum arquivo foi sobrescrito. Revise os artefatos e autorize uma reinstalação explícita.');
  }
  const paths = [join(installation.directory, MANAGED_MARKER), installation.mongoConfiguration, installation.powershellLauncher, installation.shellLauncher];
  const snapshot = await Promise.all(paths.map(async (path) => ({ path, content: await readOptional(path) })));
  await mkdir(installation.directory, { recursive: true });
  try {
    await writeFile(join(installation.directory, MANAGED_MARKER), MANAGED_MARKER_CONTENT, 'utf8');
    await writeMongoHookConfiguration(installation.mongoConfiguration, normalizedConfiguration);
    await writeFile(installation.powershellLauncher, powershellLauncher(nodeExecutable, runner, installation.mongoConfiguration), 'utf8');
    await writeFile(installation.shellLauncher, shellLauncher(nodeExecutable, runner, installation.mongoConfiguration), 'utf8');
  } catch (error) {
    await Promise.all(snapshot.map(async ({ path, content }) => content === undefined ? unlinkIfPresent(path) : writeFile(path, content)));
    throw error;
  }
  return installation;
}

export async function uninstallAgentScopedHookRunner(homeDirectory: string): Promise<boolean> {
  const installation = installationAt(homeDirectory);
  try {
    if (await readFile(join(installation.directory, MANAGED_MARKER), 'utf8') !== MANAGED_MARKER_CONTENT) return false;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }

  for (const file of [installation.powershellLauncher, installation.shellLauncher, installation.mongoConfiguration, join(installation.directory, MANAGED_MARKER)]) {
    try { await unlink(file); } catch (error) { if (!isMissing(error)) throw error; }
  }
  try {
    if ((await readdir(installation.directory)).length === 0) await rmdir(installation.directory);
  } catch (error) { if (!isMissing(error)) throw error; }
  return true;
}

/** Removes only the global hook format written by AI Dev Assistant versions before agent-scoped hooks. */
export async function removeLegacyGlobalInteractionHook(homeDirectory: string): Promise<boolean> {
  const legacyPath = join(homeDirectory, '.copilot', 'hooks', 'ai-dev-assistant.json');
  try {
    const content = await readFile(legacyPath, 'utf8');
    if (!isLegacyAiDevAssistantHook(content)) return false;
    await unlink(legacyPath);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

export function installationAt(homeDirectory: string): InteractionHookInstallation {
  const directory = join(homeDirectory, '.copilot', 'ai-dev-assistant');
  return { directory, powershellLauncher: join(directory, POWERSHELL_LAUNCHER), shellLauncher: join(directory, SHELL_LAUNCHER), mongoConfiguration: mongoHookConfigurationPath(directory) };
}

export async function isAgentScopedHookRunnerInstalled(homeDirectory: string): Promise<boolean> {
  try { return await readFile(join(installationAt(homeDirectory).directory, MANAGED_MARKER), 'utf8') === MANAGED_MARKER_CONTENT; }
  catch (error) { if (isMissing(error)) return false; throw error; }
}

/**
 * Detects an outdated runner without treating an unknown launcher as owned.
 * A valid marker plus a recognizable launcher shape is the ownership proof used
 * for automatic repair after an extension update.
 */
export async function agentScopedHookRunnerState(
  homeDirectory: string,
  nodeExecutable: string,
  runner: string,
): Promise<AgentScopedHookRunnerState> {
  const installation = installationAt(homeDirectory);
  if (await readOptional(join(installation.directory, MANAGED_MARKER)) !== MANAGED_MARKER_CONTENT) return 'not-installed';
  const [powershell, shell] = await Promise.all([readOptional(installation.powershellLauncher), readOptional(installation.shellLauncher)]);
  if (powershell === undefined || shell === undefined) return 'unknown';
  if (!isRecognizableManagedLauncher(powershell, true) || !isRecognizableManagedLauncher(shell, false)) return 'unknown';
  return powershell === powershellLauncher(nodeExecutable, runner, installation.mongoConfiguration)
    && shell === shellLauncher(nodeExecutable, runner, installation.mongoConfiguration)
    ? 'current'
    : 'stale';
}

function powershellLauncher(nodeExecutable: string, runner: string, configuration: string): string {
  return `$ErrorActionPreference = 'Stop'
$env:ELECTRON_RUN_AS_NODE = '1'

$hookInput = @($input) -join [Environment]::NewLine

$hookInput | & '${powershellQuote(nodeExecutable)}' '${powershellQuote(runner)}' '--mongo-config' '${powershellQuote(configuration)}'

exit $LASTEXITCODE
`;
}

function shellLauncher(nodeExecutable: string, runner: string, configuration: string): string {
  return `#!/usr/bin/env sh\nexport ELECTRON_RUN_AS_NODE=1\nexec '${shellQuote(nodeExecutable)}' '${shellQuote(runner)}' '--mongo-config' '${shellQuote(configuration)}'\n`;
}

function isRecognizableManagedLauncher(content: string, powershell: boolean): boolean {
  if (powershell) {
    return content.startsWith("$ErrorActionPreference = 'Stop'\n$env:ELECTRON_RUN_AS_NODE = '1'\n")
      && content.includes('$hookInput = @($input) -join [Environment]::NewLine')
      && /\| & '.+' '.+' '--mongo-config' '.+'\n\nexit \$LASTEXITCODE\n$/s.test(content);
  }
  return /^#!\/usr\/bin\/env sh\nexport ELECTRON_RUN_AS_NODE=1\nexec '.+' '.+' '--mongo-config' '.+'\n$/s.test(content);
}

function powershellQuote(value: string): string { return value.replaceAll("'", "''"); }
function shellQuote(value: string): string { return value.replaceAll("'", "'\"'\"'"); }
function isLegacyAiDevAssistantHook(content: string): boolean {
  try {
    const parsed = JSON.parse(content) as { hooks?: { UserPromptSubmit?: unknown[] } };
    return parsed.hooks?.UserPromptSubmit?.some((entry) => typeof entry === 'object' && entry !== null && 'type' in entry && 'command' in entry && entry.type === 'command' && typeof entry.command === 'string' && entry.command.includes('interactionHookRunner.js')) === true;
  } catch { return false; }
}
function isMissing(error: unknown): boolean { return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'; }
async function readOptional(path: string): Promise<string | undefined> { try { return await readFile(path, 'utf8'); } catch (error) { if (isMissing(error)) return undefined; throw error; } }
async function unlinkIfPresent(path: string): Promise<void> { try { await unlink(path); } catch (error) { if (!isMissing(error)) throw error; } }
