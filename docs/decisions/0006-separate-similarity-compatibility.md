# ADR 0006 — Separar similaridade de compatibilidade

- Status: aceita
- Data: 2026-09-09

## Contexto

Duas solicitações podem ser semanticamente semelhantes e ainda assim exigir soluções diferentes por linguagem, framework, versão ou dependências.

## Decisão

A classificação terá duas etapas:

1. recuperação por similaridade;
2. avaliação de compatibilidade técnica.

Os thresholds serão externos e validados. Conflitos relevantes poderão limitar um candidato para `PARTIAL` ou `NONE`, independentemente do score semântico.

## Consequências

- menor risco de reutilizar código incompatível;
- necessidade de contexto técnico estruturado;
- classificação precisará informar motivos de incompatibilidade;
- thresholds precisarão ser calibrados com dataset de avaliação.
