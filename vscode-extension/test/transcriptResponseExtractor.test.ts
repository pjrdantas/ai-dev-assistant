import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { TranscriptResponseExtractor } from '../src/transcriptResponseExtractor.js';

test('extrai a última resposta assistant sem persistir o transcript', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'ai-dev-assistant-transcript-'),
  );

  try {
    const path = join(directory, 'fixture.jsonl');

    await writeFile(
      path,
      '{"role":"user","content":"pergunta"}\n{"role":"assistant","content":"resposta final"}\n',
      'utf8',
    );

    assert.deepEqual(
      await new TranscriptResponseExtractor()
        .extractFinalAssistantResponse(path),
      {
        kind: 'FOUND',
        response: 'resposta final',
      },
    );
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    });
  }
});

test('extrai resposta do formato assistant.message do transcript do VS Code', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'ai-dev-assistant-transcript-'),
  );

  try {
    const path = join(directory, 'fixture-vscode.jsonl');

    await writeFile(
      path,
      [
        JSON.stringify({
          type: 'user.message',
          data: {
            content: 'Responda apenas OK.',
          },
        }),
        JSON.stringify({
          type: 'assistant.message',
          data: {
            content: 'OK',
            parentToolCallId: null,
          },
        }),
      ].join('\n') + '\n',
      'utf8',
    );

    assert.deepEqual(
      await new TranscriptResponseExtractor()
        .extractFinalAssistantResponse(path),
      {
        kind: 'FOUND',
        response: 'OK',
      },
    );
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    });
  }
});

test('falha de transcript não fabrica resposta', async () => {
  const extractor = new TranscriptResponseExtractor();

  assert.deepEqual(
    await extractor.extractFinalAssistantResponse(undefined),
    {
      kind: 'UNAVAILABLE',
      reason: 'TRANSCRIPT_PATH_MISSING',
    },
  );

  assert.deepEqual(
    await extractor.extractFinalAssistantResponse(
      join(tmpdir(), 'inexistente-ai-dev-assistant.json'),
    ),
    {
      kind: 'UNAVAILABLE',
      reason: 'TRANSCRIPT_NOT_FOUND',
    },
  );
});