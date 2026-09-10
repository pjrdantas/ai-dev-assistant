# Benchmark de embeddings locais

## Objetivo

Comparar duas opções multilíngues executadas localmente em CPU para escolher o primeiro modelo do AI Dev Assistant. Esta prova técnica não calibra os thresholds de `FULL` e `PARTIAL`; isso pertence à fase de classificação com um dataset maior.

## Ambiente

- data: 2026-09-09;
- sistema: Windows 10 x64;
- Java: Eclipse Temurin 21.0.11;
- CPU: Intel Core i5-4690, 4 núcleos e 4 processadores lógicos;
- memória física: aproximadamente 16 GB;
- ONNX Runtime: 1.29.0, CPU;
- DJL Hugging Face Tokenizers: 0.38.0.

## Método

O conjunto contém nove consultas e nove candidatos correspondentes, cobrindo português, inglês técnico e trechos de código. O indicador de precisão é o acerto top-1 por similaridade de cosseno. Após um aquecimento, cinco passagens pelos nove casos produzem 45 medições; a latência considera somente a geração de cada embedding de consulta. Memória virtual incremental e tamanho dos artefatos ajudam a comparar o custo local.

Os números são indicativos deste computador e desta amostra pequena. O teste e os casos estão versionados em `OnnxEmbeddingBenchmarkTest`, permitindo repetição e evolução do conjunto.

## Resultados

| Modelo | Variante | Acerto top-1 | Latência média | p95 | Memória virtual incremental | Artefatos |
|---|---|---:|---:|---:|---:|---:|
| `intfloat/multilingual-e5-small` | ONNX FP32 | 45/45 (100%) | 17,50 ms | 45,10 ms | 824,68 MB | 464,77 MB |
| `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` | ONNX uint8 AVX2 | 45/45 (100%) | 8,04 ms | 12,32 ms | 387,85 MB | 121,63 MB |

## Decisão

O modelo inicial será `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`, pois manteve o mesmo acerto neste conjunto e apresentou menor latência, memória incremental e tamanho de distribuição.

Configuração fixada:

- revisão: `e8f8c211226b894fcb81acc59f3b34ba3efd5f42`;
- dimensão: 384;
- máximo de tokens: 128;
- modelo: `onnx/model_quint8_avx2.onnx`;
- SHA-256 do modelo: `98a01d88b7de996cdea58c32ca71208c09968d143798814b2ea09d3439dc334f`;
- SHA-256 do tokenizer: `2c3387be76557bd40970cec13153b3bbf80407865484b209e655e5e4729076b8`;
- pooling: média dos tokens considerados pela máscara de atenção;
- normalização: L2.

A variante AVX2 deve ser reavaliada se o backend precisar rodar em hardware sem esse conjunto de instruções. A qualidade também deverá ser comparada novamente com um dataset maior antes de definir thresholds.

## Reprodução

Na raiz do projeto:

```powershell
.\scripts\embedding-model.ps1 prepare multilingual-e5-small
.\scripts\embedding-model.ps1 prepare paraphrase-multilingual-minilm
.\scripts\embedding-model.ps1 benchmark multilingual-e5-small
.\scripts\embedding-model.ps1 benchmark paraphrase-multilingual-minilm
```

O download ocorre somente na ação explícita `prepare`. A ação `benchmark` e o backend utilizam exclusivamente arquivos locais validados por checksum.

Fontes dos modelos:

- <https://huggingface.co/intfloat/multilingual-e5-small>;
- <https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2>.
