# ADR 0009 — Modelo inicial de embedding local

- Status: aceita
- Data: 2026-09-09

## Contexto

O ADR 0004 determinou que embeddings seriam gerados localmente por um adapter ONNX e que o modelo seria escolhido por benchmark com português, inglês técnico e código. Também é necessário controlar tamanho, latência e memória para que a execução sem GPU seja viável.

## Decisão

O modelo inicial será `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`, revisão `e8f8c211226b894fcb81acc59f3b34ba3efd5f42`, usando o artefato ONNX quantizado `model_quint8_avx2.onnx`.

O adapter aplicará mean pooling com máscara de atenção e normalização L2, produzindo vetores de 384 dimensões. O modelo aceitará no máximo 128 tokens.

Modelo e tokenizer serão preparados por ação explícita, armazenados fora do Git e validados por SHA-256 antes da abertura da sessão. O tokenizer será forçado a operar em modo offline. Nenhuma solicitação poderá provocar download de modelo ou tokenizer.

## Evidência

Em cinco passagens pelo conjunto inicial de nove casos, os dois candidatos obtiveram 100% de acerto top-1. O MiniLM quantizado apresentou 8,04 ms de latência média, p95 de 12,32 ms, 387,85 MB de memória virtual incremental e 121,63 MB de artefatos. O E5 FP32 apresentou 17,50 ms, p95 de 45,10 ms, 824,68 MB e 464,77 MB, respectivamente.

O método completo e suas limitações estão em `docs/embedding-benchmark.md`.

## Consequências

- geração de embeddings local e sem dependência de GPU;
- distribuição inicial menor que a alternativa E5 FP32 avaliada;
- hardware de execução precisa oferecer AVX2;
- troca de revisão, artefato ou tokenizer exige atualização explícita dos checksums;
- qualquer troca de modelo exigirá re-embedding ou uma estratégia de migração;
- qualidade e thresholds ainda precisarão de avaliação com um dataset maior.
