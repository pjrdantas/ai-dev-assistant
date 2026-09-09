# ADR 0001 — Monólito modular com arquitetura hexagonal

- Status: aceita
- Data: 2026-09-09

## Contexto

O backend precisa separar domínio, aplicação e infraestrutura, mas o MVP ainda não possui complexidade que justifique vários módulos Maven ou serviços independentes.

## Decisão

Iniciar com um único módulo Maven e um único processo Spring Boot. O código será organizado por capacidade funcional, com limites hexagonais internos e direção explícita das dependências.

O domínio não dependerá de Spring, MongoDB, VS Code ou SDKs externos. Controllers dependerão apenas de ports de entrada.

## Consequências

- build e execução local mais simples;
- menos configuração prematura;
- isolamento protegido por organização de pacotes e testes arquiteturais;
- módulos Maven poderão ser extraídos posteriormente se surgir uma necessidade concreta.

