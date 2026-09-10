# ADR 0005 — Busca vetorial local com MongoDB e mongot

- Status: substituída pela ADR 0011
- Data: 2026-09-09

## Contexto

O MVP exige MongoDB local e busca semântica. Um processo MongoDB comum não fornece sozinho a topologia de busca vetorial planejada; o ambiente também precisa do processo `mongot` e de um índice vetorial.

## Decisão

O desenvolvimento e os testes usarão uma imagem oficial local que reúna MongoDB e `mongot`, com versão fixada e validada durante a implementação.

O backend gerará seus próprios embeddings e executará `$vectorSearch`. Embedding remoto automatizado do MongoDB não será usado.

## Consequências

- o ambiente local dependerá de Docker;
- será necessário verificar o estado `READY` do índice;
- a imagem local será tratada como ambiente de desenvolvimento e testes, não como decisão de produção;
- o adapter MongoDB esconderá detalhes da busca vetorial do domínio.

## Substituição

Em 2026-09-10 foi informado que o ambiente final é Windows e não permite Docker. Como não existe binário nativo suportado do `mongot` para Windows, esta decisão permanece somente como registro da prova técnica da Fase 5. A ADR 0011 define que o produto final utilizará memória embutida e sem daemon externo.
