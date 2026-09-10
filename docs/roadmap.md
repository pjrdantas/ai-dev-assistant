# Roadmap

O desenvolvimento será incremental. Cada fase deverá ser descrita antes de seu início, validada com testes proporcionais ao risco e concluída antes do avanço para a próxima.

Restrição operacional adicionada em 2026-09-10: o produto final deve funcionar sem Docker, containers ou daemon de banco de dados. A prova MongoDB Atlas Local foi substituída na Fase 6A por persistência Apache Lucene embutida.

## Fase 0 — especificação e decisões arquiteturais

Status: concluída em 2026-09-09.

Objetivo: consolidar o que será construído antes da criação do código.

- registrar a especificação do produto;
- definir a arquitetura do MVP;
- registrar ADRs fundamentais;
- definir o contrato REST inicial;
- definir critérios de aceite do MVP;
- manter a regra `memory-first` como invariante.

Saída esperada: documentação suficiente para iniciar o backend sem decisões estruturais implícitas.

## Fase 1 — backend base

Status: concluída em 2026-09-09. Build, testes, Actuator, OpenAPI, Docker Compose e integração do backend com o MongoDB local foram validados.

Objetivo: criar somente a fundação executável do backend.

- Java 21, Spring Boot e Maven;
- estrutura hexagonal mínima;
- REST, validação, OpenAPI e Actuator;
- configuração externa;
- testes de contexto e arquitetura;
- MongoDB local preparado por Docker;
- nenhuma integração com IA nesta fase.

## Fase 2 — núcleo de prompt e memória

Status: concluída em 2026-09-09. Modelos de domínio, normalização conservadora v1, hash SHA-256 e ports externos foram implementados e validados por testes unitários e arquiteturais.

- modelar `Prompt`, `NormalizedPrompt`, `PromptHash` e `KnowledgeEntry`;
- criar os ports `MemoryRepository`, `EmbeddingProvider` e `AiProvider`;
- implementar normalização conservadora e SHA-256;
- criar testes unitários das invariantes.

## Fase 3 — persistência e busca exata

Status: concluída em 2026-09-09. Representação MongoDB, mapper, índices tradicionais, busca exata, deduplicação idempotente e registro atômico de reutilização foram validados com Testcontainers.

- criar representação MongoDB e mapper;
- criar índices tradicionais;
- implementar consulta por hash;
- registrar reutilização;
- garantir persistência idempotente;
- validar com testes de integração.

## Fase 4 — prova técnica de embeddings locais

Status: concluída em 2026-09-09. Dois modelos multilíngues foram comparados em CPU; o MiniLM multilíngue quantizado foi fixado com versão, dimensão e checksums. O adapter ONNX valida os artefatos na inicialização, opera em modo offline e foi validado com um benchmark reproduzível.

- comparar modelos multilíngues adequados a português e código;
- medir precisão, memória e latência sem GPU;
- fixar modelo, versão, dimensão e checksum;
- implementar o adapter ONNX;
- impedir download remoto durante uma solicitação.

## Fase 5 — busca semântica

Status: concluída em 2026-09-10. O schema da memória passou a persistir embeddings identificados; o índice vetorial é criado e validado como `READY`; a consulta `$vectorSearch` aplica filtros de ciclo de vida e modelo e foi validada com dataset determinístico no MongoDB Atlas Local.

- configurar `mongot` e índice vetorial;
- implementar `$vectorSearch`;
- parametrizar top-K e quantidade de candidatos;
- verificar que o índice esteja pronto;
- criar dataset de avaliação e testes de integração.

## Fase 6 — classificação e compatibilidade

Status: concluída em 2026-09-10. Score, thresholds, contexto técnico, compatibilidade e classificação `FULL`, `PARTIAL` e `NONE` foram implementados no domínio. Os limites `0.90` e `0.70` foram calibrados conservadoramente com o modelo ONNX e exemplos representativos.

- implementar `SimilarityScore` e `CompatibilityAssessment`;
- classificar `FULL`, `PARTIAL` e `NONE`;
- externalizar e validar thresholds;
- impedir `FULL` quando houver conflito técnico relevante;
- calibrar thresholds com exemplos reais.

## Fase 6A — runtime local sem containers

Status: concluída em 2026-09-10. Apache Lucene 10.5.1 foi adotado como adapter embutido de `MemoryRepository`; MongoDB, mongot e Testcontainers foram removidos do backend. Busca exata, deduplicação, reutilização, busca vetorial e persistência após reinicialização foram validadas no Windows sem Docker.

- selecionar e validar uma tecnologia de persistência e busca vetorial embutida em Java;
- implementar um adapter de `MemoryRepository` sem daemon externo;
- migrar as garantias de busca exata, deduplicação, reutilização e busca semântica;
- criar testes que executem sem Docker;
- retirar MongoDB, mongot e Docker dos requisitos do produto final;
- validar inicialização e persistência no Windows em diretório local.

## Fase 7 — orquestração obrigatória

- implementar `ProcessPromptUseCase` e `PromptOrchestrator`;
- criar `ResolutionPlan`;
- testar os fluxos `FULL`, `PARTIAL` e `NONE` com fakes ou mocks;
- testar que falhas de memória bloqueiam integrações externas;
- proteger dependências com testes arquiteturais.

## Fase 8 — primeira integração com IA

- escolher e implementar um único adapter de `AiProvider`;
- configurar modelo, temperatura, limite de tokens e segredo externamente;
- aplicar sanitização e minimização de contexto;
- implementar timeouts e tratamento de erros;
- persistir respostas de modo idempotente.

Pesquisa externa continuará fora do escopo nesta fase.

## Fase 9 — observabilidade

- registrar hits exatos e semânticos;
- registrar chamadas evitadas e realizadas;
- capturar tokens informados pelo provider;
- documentar a estimativa de tokens economizados;
- medir latência das etapas;
- evitar conteúdo sensível e labels de alta cardinalidade.

## Fase 10 — extensão VS Code

- criar sidebar ou painel simples;
- receber o prompt;
- chamar somente o backend local;
- apresentar resposta, fonte, similaridade e uso de IA;
- não executar comandos nem modificar arquivos automaticamente.

## Fase 11 — integração e endurecimento

- realizar testes ponta a ponta;
- validar cenários de indisponibilidade;
- revisar limites de payload e sanitização;
- consolidar documentação operacional;
- demonstrar métricas de reutilização e economia.

## Evoluções posteriores ao MVP

- pesquisa externa controlada;
- feedback, promoção e desativação de conhecimento;
- deduplicação semântica avançada;
- versionamento e soluções substituídas;
- análise ampliada do workspace;
- módulos especializados;
- integração opcional com APIs do Copilot;
- geração assistida de testes E2E/Cucumber a partir de referências locais.
