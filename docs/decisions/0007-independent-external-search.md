# ADR 0007 — Pesquisa externa independente da IA

- Status: aceita
- Data: 2026-09-09

## Contexto

Ausência de memória não significa automaticamente que uma pergunta precisa de internet. Algumas solicitações podem ser respondidas por conhecimento geral de um modelo, enquanto outras exigem informação atual.

## Decisão

A autorização temporária para IA e o futuro `ExternalSearchProvider` serão fronteiras
independentes. A decisão sobre pesquisa externa ocorrerá somente depois da memória e não
será causada automaticamente por um resultado `NONE`.

Pesquisa externa permanecerá desabilitada no primeiro MVP.

## Consequências

- controle explícito sobre custo, privacidade e atualidade;
- o primeiro MVP não prometerá validação de informações recentes;
- uma política específica poderá ser adicionada posteriormente sem alterar o núcleo de memória;
- métricas distinguirão chamadas de IA e pesquisas externas.
