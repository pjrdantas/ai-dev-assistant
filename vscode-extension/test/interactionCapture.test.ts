import assert from 'node:assert/strict';
import test from 'node:test';
import { interactionFromUserPrompt } from '../src/interactionCapture.js';

test('captura prompt literal, multilinha, acentos e sessões distintas sem ONNX', () => {
  const first = interactionFromUserPrompt({ hook_event_name: 'UserPromptSubmit', prompt: 'Olá\nExplique acentuação: ação', session_id: 'a', cwd: 'C:/projeto', timestamp: '2026-01-01T00:00:00.000Z' });
  const second = interactionFromUserPrompt({ hook_event_name: 'UserPromptSubmit', prompt: 'Olá\nExplique acentuação: ação', session_id: 'b', cwd: 'C:/projeto', timestamp: '2026-01-01T00:00:01.000Z' });
  assert.equal(first.originalRequest, 'Olá\nExplique acentuação: ação');
  assert.equal(first.status, 'PENDING');
  assert.equal(first.sessionId, 'a');
  assert.notEqual(first.interactionId, second.interactionId);
  assert.notEqual(first.sessionId, second.sessionId);
});

test('redige segredo sem persistir o prompt bruto', () => {
  const interaction = interactionFromUserPrompt({ hook_event_name: 'UserPromptSubmit', prompt: 'use ghp_abcdefghijklmnopqrstuvwxyz123456', session_id: 'a' });
  assert.equal(interaction.status, 'SKIPPED_SENSITIVE');
  assert.equal(interaction.originalRequest, '[REDACTED SENSITIVE PROMPT]');
});
