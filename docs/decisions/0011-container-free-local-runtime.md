# ADR 0011 — Runtime local sem containers

- Status: aceita e implementada na Fase 6A
- Data: 2026-09-10
- Substitui: ADR 0005 para o produto final

## Contexto

O ambiente no qual o AI Dev Assistant será utilizado não possui Docker e não permite sua instalação. A prova técnica da Fase 5 usou MongoDB Atlas Local porque ela reúne `mongod` e `mongot`, mas essa imagem é destinada a desenvolvimento e testes. O MongoDB não disponibiliza binário nativo suportado do `mongot` para Windows.

Manter essa topologia no produto impediria seu funcionamento no ambiente real e criaria dependência operacional de processos externos.

## Decisão

O produto final deverá executar no Windows sem Docker, containers ou daemon de banco de dados instalado separadamente.

A memória será fornecida por um adapter Apache Lucene embutido no processo Java, atrás do port `MemoryRepository`, com dados persistidos em diretório local configurável. A ADR 0013 registra os detalhes da seleção e da implementação.

O adapter MongoDB/mongot e Testcontainers foram removidos do backend na Fase 6A. O `docker-compose.yml` permanece sem serviços apenas para preservar a estrutura inicial do repositório.

## Consequências

- a arquitetura hexagonal permite trocar a infraestrutura sem alterar classificação e orquestração;
- a Fase 6 pode prosseguir por ser independente do mecanismo de persistência;
- o adapter embutido foi implementado e validado antes da Fase 7;
- os testes de aceite do produto final deverão executar sem Docker;
- MongoDB e Testcontainers não fazem parte do build, dos testes ou da distribuição final.
