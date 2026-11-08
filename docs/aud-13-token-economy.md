# AUD-13 — Economia de tokens: método e limites

## Instrumento

O agregador reproduzível é `scripts/measure-copilot-memory-reuse.mjs`. Ele recebe um
JSONL de observações reais, uma linha por execução, e gera um relatório JSON. Cada linha
deve registrar `runId`, `taskId`, `modelId`, `contextId`, `scenario` (`A` sem
reutilização ou `B` com reutilização), `order`, `latencyMs`, `copilotCalls`,
`memorySearchCalls`, `memoryMatch` (`FULL`, `PARTIAL` ou `NONE`), `request`, `response`,
`effectiveReuse` e `qualityPreserved`.

O par A/B é aceito somente quando usa o mesmo modelo, tarefa e contexto, possui múltiplas
execuções, tem quantidades A/B iguais e alterna a ordem. O relatório conta latência,
chamadas do Copilot, consultas de memória e reutilizações efetivas (B com match diferente
de `NONE` e qualidade preservada).

Exemplo de execução:

```powershell
node scripts/measure-copilot-memory-reuse.mjs .\aud-13-runs.jsonl .\AUD_13_TOKEN_ECONOMY_RESULTS.json
```

## Tokens e faturamento

Sem uma exportação oficial do GitHub Copilot por execução, o relatório calcula apenas uma
estimativa local determinística de texto (`ceil(bytes UTF-8 / 4)`). Ela não representa
tokens do modelo, créditos ou valor faturado. `billedSavingsPercent` permanece `null` e
`billingStatus` fica `NOT_AVAILABLE_FROM_OFFICIAL_SOURCE` quando os dados oficiais não
são fornecidos. Nenhuma porcentagem deve ser copiada para material comercial sem o
relatório oficial correspondente.

## Qualidade e homologação

`qualityPreserved` deve ser marcado somente após revisão do resultado e dos testes da
tarefa. A extensão registra `FULL`, `PARTIAL`, `NONE`, `reuseCount` e IDs de memória; isso
é evidência de reutilização local, não evidência de economia de tokens do Copilot. A
comparação com uma sessão real exige mesmo modelo no model picker, mesmo contexto,
execuções alternadas e perfil VS Code isolado. Até que essa coleta seja executada com
Copilot autenticado, AUD-13 permanece `BLOCKED` para uma conclusão quantitativa, embora a
instrumentação esteja implementada.
