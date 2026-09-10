# ADR 0012 — Classificação conservadora da memória

- Status: aceita
- Data: 2026-09-10

## Contexto

O score semântico não comprova compatibilidade. A calibração com o MiniLM multilíngue mostrou pares equivalentes entre português e inglês com score a partir de `0.7818`, enquanto um par relacionado, mas não equivalente, sobre producer e consumer Kafka atingiu `0.8282`.

Não existe, nesse conjunto inicial, um único threshold capaz de separar perfeitamente conhecimento completo de conhecimento parcial.

## Decisão

O threshold inicial de `FULL` será `0.90`, priorizando precisão e evitando reutilização integral insegura. O threshold inicial de `PARTIAL` será `0.70`: o menor exemplo reutilizável mediu `0.7082`, enquanto o maior exemplo irrelevante mediu `0.5962`.

O resultado final combinará duas dimensões independentes:

1. faixa do score semântico;
2. compatibilidade técnica.

Somente score igual ou superior a `0.90` com contexto totalmente compatível pode resultar em `FULL`. Contexto adaptável limita o resultado a `PARTIAL`. Estado inválido, tipo de tarefa conflitante, tecnologias sem interseção ou conflito de versão principal resultam em `NONE`.

Conhecimento acima da idade máxima configurada ou com contexto incompleto não poderá ser `FULL`.

## Consequências

- alguns pares realmente equivalentes serão tratados como `PARTIAL` e exigirão adaptação;
- nenhum score alto ignora conflitos técnicos;
- thresholds e idade máxima permanecem externos e validados;
- o dataset deverá crescer com exemplos reais e os limites poderão ser recalibrados.
