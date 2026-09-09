# ADR 0003 — Normalização conservadora e versionada

- Status: aceita
- Data: 2026-09-09

## Contexto

Prompts técnicos podem conter código, identificadores e strings em que caixa, pontuação e espaços possuem significado. Uma normalização agressiva aumentaria falsos matches exatos.

## Decisão

A normalização inicial removerá espaços externos, normalizará quebras de linha e tratará espaços repetidos com cuidado, preservando elementos tecnicamente significativos.

Toda estratégia terá um número de versão. O hash será SHA-256 sobre a versão e o texto normalizado.

Na versão 1, a normalização apenas uniformiza quebras de linha para `LF` e remove espaços externos do conteúdo completo. Espaços internos, caixa, pontuação, strings e blocos de código são preservados. A entrada do hash, codificada em UTF-8, será `v{versão}\n{texto normalizado}`.

## Consequências

- a busca exata será deliberadamente conservadora;
- variações não capturadas seguirão para a busca semântica;
- mudanças futuras na normalização não invalidarão silenciosamente hashes antigos;
- testes deverão cobrir texto comum, código, strings e diferenças de caixa.
