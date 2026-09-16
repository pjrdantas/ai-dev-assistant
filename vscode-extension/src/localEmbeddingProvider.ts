import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type * as ort from 'onnxruntime-web';

export interface LocalEmbeddingProvider {
  generate(text: string): Promise<readonly number[]>;
}

export interface LoadedLocalEmbeddingModel {
  readonly tokenizer: TokenizerInstance;
  readonly session: ort.InferenceSession;
  readonly runtime: typeof import('onnxruntime-web');
}

export type LocalEmbeddingInitializer = () => Promise<LoadedLocalEmbeddingModel>;

const MODEL_FILE = 'model.onnx';
const TOKENIZER_FILE = 'tokenizer.json';
const MODEL_SHA256 = '98a01d88b7de996cdea58c32ca71208c09968d143798814b2ea09d3439dc334f';
const TOKENIZER_SHA256 = '2c3387be76557bd40970cec13153b3bbf80407865484b209e655e5e4729076b8';
const MAX_TOKENS = 128;
const DIMENSION = 384;
const TEXT_PREFIX = 'query: ';

/**
 * Executes the fixed, bundled MiniLM model locally. Initialization is lazy: it
 * happens only when searchMemory needs semantic search. The memory is consulted
 * before the AI Dev Assistant produces a new technical solution in the
 * GitHub Copilot-orchestrated agent loop.
 */
export class OnnxLocalEmbeddingProvider implements LocalEmbeddingProvider {
  private initialization: Promise<LoadedLocalEmbeddingModel> | undefined;

  public constructor(
    private readonly modelDirectory: string,
    private readonly modelInitializer?: LocalEmbeddingInitializer,
  ) {}

  public async generate(text: string): Promise<readonly number[]> {
    const model = await this.load();
    const encoding = model.tokenizer.encode(`${TEXT_PREFIX}${text}`);
    const sequenceLength = Math.min(MAX_TOKENS, encoding.ids.length);
    if (sequenceLength === 0) {
      throw new Error('O tokenizer local não produziu tokens utilizáveis.');
    }

    const inputIds = new BigInt64Array(MAX_TOKENS);
    const attentionMask = new BigInt64Array(MAX_TOKENS);
    const tokenTypeIds = new BigInt64Array(MAX_TOKENS);
    for (let index = 0; index < sequenceLength; index += 1) {
      const token = encoding.ids[index];
      if (token === undefined) {
        throw new Error('O tokenizer local retornou uma sequência inválida.');
      }
      inputIds[index] = BigInt(token);
      attentionMask[index] = 1n;
    }

    const outputs = await model.session.run({
      input_ids: new model.runtime.Tensor('int64', inputIds, [1, MAX_TOKENS]),
      attention_mask: new model.runtime.Tensor('int64', attentionMask, [1, MAX_TOKENS]),
      token_type_ids: new model.runtime.Tensor('int64', tokenTypeIds, [1, MAX_TOKENS]),
    });
    const hiddenState = outputs.last_hidden_state;
    if (hiddenState === undefined || !(hiddenState.data instanceof Float32Array)) {
      throw new Error('O modelo ONNX local não retornou embeddings de tokens.');
    }
    return meanPoolAndNormalize(hiddenState.data, sequenceLength);
  }

  private load(): Promise<LoadedLocalEmbeddingModel> {
    this.initialization ??= (this.modelInitializer ?? (() => this.initialize()))();
    return this.initialization;
  }

  private async initialize(): Promise<LoadedLocalEmbeddingModel> {
    const tokenizerPath = join(this.modelDirectory, TOKENIZER_FILE);
    const modelPath = join(this.modelDirectory, MODEL_FILE);
    const [tokenizerBytes, modelBytes] = await Promise.all([
      readFile(tokenizerPath),
      readFile(modelPath),
    ]);
    verifyChecksum(tokenizerBytes, TOKENIZER_SHA256, TOKENIZER_FILE);
    verifyChecksum(modelBytes, MODEL_SHA256, MODEL_FILE);
    const { Tokenizer } = await import('@huggingface/tokenizers');
    const runtime = await import('onnxruntime-web');
    const tokenizer = new Tokenizer(JSON.parse(tokenizerBytes.toString('utf8')), {});
    const session = await runtime.InferenceSession.create(modelBytes);
    const inputs = new Set(session.inputNames);
    if (!inputs.has('input_ids') || !inputs.has('attention_mask') || !inputs.has('token_type_ids')) {
      throw new Error('O modelo ONNX local possui entradas incompatíveis.');
    }
    return { tokenizer, session, runtime };
  }
}

interface TokenizerInstance {
  encode(text: string): { readonly ids: readonly number[] };
}

function verifyChecksum(content: Uint8Array, expected: string, fileName: string): void {
  const actual = createHash('sha256').update(content).digest('hex');
  if (actual !== expected) {
    throw new Error(`A verificação de integridade falhou para ${fileName}.`);
  }
}

function meanPoolAndNormalize(hiddenState: Float32Array, sequenceLength: number): readonly number[] {
  if (hiddenState.length !== MAX_TOKENS * DIMENSION) {
    throw new Error('O modelo ONNX local retornou uma dimensão incompatível.');
  }
  const values = new Array<number>(DIMENSION).fill(0);
  for (let token = 0; token < sequenceLength; token += 1) {
    for (let dimension = 0; dimension < DIMENSION; dimension += 1) {
      values[dimension] = (values[dimension] ?? 0) + (hiddenState[(token * DIMENSION) + dimension] ?? 0);
    }
  }
  let squaredNorm = 0;
  for (let dimension = 0; dimension < DIMENSION; dimension += 1) {
    const value = (values[dimension] ?? 0) / sequenceLength;
    values[dimension] = value;
    squaredNorm += value * value;
  }
  const norm = Math.sqrt(squaredNorm);
  if (!Number.isFinite(norm) || norm === 0) {
    throw new Error('O modelo ONNX local produziu um embedding inválido.');
  }
  return values.map((value) => value / norm);
}
