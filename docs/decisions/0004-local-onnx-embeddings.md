# ADR 0004 — Embeddings locais por adapter ONNX

- Status: aceita
- Data: 2026-09-09

## Contexto

Usar um serviço remoto de embeddings apenas para consultar memória reduziria a economia de tokens, introduziria custo e criaria uma chamada externa antes da decisão principal.

## Decisão

O port `EmbeddingProvider` terá inicialmente um adapter ONNX executado localmente no backend Java.

O modelo será escolhido após benchmark com português, inglês técnico e código. Seus artefatos terão versão e checksum fixados e deverão estar disponíveis antes do primeiro prompt. Downloads implícitos durante uma solicitação serão proibidos.

## Consequências

- geração de embeddings sem chamadas externas por prompt;
- consumo local de CPU e memória;
- necessidade de distribuir ou preparar o modelo de forma reproduzível;
- troca de modelo exigirá re-embedding ou estratégia de migração;
- modelo, versão, dimensão e estratégia de texto serão persistidos.

