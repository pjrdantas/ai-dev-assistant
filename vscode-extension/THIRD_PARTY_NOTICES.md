# Third-party notices

Este VSIX redistribui os artefatos e runtimes abaixo. As versões e licenças foram lidas
dos `package.json` instalados e do `package-lock.json` usados para gerar o pacote.

## Modelo de embedding

`sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`, revisão
`e8f8c211226b894fcb81acc59f3b34ba3efd5f42`, é fornecido pelo projeto
[Sentence Transformers](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2)
sob Apache-2.0. O VSIX redistribui o artefato quantizado AVX2
`onnx/model_quint8_avx2.onnx` como `models/paraphrase-multilingual-minilm/model.onnx` e
o `tokenizer.json` correspondente. Consulte também
`models/paraphrase-multilingual-minilm/README.md` para hashes e finalidade.

## Runtime distribuído

| Componente | Versão | Licença declarada | Origem |
| --- | ---: | --- | --- |
| `@huggingface/tokenizers` | 0.2.0 | Apache-2.0 | https://github.com/huggingface/tokenizers.js |
| `onnxruntime-web` | 1.29.0 | MIT | https://github.com/microsoft/onnxruntime |
| `onnxruntime-common` | 1.29.0 | MIT | https://github.com/microsoft/onnxruntime |
| `flatbuffers` | 25.9.23 | Apache-2.0 | https://github.com/google/flatbuffers |
| `long` | 5.3.2 | Apache-2.0 | https://github.com/dcodeIO/long.js |
| `guid-typescript` | 1.0.9 | ISC | https://github.com/NicolasDeveloper/guid-typescript |
| `platform` | 1.3.6 | MIT | https://github.com/bestiejs/platform.js |
| `protobufjs` e pacotes `@protobufjs/*` | 7.6.6 / 1.x / 2.0.5 | BSD-3-Clause | https://github.com/protobufjs/protobuf.js |

Os pacotes `@protobufjs/*` efetivamente distribuídos são `aspromise@1.1.2`,
`base64@1.1.2`, `codegen@2.0.5`, `eventemitter@1.1.1`, `fetch@1.1.1`, `float@1.0.2`,
`path@1.1.2`, `pool@1.1.0` e `utf8@1.1.2`.

As licenças Apache-2.0, MIT, ISC e BSD-3-Clause exigem preservar os respectivos textos
de licença e avisos de copyright/atribuição aplicáveis na redistribuição. Os textos e
avisos originais podem ser obtidos nos repositórios indicados; este documento identifica
as versões exatas presentes no VSIX e não altera os termos dessas licenças.
