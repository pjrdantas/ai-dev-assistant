# Modelo local de embedding

## Identidade e origem

- Modelo: `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`.
- Origem: repositório oficial [Sentence Transformers no Hugging Face](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2).
- Revisão de origem: `e8f8c211226b894fcb81acc59f3b34ba3efd5f42`.
- Artefato ONNX redistribuído: `onnx/model_quint8_avx2.onnx`, empacotado neste VSIX como
  `model.onnx`.
- Licença declarada pelo repositório: Apache-2.0.

## Finalidade e execução

O modelo gera embeddings locais para a busca semântica da memória. Ele não produz
respostas de chat, não chama internet e não seleciona o modelo do GitHub Copilot.

`OnnxLocalEmbeddingProvider` usa `tokenizer.json`, prefixa a consulta com `query: `,
limita a entrada a 128 tokens, faz mean pooling dos tokens válidos e normaliza o vetor por
norma L2. O embedding resultante tem 384 dimensões. A inicialização é lazy e somente
ocorre quando a busca semântica é necessária.

## Integridade dos assets

| Arquivo | SHA-256 | Tamanho em bytes |
| --- | --- | ---: |
| `model.onnx` | `98a01d88b7de996cdea58c32ca71208c09968d143798814b2ea09d3439dc334f` | 118453870 |
| `tokenizer.json` | `2c3387be76557bd40970cec13153b3bbf80407865484b209e655e5e4729076b8` | 9081518 |

Os hashes são conferidos pelo runtime antes de criar a sessão ONNX. A proveniência e as
obrigações de terceiros constam em `../../THIRD_PARTY_NOTICES.md`.
