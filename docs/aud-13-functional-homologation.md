# AUD-13 — Homologação funcional da baseline 0.1.13

Data: 2026-11-10 (America/Sao_Paulo)

Esta consolidação preserva a versão funcional `ai-dev-assistant-0.1.13-aud13-fix.vsix` localmente. O SHA-256 verificado é `DE93F3622F9A2ED82273B67DAF3DA60AECDAB4DFAFF44D025812D4F69C4589BE`.

## Resultado funcional

- `NONE`: aprovado — 399.434 tokens totais.
- `PARTIAL`: aprovado — 359.322 tokens totais; redução observada de 10,04%.
- `FULL/EXACT`: aprovado — 318.209 tokens totais; redução observada de 20,34%.
- Maven: 3 testes aprovados em cada execução.
- Execução funcional histórica do VSIX: 179 PASS, 0 FAIL, 1 SKIP.

Os números de tokens são exploratórios, baseados em estimativa local, e não comprovam tokens faturados, economia financeira ou causalidade. As metas de economia mínima de 50% para `PARTIAL` e 80% para `FULL` não foram atingidas. Esta consolidação não altera os mecanismos `NONE`, `PARTIAL` ou `FULL`.

## Verificação desta consolidação

TypeScript compilou com sucesso. A suíte completa local não foi declarada aprovada porque os testes de integração exigem URIs MongoDB efêmeras explicitamente configuradas e nenhuma estava disponível; o serviço MongoDB local estava parado. A execução sem os arquivos de integração dependentes de Mongo passou com 149 testes e 1 skip. Nenhuma instância MongoDB, sessão Copilot, configuração do VS Code ou hook foi alterada.
