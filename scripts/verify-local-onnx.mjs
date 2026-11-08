import { createRequire } from 'node:module';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { OnnxLocalEmbeddingProvider } = require('../vscode-extension/out/src/localEmbeddingProvider.js');
const modelDirectory = new URL('../vscode-extension/models/paraphrase-multilingual-minilm/', import.meta.url);
for (const file of ['model.onnx', 'tokenizer.json']) {
  const info = await stat(new URL(file, modelDirectory));
  if (!info.isFile() || info.size === 0) throw new Error(`Asset ONNX inválido: ${file}`);
}
const source = await (await import('node:fs/promises')).readFile(new URL('../vscode-extension/src/localEmbeddingProvider.ts', import.meta.url), 'utf8');
if (!source.includes("await import('onnxruntime-web')") || source.includes("import * as ort from 'onnxruntime-web'")) {
  throw new Error('A inicialização ONNX não está lazy.');
}
const provider = new OnnxLocalEmbeddingProvider(fileURLToPath(modelDirectory));
const vector = await provider.generate('Olá, mundo.');
if (vector.length !== 384) throw new Error(`Embedding inesperado: ${vector.length}-D`);

console.log(JSON.stringify({
  vectorDimension: vector.length,
  l2Norm: Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)),
}));
