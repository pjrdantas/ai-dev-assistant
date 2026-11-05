import { createHash, randomUUID } from 'node:crypto';

import type { InteractionRecord, InteractionStatus } from './mongoInteractionStore.js';

const SENSITIVE_PATTERNS = [/ghp_[A-Za-z0-9]{20,}/, /github_pat_[A-Za-z0-9_]{20,}/, /sk-[A-Za-z0-9_-]{20,}/, /AKIA[0-9A-Z]{16}/, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/];

export interface UserPromptSubmitInput {
  readonly hook_event_name: 'UserPromptSubmit';
  readonly prompt: string;
  readonly session_id?: string;
  readonly cwd?: string;
  readonly timestamp?: string;
}

export function interactionFromUserPrompt(input: UserPromptSubmitInput, now: () => Date = () => new Date()): InteractionRecord {
  const createdAt = input.timestamp === undefined ? now() : new Date(input.timestamp);
  const sensitive = SENSITIVE_PATTERNS.some((pattern) => pattern.test(input.prompt));
  const cwd = input.cwd;
  return {
    interactionId: randomUUID(),
    sessionId: input.session_id ?? 'unknown-session',
    workspaceKey: workspaceKey(cwd),
    originalRequest: sensitive ? '[REDACTED SENSITIVE PROMPT]' : input.prompt,
    status: sensitive ? 'SKIPPED_SENSITIVE' : 'PENDING',
    createdAt: Number.isNaN(createdAt.valueOf()) ? now() : createdAt,
    cwd,
    metadata: { source: 'UserPromptSubmit' },
  };
}

export function workspaceKey(cwd: string | undefined): string | undefined {
  const normalized = normalizeWorkspacePath(cwd);
  return normalized === undefined ? undefined : createHash('sha256').update(normalized).digest('hex');
}

export function normalizeWorkspacePath(cwd: string | undefined): string | undefined {
  if (cwd === undefined || cwd.trim() === '') return undefined;
  const rawPath = cwd.trim().replaceAll('\\', '/').replace(/\/{2,}/g, '/');
  const windowsDrive = /^([A-Za-z]):(?:\/|$)/.exec(rawPath);
  const unc = /^\/\/([^/]+)\/([^/]+)(?:\/|$)/.exec(cwd.trim().replaceAll('\\', '/'));
  if (windowsDrive !== null) {
    return `${windowsDrive[1]!.toLowerCase()}:/${normalizePathSegments(rawPath.slice(windowsDrive[0].length), true).join('/')}`
      .replace(/\/$/, '/')
      .toLowerCase();
  }
  if (unc !== null) {
    const uncRoot = `//${unc[1]}/${unc[2]}`;
    const rest = cwd.trim().replaceAll('\\', '/').slice(unc[0].length);
    const suffix = normalizePathSegments(rest, true).join('/');
    return `${uncRoot}${suffix === '' ? '' : `/${suffix}`}`.toLowerCase();
  }
  const isPosixAbsolute = rawPath.startsWith('/');
  const segments = normalizePathSegments(isPosixAbsolute ? rawPath.slice(1) : rawPath, isPosixAbsolute);
  const normalized = `${isPosixAbsolute ? '/' : ''}${segments.join('/')}`;
  return normalized === '' && isPosixAbsolute ? '/' : normalized;
}

function normalizePathSegments(path: string, absolute: boolean): string[] {
  const segments: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (segments.length > 0 && segments.at(-1) !== '..') segments.pop();
      else if (!absolute) segments.push('..');
      continue;
    }
    segments.push(segment);
  }
  return segments;
}

export interface WorkspaceOrigin {
  readonly workspaceKey: string;
  readonly normalizedPath: string;
}

export function resolveWorkspaceOrigin(cwd: string | undefined, roots: readonly WorkspaceOrigin[]): WorkspaceOrigin | undefined {
  const normalizedCwd = normalizeWorkspacePath(cwd);
  if (normalizedCwd === undefined) return undefined;
  const matches = roots.filter((root) => isPathWithinWorkspaceOrigin(normalizedCwd, root.normalizedPath));
  if (matches.length === 0) return undefined;
  const longestLength = Math.max(...matches.map((root) => root.normalizedPath.length));
  const mostSpecific = matches.filter((root) => root.normalizedPath.length === longestLength);
  return new Set(mostSpecific.map((root) => root.workspaceKey)).size === 1 ? mostSpecific[0] : undefined;
}

function isPathWithinWorkspaceOrigin(path: string, root: string): boolean {
  return path === root || (root.endsWith('/') ? path.startsWith(root) : path.startsWith(`${root}/`));
}

export function manifestBelongsToWorkspaceOrigin(uriPath: string, originWorkspaceKey: string | undefined, origins: readonly WorkspaceOrigin[]): boolean {
  return originWorkspaceKey !== undefined && resolveWorkspaceOrigin(uriPath, origins)?.workspaceKey === originWorkspaceKey;
}
