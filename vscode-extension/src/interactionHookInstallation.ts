import { mkdir, readFile, readdir, rmdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const MANAGED_MARKER = '.ai-dev-assistant-managed';
const POWERSHELL_LAUNCHER = 'run-interaction-hook.ps1';
const SHELL_LAUNCHER = 'run-interaction-hook.sh';
const MANAGED_MARKER_CONTENT = 'AI Dev Assistant agent-scoped interaction capture\n';

export interface InteractionHookInstallation {
  readonly directory: string;
  readonly powershellLauncher: string;
  readonly shellLauncher: string;
}

export async function installAgentScopedHookRunner(homeDirectory: string, nodeExecutable: string, runner: string): Promise<InteractionHookInstallation> {
  const installation = installationAt(homeDirectory);
  await mkdir(installation.directory, { recursive: true });
  await Promise.all([
    writeFile(join(installation.directory, MANAGED_MARKER), MANAGED_MARKER_CONTENT, 'utf8'),
    writeFile(installation.powershellLauncher, powershellLauncher(nodeExecutable, runner), 'utf8'),
    writeFile(installation.shellLauncher, shellLauncher(nodeExecutable, runner), 'utf8'),
  ]);
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

  for (const file of [installation.powershellLauncher, installation.shellLauncher, join(installation.directory, MANAGED_MARKER)]) {
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
  return { directory, powershellLauncher: join(directory, POWERSHELL_LAUNCHER), shellLauncher: join(directory, SHELL_LAUNCHER) };
}

function powershellLauncher(nodeExecutable: string, runner: string): string {
  return `$ErrorActionPreference = 'Stop'
$env:ELECTRON_RUN_AS_NODE = '1'

$hookInput = @($input) -join [Environment]::NewLine

$hookInput | & '${powershellQuote(nodeExecutable)}' '${powershellQuote(runner)}'

exit $LASTEXITCODE
`;
}

function shellLauncher(nodeExecutable: string, runner: string): string {
  return `#!/usr/bin/env sh\nexport ELECTRON_RUN_AS_NODE=1\nexec '${shellQuote(nodeExecutable)}' '${shellQuote(runner)}'\n`;
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
