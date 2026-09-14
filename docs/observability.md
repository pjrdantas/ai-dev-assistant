# Observabilidade

## Objetivo

A observabilidade demonstra a reutilização da memória local sem registrar o conteúdo das
solicitações. As métricas usam somente dimensões enumeradas e de baixa cardinalidade.
Prompts, respostas, caminhos, identificadores de projeto e identificadores de invocação
não são tags.

## Catálogo de métricas

| Métrica Micrometer | Tipo | Significado |
|---|---|---|
| `ai.dev.assistant.prompts` | counter | solicitações aceitas pelo orquestrador |
| `ai.dev.assistant.memory.matches` | counter | matches selecionados, por `lookup` e `match` |
| `ai.dev.assistant.memory.similarity` | summary | similaridade dos matches selecionados |
| `ai.dev.assistant.responses` | counter | respostas concluídas, por fonte local ou externa |
| `ai.dev.assistant.ai.calls.avoided` | counter | respostas `FULL` que evitaram uma chamada externa |
| `ai.dev.assistant.ai.invocations` | counter | autorizações criadas e conclusões aceitas |
| `ai.dev.assistant.ai.calls` | counter | chamadas consideradas realizadas após a primeira conclusão aceita |
| `ai.dev.assistant.ai.tokens` | counter | tokens de entrada e saída contados pelo modelo selecionado |
| `ai.dev.assistant.tokens.saved.estimated` | summary | estimativa de tokens economizados por resposta local |
| `ai.dev.assistant.stage.duration` | timer | duração das etapas internas do orquestrador |
| `ai.dev.assistant.ai.duration` | timer | duração da execução de IA medida pela extensão |

`ai.dev.assistant.ai.invocations{state="authorized"}` não representa uma chamada ao
Copilot. `ai.dev.assistant.ai.calls` só é incrementada quando o backend aceita pela
primeira vez uma conclusão correlacionada. Um reenvio idempotente não incrementa a
métrica novamente.

## Tokens medidos

A Language Model API não informa consumo faturado. O adapter da extensão usa
`LanguageModelChat.countTokens` para contar entrada e saída com a lógica de tokenização
do modelo Copilot selecionado. Esses valores são enviados na conclusão e registrados
com `measurement="model_counted"`.

A ausência dessas medições não será substituída por um valor fictício. A duração da IA
também será enviada pela extensão e identificada como `extension_reported`.

## Estimativa de economia

Quando uma resposta `FULL` é devolvida pela memória, a estimativa considera os
caracteres do prompt, do contexto técnico estruturado e da solução local. A fórmula é:

```text
estimatedTokensSaved = max(1, ceil(totalCharacters / 4))
```

O resultado representa uma aproximação dos tokens de entrada e saída que deixaram de
ser processados externamente. A métrica usa `method="characters_div_4"` e nunca é
somada aos tokens contados pelo modelo como se fosse uma medição real. Português, código
e tokenizadores diferentes podem produzir variações relevantes; a estimativa não serve
para faturamento.

## Latências

Os timers locais distinguem `prompt_processing`, `normalization`,
`exact_memory_lookup`, `embedding`, `semantic_memory_lookup`, `memory_persistence` e
`ai_completion`. O timer de IA é separado porque essa execução ocorre no processo da
extensão.

Falhas no registro de métricas não mudam a classificação, não liberam chamadas externas
e não alteram a resposta do fluxo memory-first.

## Consulta local

O endpoint `GET /actuator/metrics` lista as métricas disponíveis. Uma métrica da
aplicação passa a aparecer depois de receber sua primeira observação. Nenhum exporter ou
serviço externo é exigido nesta fase.
