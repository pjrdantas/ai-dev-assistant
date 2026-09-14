import assert from 'node:assert/strict';
import test from 'node:test';

import { HttpAssistantBackend, validateLocalBackendUrl } from '../src/httpAssistantBackend.js';

test('prepares prompts only against the configured local backend', async () => {
  let requestedUrl = '';
  let submittedBody: unknown;
  const fetchImplementation = (async (input: string | URL | Request, init?: RequestInit) => {
    requestedUrl = input.toString();
    submittedBody = JSON.parse(String(init?.body));
    return Response.json({
      requestId: '11111111-1111-1111-1111-111111111111',
      status: 'COMPLETED',
      response: 'Local solution',
      source: 'LOCAL_MEMORY',
      matchType: 'FULL',
      similarity: 0.97,
      aiCalled: false,
      externalSearchCalled: false,
      memoryId: '22222222-2222-2222-2222-222222222222',
    });
  }) as typeof fetch;
  const backend = new HttpAssistantBackend(
    () => ({ baseUrl: 'http://127.0.0.1:8080', timeoutMs: 5_000 }),
    fetchImplementation,
  );

  const result = await backend.prepare('Create an endpoint');

  assert.equal(requestedUrl, 'http://127.0.0.1:8080/api/v1/prompts');
  assert.deepEqual(submittedBody, {
    prompt: 'Create an endpoint',
    projectContext: null,
  });
  assert.equal(result.status, 'COMPLETED');
});

test('rejects non-local and credential-bearing backend URLs', () => {
  assert.throws(() => validateLocalBackendUrl('https://example.com'), /localhost/);
  assert.throws(() => validateLocalBackendUrl('http://user:secret@localhost:8080'), /localhost/);
  assert.throws(() => validateLocalBackendUrl('http://localhost:8080/other'), /localhost/);
});

test('does not expose backend response content in errors', async () => {
  const fetchImplementation = (async () => new Response(
    JSON.stringify({ code: 'MEMORY_UNAVAILABLE', detail: 'sensitive internal content' }),
    { status: 503, headers: { 'Content-Type': 'application/json' } },
  )) as typeof fetch;
  const backend = new HttpAssistantBackend(
    () => ({ baseUrl: 'http://localhost:8080', timeoutMs: 5_000 }),
    fetchImplementation,
  );

  await assert.rejects(
    () => backend.prepare('private prompt'),
    (error: Error) => {
      assert.match(error.message, /memória local/i);
      assert.doesNotMatch(error.message, /sensitive internal content|private prompt/);
      return true;
    },
  );
});

test('rejects an incompatible backend contract', async () => {
  const fetchImplementation = (async () => Response.json({ status: 'UNKNOWN' })) as typeof fetch;
  const backend = new HttpAssistantBackend(
    () => ({ baseUrl: 'http://localhost:8080', timeoutMs: 5_000 }),
    fetchImplementation,
  );

  await assert.rejects(() => backend.prepare('request'), /contrato incompatível/);
});

test('rejects completed responses with inconsistent memory-first metadata', async () => {
  const fetchImplementation = (async () => Response.json({
    requestId: '11111111-1111-1111-1111-111111111111',
    status: 'COMPLETED',
    response: 'Inconsistent response',
    source: 'LOCAL_MEMORY',
    matchType: 'FULL',
    similarity: 0.99,
    aiCalled: true,
    externalSearchCalled: false,
    memoryId: '22222222-2222-2222-2222-222222222222',
  })) as typeof fetch;
  const backend = new HttpAssistantBackend(
    () => ({ baseUrl: 'http://localhost:8080', timeoutMs: 5_000 }),
    fetchImplementation,
  );

  await assert.rejects(() => backend.prepare('request'), /contrato incompatível/);
});

test('rejects malformed identifiers and out-of-range similarities', async () => {
  const fetchImplementation = (async () => Response.json({
    requestId: 'not-a-uuid',
    status: 'COMPLETED',
    response: 'Invalid response',
    source: 'LOCAL_MEMORY',
    matchType: 'FULL',
    similarity: 1.1,
    aiCalled: false,
    externalSearchCalled: false,
    memoryId: '22222222-2222-2222-2222-222222222222',
  })) as typeof fetch;
  const backend = new HttpAssistantBackend(
    () => ({ baseUrl: 'http://localhost:8080', timeoutMs: 5_000 }),
    fetchImplementation,
  );

  await assert.rejects(() => backend.prepare('request'), /contrato incompatível/);
});

test('does not parse backend payloads above the configured safety bound', async () => {
  const fetchImplementation = (async () => new Response('{}', {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': '300001',
    },
  })) as typeof fetch;
  const backend = new HttpAssistantBackend(
    () => ({ baseUrl: 'http://localhost:8080', timeoutMs: 5_000 }),
    fetchImplementation,
  );

  await assert.rejects(() => backend.prepare('request'), /acima do limite permitido/);
});

test('reports local backend failures without exposing the original error', async () => {
  const fetchImplementation = (async () => {
    throw new Error('internal path and private content');
  }) as typeof fetch;
  const backend = new HttpAssistantBackend(
    () => ({ baseUrl: 'http://localhost:8080', timeoutMs: 5_000 }),
    fetchImplementation,
  );

  await assert.rejects(
    () => backend.prepare('private prompt'),
    (error: Error) => {
      assert.match(error.message, /conectar ao backend local/);
      assert.doesNotMatch(error.message, /internal path|private content|private prompt/);
      return true;
    },
  );
});
