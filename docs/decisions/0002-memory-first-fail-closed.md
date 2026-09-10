# ADR 0002 — Consulta obrigatória à memória e falha fechada

- Status: aceita
- Data: 2026-09-09

## Contexto

A principal regra do produto determina que nenhuma IA ou pesquisa externa seja acionada antes da consulta à memória local.

Um fallback automático para IA quando a memória embutida, o índice vetorial ou o embedding local estiverem indisponíveis violaria essa regra.

## Decisão

Toda solicitação passará pelo `PromptOrchestrator`. O orquestrador concluirá o pipeline local de memória antes de construir qualquer plano que permita integração externa.

Se a consulta obrigatória não puder ser concluída, a operação falhará de forma controlada e nenhum provider externo será chamado.

## Consequências

- a invariante é preservada mesmo em falhas;
- indisponibilidade da memória pode tornar temporariamente o assistente indisponível;
- health checks, métricas e mensagens de erro serão necessários;
- testes deverão provar a ausência de interações externas em falhas locais.
