import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { PassThrough } from 'node:stream';
import { InputLimitError, readUtf8WithinLimit } from '../src/boundedInput.js';
import { MAX_TRANSCRIPT_BYTES, TranscriptResponseExtractor } from '../src/transcriptResponseExtractor.js';

test('limita stdin por bytes, preserva UTF-8 multibyte e rejeita o byte acima do limite', async () => {
  const input = new PassThrough();
  const bytes = Buffer.from('ação', 'utf8');
  const read = readUtf8WithinLimit(input, bytes.byteLength);
  input.end(Buffer.concat([bytes.subarray(0, 3), bytes.subarray(3)]));
  assert.equal(await read, 'ação');

  const oversized = new PassThrough();
  const oversizedRead = readUtf8WithinLimit(oversized, bytes.byteLength);
  oversized.end(Buffer.concat([bytes, Buffer.from('x')]));
  await assert.rejects(oversizedRead, InputLimitError);
});

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

test('não retorna resposta assistant que contenha credencial sintética', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-dev-assistant-transcript-'));
  try {
    const path = join(directory, 'sensitive.jsonl');
    await writeFile(path, JSON.stringify({ role: 'assistant', content: `Authorization: Bearer ${'z'.repeat(24)}` }), 'utf8');
    assert.deepEqual(await new TranscriptResponseExtractor().extractFinalAssistantResponse(path), {
      kind: 'UNAVAILABLE', reason: 'SENSITIVE_RESPONSE',
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
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

test('rejeita transcript acima do limite de bytes sem extrair resposta parcial', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-dev-assistant-transcript-'));
  try {
    const path = join(directory, 'large.json');
    await writeFile(path, Buffer.alloc(MAX_TRANSCRIPT_BYTES + 1, 0x78));

    assert.deepEqual(
      await new TranscriptResponseExtractor().extractFinalAssistantResponse(path),
      { kind: 'UNAVAILABLE', reason: 'TRANSCRIPT_TOO_LARGE' },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('aceita transcript exatamente no limite de bytes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-dev-assistant-transcript-'));
  try {
    const path = join(directory, 'limit.json');
    const prefix = '{"role":"assistant","content":"ok","filler":"';
    const suffix = '"}';
    const content = 'x'.repeat(MAX_TRANSCRIPT_BYTES - Buffer.byteLength(prefix + suffix));
    const transcript = prefix + content + suffix;
    assert.equal(Buffer.byteLength(transcript), MAX_TRANSCRIPT_BYTES);
    await writeFile(path, transcript, 'utf8');

    const result = await new TranscriptResponseExtractor().extractFinalAssistantResponse(path);
    assert.equal(result.kind, 'FOUND');
    assert.equal(result.response, 'ok');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('trata JSON inválido, JSONL inválido e arquivo vazio como indisponíveis', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-dev-assistant-transcript-'));
  try {
    const extractor = new TranscriptResponseExtractor();
    for (const [name, content] of [
      ['invalid.json', '{'],
      ['invalid.jsonl', '{"role":"assistant"}\nnot-json\n'],
      ['empty.jsonl', ' \n\t'],
    ] as const) {
      const path = join(directory, name);
      await writeFile(path, content, 'utf8');
      assert.deepEqual(await extractor.extractFinalAssistantResponse(path), {
        kind: 'UNAVAILABLE',
        reason: name === 'empty.jsonl' ? 'TRANSCRIPT_EMPTY' : 'TRANSCRIPT_UNRECOGNIZED',
      });
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejeita profundidade e quantidade excessivas de linhas JSONL', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-dev-assistant-transcript-'));
  try {
    const extractor = new TranscriptResponseExtractor();
    const deepPath = join(directory, 'deep.json');
    await writeFile(deepPath, `${'['.repeat(101)}0${']'.repeat(101)}`, 'utf8');
    assert.deepEqual(await extractor.extractFinalAssistantResponse(deepPath), {
      kind: 'UNAVAILABLE',
      reason: 'TRANSCRIPT_TOO_DEEP',
    });

    const linesPath = join(directory, 'lines.jsonl');
    await writeFile(linesPath, `${'{"role":"user"}\n'.repeat(10_001)}`, 'utf8');
    assert.deepEqual(await extractor.extractFinalAssistantResponse(linesPath), {
      kind: 'UNAVAILABLE',
      reason: 'TRANSCRIPT_TOO_MANY_LINES',
    });

    const objectsPath = join(directory, 'objects.json');
    await writeFile(objectsPath, `[${Array.from({ length: 50_001 }, () => '{}').join(',')}]`, 'utf8');
    assert.deepEqual(await extractor.extractFinalAssistantResponse(objectsPath), {
      kind: 'UNAVAILABLE',
      reason: 'TRANSCRIPT_TOO_MANY_OBJECTS',
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('não persiste resposta final acima do limite de texto', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-dev-assistant-transcript-'));
  try {
    const path = join(directory, 'response-too-large.json');
    await writeFile(path, JSON.stringify({ role: 'assistant', content: 'x'.repeat(2 * 1024 * 1024 + 1) }), 'utf8');
    assert.deepEqual(await new TranscriptResponseExtractor().extractFinalAssistantResponse(path), {
      kind: 'UNAVAILABLE',
      reason: 'FINAL_RESPONSE_TOO_LARGE',
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('classifica leitura interrompida ou com erro sem expor conteúdo', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-dev-assistant-transcript-'));
  try {
    const extractor = new TranscriptResponseExtractor();
    assert.deepEqual(await extractor.extractFinalAssistantResponse(directory), {
      kind: 'UNAVAILABLE',
      reason: 'TRANSCRIPT_READ_FAILED',
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
