# ADR 0015 — Observabilidade com métricas limitadas

- Status: aceita e implementada
- Data: 2026-09-10
- Complementa: ADR 0014

## Contexto

O produto precisa demonstrar hits locais, chamadas evitadas e uso de IA sem transformar
telemetria em uma fonte de vazamento. O fluxo em duas etapas também exige distinguir uma
autorização criada pelo backend de uma chamada efetivamente concluída na extensão.

A Language Model API do VS Code fornece `LanguageModelChat.countTokens`, que usa a
lógica de tokenização do modelo selecionado, mas não fornece dados de faturamento do
provedor.

## Decisão

O caso de uso depende de `PromptMetricsRecorder`, uma porta de saída implementada por um
adapter Micrometer. A aplicação registra eventos de domínio operacional e o adapter os
traduz para counters, summaries e timers.

Uma chamada de IA será contada somente na primeira conclusão externa aceita e
correlacionada. Autorizações terão uma série separada. Reenvios idempotentes não serão
contados novamente.

Tokens de entrada e saída serão opcionais e terão origem em `countTokens` na extensão.
Serão identificados como `model_counted`, sem alegação de consumo faturado. Não haverá
preenchimento estimado quando a medição estiver ausente.

Para respostas `FULL`, a economia será estimada por `ceil(totalCharacters / 4)`, usando
prompt, contexto técnico estruturado e solução devolvida, com mínimo de um token. Essa
série será explicitamente identificada como estimativa e permanecerá separada dos
tokens contados pelo modelo.

Somente enums de busca, classificação, estado, fonte, direção, método e etapa serão
usados como tags. Conteúdo, caminhos e identificadores não serão tags. Falhas do adapter
de métricas serão ignoradas pelo orquestrador para não alterar a regra memory-first.

O endpoint local do Actuator para métricas será exposto. Não será incluído exporter,
Prometheus, container ou serviço adicional nesta fase.

## Consequências

- métricas operacionais não carregam conteúdo da aplicação;
- chamadas autorizadas e realizadas podem ser analisadas separadamente;
- tokens contados e economia estimada não são misturados;
- a extensão mede tokens e duração no adapter `vscode.lm` implementado na Fase 10;
- métricas só aparecem no registry depois da primeira observação;
- o registro de telemetria é best-effort e não interfere na decisão arquitetural.

## Referências

- [VS Code API — LanguageModelChat](https://code.visualstudio.com/api/references/vscode-api#LanguageModelChat)
- [Language Model API](https://code.visualstudio.com/api/extension-guides/ai/language-model)
