# ADR 0011 — Runtime local sem containers

- Status: aceita
- Data: 2026-09-10
- Substitui: ADR 0005 para o produto final

## Contexto

O ambiente no qual o AI Dev Assistant será utilizado não possui Docker e não permite sua instalação. A prova técnica da Fase 5 usou MongoDB Atlas Local porque ela reúne `mongod` e `mongot`, mas essa imagem é destinada a desenvolvimento e testes. O MongoDB não disponibiliza binário nativo suportado do `mongot` para Windows.

Manter essa topologia no produto impediria seu funcionamento no ambiente real e criaria dependência operacional de processos externos.

## Decisão

O produto final deverá executar no Windows sem Docker, containers ou daemon de banco de dados instalado separadamente.

A memória será fornecida por um adapter embutido no processo Java, atrás do port `MemoryRepository`, com dados persistidos em diretório local configurável. A tecnologia será selecionada por uma prova focada na Fase 6A e deverá oferecer busca exata, atualização segura, deduplicação e busca vetorial local.

O adapter MongoDB/mongot e o Docker Compose poderão permanecer temporariamente como infraestrutura de desenvolvimento e comparação, mas não serão empacotados nem documentados como requisito de execução do produto final.

## Consequências

- a arquitetura hexagonal permite trocar a infraestrutura sem alterar classificação e orquestração;
- a Fase 6 pode prosseguir por ser independente do mecanismo de persistência;
- antes da Fase 7 será implementado e validado o adapter embutido;
- os testes de aceite do produto final deverão executar sem Docker;
- MongoDB e Testcontainers deverão ser retirados do caminho de distribuição final.
