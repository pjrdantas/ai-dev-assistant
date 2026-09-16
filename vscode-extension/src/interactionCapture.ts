import { createHash, randomUUID } from 'node:crypto';

import { InteractionRecord, InteractionStatus } from './mongoInteractionStore.js';

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

export function workspaceKey(cwd: string | undefined): string {
  return createHash('sha256').update(cwd ?? 'without-workspace').digest('hex');
}
