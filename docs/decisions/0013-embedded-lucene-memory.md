# ADR 0013 — Memória local embutida com Apache Lucene

- Status: aceita e implementada
- Data: 2026-09-10
- Complementa: ADR 0011
- Substitui: infraestrutura MongoDB da ADR 0010

## Contexto

O produto precisa executar no Windows com Java 21, sem Docker, daemon de banco de dados ou instalação nativa adicional. O mesmo mecanismo deve oferecer persistência local, busca por campos exatos e recuperação de vizinhos por vetores densos.

MongoDB/mongot foi descartado para o runtime final por exigir uma topologia externa não suportada no ambiente. Uma implementação própria em arquivos também foi descartada porque recriaria indexação, locking e recuperação vetorial sem benefício para o domínio.

Apache Lucene é uma biblioteca escrita em Java, executada dentro do processo e compatível com Java 21. Seu core fornece diretórios persistidos no filesystem, escrita concorrente controlada, campos estruturados e busca k-NN sobre vetores.

## Decisão

O adapter final de `MemoryRepository` usará Apache Lucene 10.5.1 com:

- `FSDirectory` sobre um diretório local configurável;
- um único `IndexWriter`, protegido pelo lock do índice;
- `SearcherManager` atualizado de forma bloqueante após cada commit;
- termos exatos para identificador, deduplicação, hash, estado e metadados do embedding;
- campos armazenados para reconstruir o agregado completo;
- `KnnFloatVectorField` e `KnnFloatVectorQuery` com similaridade por cosseno;
- filtro vetorial por estado, modelo, versão e dimensão;
- schema local v1 e dimensão registrados nos metadados do commit.

As mutações são serializadas dentro do adapter. Cada gravação, atualização de embedding ou reutilização realiza `commit` antes de retornar, garantindo que uma reabertura do backend observe o estado confirmado.

A chave de deduplicação da ADR 0008 permanece inalterada. A classificação continua fora do adapter, conforme ADRs 0006, 0010 e 0012.

O armazenamento MongoDB continha somente dados de prova e teste. Por isso não haverá importação automática para o índice Lucene. Uma futura mudança de schema, dimensão ou versão incompatível do índice exigirá migração ou reindexação explícita.

## Consequências

- backend, testes e distribuição deixam de depender de MongoDB, mongot, Testcontainers e Docker;
- o diretório da memória é criado automaticamente na primeira inicialização;
- somente um processo escritor pode abrir o mesmo diretório por vez;
- buscas exatas e vetoriais compartilham o mesmo armazenamento local;
- commits por mutação priorizam durabilidade e simplicidade no MVP;
- upgrades incompatíveis do formato Lucene precisam de tratamento explícito;
- a API vetorial do Lucene deve permanecer isolada no adapter.

## Referências

- [Apache Lucene 10.5.1](https://lucene.apache.org/core/10_5_1/index.html)
- [Requisitos de sistema](https://lucene.apache.org/core/10_5_1/SYSTEM_REQUIREMENTS.html)
- [API de busca k-NN](https://lucene.apache.org/core/10_5_1/core/org/apache/lucene/search/KnnFloatVectorQuery.html)
