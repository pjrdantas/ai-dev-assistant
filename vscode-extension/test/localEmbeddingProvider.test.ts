import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import {
  LoadedLocalEmbeddingModel,
  OnnxLocalEmbeddingProvider,
} from '../src/localEmbeddingProvider.js';

test('não inicializa ONNX ao construir a dependência usada na ativação', () => {
  let initializations = 0;
  new OnnxLocalEmbeddingProvider('unused', async () => {
    initializations += 1;
    return loadedModel();
  });

  assert.equal(initializations, 0);
});

test('inicializa ONNX uma vez na primeira busca semântica e reutiliza a sessão', async () => {
  let initializations = 0;
  const provider = new OnnxLocalEmbeddingProvider('unused', async () => {
    initializations += 1;
    return loadedModel();
  });

  await provider.generate('primeira busca semântica');
  await provider.generate('segunda busca semântica');

  assert.equal(initializations, 1);
});

test('compartilha uma única inicialização entre buscas semânticas concorrentes', async () => {
  let initializations = 0;
  let releaseInitialization: (() => void) | undefined;
  const initialized = new Promise<void>((resolve) => { releaseInitialization = resolve; });
  const provider = new OnnxLocalEmbeddingProvider('unused', async () => {
    initializations += 1;
    await initialized;
    return loadedModel();
  });

  const first = provider.generate('busca A');
  const second = provider.generate('busca B');
  assert.equal(initializations, 1);
  releaseInitialization?.();
  await Promise.all([first, second]);

  assert.equal(initializations, 1);
});

test('falha de ONNX é propagada como falha local sem impedir uma instância de existir', async () => {
  const provider = new OnnxLocalEmbeddingProvider('unused', async () => {
    throw new Error('ONNX indisponível');
  });

  await assert.rejects(() => provider.generate('busca semântica'), /ONNX indisponível/);
});

test('mede a similaridade real das duas formulações observadas de pom.xml', async () => {
  const provider = new OnnxLocalEmbeddingProvider(
    join(process.cwd(), 'models', 'paraphrase-multilingual-minilm'),
  );
  const first = await provider.generate('Conhecimento sobre o pom.xml deste projeto');
  const second = await provider.generate('Registrar conhecimento reutilizável sobre o pom.xml do projeto desafio-votacao-apenas service.');
  const similarity = cosineSimilarity(first, second);

  assert.ok(similarity >= 0.85 && similarity < 0.86, `similaridade real inesperada: ${similarity}`);
});

function loadedModel(): LoadedLocalEmbeddingModel {
  class Tensor {
    public constructor(
      public readonly type: string,
      public readonly data: BigInt64Array,
      public readonly dims: readonly number[],
    ) {}
  }

  return {
    tokenizer: { encode: () => ({ ids: [1, 2] }) },
    runtime: { Tensor } as unknown as typeof import('onnxruntime-web'),
    session: {
      inputNames: ['input_ids', 'attention_mask', 'token_type_ids'],
      async run() {
        return { last_hidden_state: { data: new Float32Array(128 * 384).fill(1) } };
      },
    } as unknown as LoadedLocalEmbeddingModel['session'],
  };
}

function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  return left.reduce((total, value, index) => total + value * (right[index] ?? 0), 0);
}
