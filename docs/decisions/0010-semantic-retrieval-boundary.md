# ADR 0010 — Recuperação semântica separada da classificação

- Status: aceita quanto à separação; infraestrutura substituída pela ADR 0013
- Data: 2026-09-10

## Contexto

A busca vetorial precisa recuperar candidatos locais, mas o score do MongoDB sozinho não determina se um conhecimento pode ser reutilizado. Também é necessário impedir consultas antes de o índice assíncrono estar realmente disponível.

## Decisão

O `MemoryRepository` expõe a recuperação semântica a partir de um `Embedding` e devolve candidatos acompanhados do score bruto. O adapter MongoDB executa `$vectorSearch` e aplica pré-filtros por estado, modelo, versão e dimensão.

O índice vetorial é criado pela aplicação quando estiver ausente. A inicialização somente termina depois de confirmar `status=READY`, `queryable=true` e a definição esperada do índice. Configurações incompatíveis interrompem a inicialização em vez de permitir consultas inconsistentes.

`top-K`, quantidade de candidatos, nome e dimensão do índice e tempos de prontidão são externos e validados. A classificação do score e a compatibilidade técnica permanecem fora do repositório e serão implementadas na Fase 6.

## Consequências

- o backend exige uma distribuição MongoDB com Search disponível para iniciar;
- falhas ou divergências do índice são detectadas antes da primeira consulta;
- o domínio não depende de BSON, `$vectorSearch` ou APIs do driver;
- registros antigos podem continuar sem embedding e ser vetorizados posteriormente;
- nenhum candidato é classificado como `FULL`, `PARTIAL` ou `NONE` nesta fase.

## Substituição da infraestrutura

Na Fase 6A, a fronteira de recuperação definida por esta ADR foi preservada, mas MongoDB e seu índice assíncrono foram substituídos pelo adapter Apache Lucene descrito na ADR 0013. A classificação continua fora do repositório.
