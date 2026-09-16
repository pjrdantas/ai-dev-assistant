import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { OnnxLocalEmbeddingProvider } = require('../vscode-extension/out/src/localEmbeddingProvider.js');
const modelDirectory = new URL('../vscode-extension/models/paraphrase-multilingual-minilm/', import.meta.url);
const provider = new OnnxLocalEmbeddingProvider(fileURLToPath(modelDirectory));
const vector = await provider.generate('Olá, mundo.');

console.log(JSON.stringify({
  vectorDimension: vector.length,
  l2Norm: Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)),
}));
