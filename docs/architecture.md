# Arquitetura do MVP

## 1. Objetivo arquitetural

O AI Dev Assistant será um assistente integrado ao VS Code que consulta obrigatoriamente sua memória local antes de qualquer chamada para IA ou pesquisa externa.

A arquitetura deve proteger essa regra por dependências de código, fluxo de aplicação e testes automatizados.

## 2. Estilo adotado

O backend começará como um monólito modular em um único módulo Maven, com arquitetura hexagonal organizada por capacidade funcional.

Princípios:

- domínio independente de Spring, MongoDB, VS Code e providers externos;
- adapters de entrada dependem somente de ports de entrada;
- serviços de aplicação coordenam casos de uso;
- integrações externas implementam ports de saída;
- regras de negócio não ficam em controllers;
- classes são criadas somente quando houver responsabilidade real.

## 3. Visão de componentes

```text
┌───────────────────────────────────┐
│ Extensão VS Code                  │
│ prompt + contexto estruturado     │
└─────────────────┬─────────────────┘
                  │ HTTP localhost
                  ▼
┌───────────────────────────────────┐
│ Adapter REST                      │
│ depende de ProcessPromptUseCase   │
└─────────────────┬─────────────────┘
                  ▼
┌──────────────────────────────────────────────┐
│ PromptOrchestrator                           │
│                                              │
│ valida → contexto → memória → ResolutionPlan │
└───────────────┬────────────────────┬─────────┘
                │                    │ somente após memória
                ▼                    ▼
┌───────────────────────────┐  ┌────────────────────────┐
│ Pipeline local de memória │  │ Integrações externas   │
│                           │  │                        │
│ normalização              │  │ AiProvider             │
│ hash SHA-256              │  │ ExternalSearchProvider │
│ busca exata               │  └────────────────────────┘
│ embedding ONNX            │
│ busca vetorial            │
│ compatibilidade           │
│ FULL / PARTIAL / NONE     │
└───────────────┬───────────┘
                ▼
┌───────────────────────────┐
│ MemoryRepository          │
│ adapter local embutido    │
└───────────────────────────┘
```

Fluxo permitido:

```text
VS Code
  → REST adapter
  → ProcessPromptUseCase
  → PromptOrchestrator
  → memória local
  → decisão
  → integração externa somente quando necessária
```

Fluxos proibidos:

```text
Controller → provider de IA
VS Code → provider de IA
Ausência na memória local → pesquisa automática na internet
```

## 4. Pacotes planejados

```text
com.aidevassistant
│
├── prompt
│   ├── domain
│   │   ├── model
│   │   ├── policy
│   │   └── exception
│   ├── application
│   │   ├── port
│   │   │   ├── in
│   │   │   └── out
│   │   └── service
│   └── adapter
│       └── in
│           └── web
│
├── memory
│   ├── domain
│   │   ├── model
│   │   ├── policy
│   │   └── exception
│   ├── application
│   │   ├── port
│   │   │   └── out
│   │   └── service
│   └── adapter
│       └── out
│           ├── embedded
│           └── embedding
│
├── ai
│   └── adapter
│       └── out
├── projectcontext
│   ├── domain
│   └── application
├── observability
│   └── adapter
│       └── out
└── configuration
```

A árvore é uma direção inicial, não uma obrigação de criar todos os pacotes antecipadamente.

## 5. Elementos de domínio planejados

### Agregado

- `KnowledgeEntry`: conhecimento reutilizável, sua aplicabilidade, origem, ciclo de vida e utilização.

### Value objects

- `Prompt`;
- `NormalizedPrompt`;
- `PromptHash`;
- `KnowledgeId`;
- `Solution`;
- `ProjectContext`;
- `Technology`;
- `Embedding`;
- `SimilarityScore`;
- `CompatibilityAssessment`;
- `MemoryMatch`;
- `ResolutionPlan`;
- `AssistantResponse`.

Objetos que não apresentarem invariantes de domínio poderão permanecer como modelos da camada de aplicação.

### Enums

- `MatchType`: `FULL`, `PARTIAL`, `NONE`;
- `ResponseSource`: `LOCAL_MEMORY`, `LOCAL_MEMORY_AND_AI`, `AI`;
- `KnowledgeStatus`: `ACTIVE`, `SUPERSEDED`, `DEPRECATED`;
- `SourceType`: `AI_PROVIDER`, `USER`, `IMPORTED`, `LOCAL_GENERATION`.

Linguagens, frameworks, intents e providers não serão enums rígidos no núcleo.

## 6. Ports planejados

### Entrada

- `ProcessPromptUseCase`.

### Saída

- `MemoryRepository`;
- `EmbeddingProvider`;
- `AiProvider`;
- `ExternalSearchProvider`;
- `ProjectContextProvider`;
- `MetricsRecorder`.

O `ExternalSearchProvider` será uma extensão planejada, mas não terá implementação no primeiro MVP.

## 7. Adapters planejados

- adapter REST para entrada de prompts;
- adapter embutido para memória, busca exata e vetorial no produto final;
- adapter ONNX para embeddings locais;
- adapter para um primeiro provider de IA;
- adapter Micrometer para métricas;
- adapter futuro para pesquisa externa;
- adapter futuro para leitura controlada do workspace.

## 8. Pipeline de memória

```text
Prompt
  ↓
normalização conservadora e versionada
  ↓
SHA-256
  ↓
busca exata
  ├── candidato compatível → FULL
  └── ausente ou incompatível
          ↓
     embedding local
          ↓
     busca vetorial top-K
          ↓
     compatibilidade técnica
          ↓
     FULL / PARTIAL / NONE
```

A busca exata evita o custo local de embedding. Um hash igual não é suficiente para declarar `FULL`: o contexto técnico ainda precisa ser compatível.

## 9. Classificação

A classificação possui duas dimensões independentes:

1. similaridade semântica;
2. compatibilidade técnica.

Os thresholds de similaridade são externos e validados na inicialização. Os valores iniciais calibrados são `0.90` para `FULL` e `0.70` para `PARTIAL`. Somente score na faixa completa e compatibilidade total produz `FULL`.

Contexto incompleto, diferença de versão não principal ou idade acima do limite configurado tornam o candidato adaptável e impedem `FULL`. Estado inativo, conflito de tipo de tarefa, tecnologias sem interseção ou conflito de versão principal tornam o candidato incompatível e resultam em `NONE`.

## 10. Persistência

O índice local Lucene representa cada `KnowledgeEntry` como um documento de infraestrutura contendo:

- prompt original, normalizado, versão e hash;
- chave de deduplicação;
- intenção, domínio, assunto e tags;
- aplicabilidade técnica;
- solução;
- embedding com modelo, versão e dimensão;
- proveniência;
- contexto de origem sem caminho absoluto por padrão;
- qualidade;
- ciclo de vida e revisão;
- estatísticas de reutilização;
- datas e versão do schema.

Campos indexados:

- identificador e chave de deduplicação;
- hash, versão de normalização e estado;
- modelo, versão e dimensão do embedding;
- vetor de 384 dimensões para busca por cosseno.

O documento Lucene permanece separado do agregado por um mapper. Strings extensas e metadados usados para reconstrução são armazenados como campos persistidos, enquanto campos de filtro usam termos exatos.

Na implementação inicial, a busca exata retorna todos os candidatos ativos com o mesmo hash e versão de normalização, ordenados pela atualização mais recente. A deduplicação combina o hash do prompt com um hash SHA-256 da solução. Um lock único de mutação em conjunto com o `IndexWriter` evita duplicações concorrentes dentro do processo, e o lock nativo do diretório impede dois writers sobre o mesmo índice. Gravações, embeddings e incrementos de reutilização são confirmados com `commit` antes de um refresh bloqueante do reader.

Metadados de embedding e contexto técnico já fazem parte do conhecimento. Proveniência e qualidade serão adicionadas nas fases correspondentes, sem antecipar estruturas ainda não utilizadas.

## 11. Embedding local

O `EmbeddingProvider` será implementado inicialmente por um adapter ONNX executado localmente no backend.

O modelo deverá:

- funcionar adequadamente com português, inglês técnico e código;
- ter versão e checksum fixados;
- estar disponível antes do primeiro prompt;
- não ser baixado implicitamente durante uma solicitação;
- ter seu identificador, versão e dimensão persistidos.

A escolha inicial e as limitações do benchmark estão registradas em `docs/embedding-benchmark.md`.

Para a primeira versão foi selecionado `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`, revisão `e8f8c211226b894fcb81acc59f3b34ba3efd5f42`, em ONNX quantizado para AVX2. O adapter produz vetores de 384 dimensões por mean pooling com máscara de atenção e normalização L2.

O modelo e o tokenizer são preparados por um script explícito, ficam fora do Git e têm SHA-256 conferido antes da criação da sessão ONNX. O modo offline do tokenizer é forçado pelo adapter. A ausência ou divergência de qualquer artefato impede a ativação do provider; não existe caminho de download durante `EmbeddingProvider.generate`.

O provider permanece desativado por padrão nesta fase. Quando habilitado por configuração externa, sua inicialização é antecipada pelo Spring e valida a disponibilidade do modelo antes do processamento de prompts.

## 12. Persistência local e busca vetorial

O produto final executa sem Docker, containers ou serviços de banco de dados instalados separadamente. O `MemoryRepository` é implementado por um adapter Apache Lucene 10.5.1 embutido no processo Java e persiste o índice em um diretório local configurável.

O backend fornece seus próprios embeddings. `KnnFloatVectorField` e `KnnFloatVectorQuery` executam a busca de vizinhos por cosseno, com filtros prévios por estado, modelo, versão e dimensão. O score positivo normalizado retornado pelo Lucene permanece apenas como dado de recuperação; a interpretação `FULL`, `PARTIAL` ou `NONE` continua no domínio.

O índice usa `FSDirectory`, um único `IndexWriter` e `SearcherManager`. Cada mutação realiza commit durável e refresh antes de retornar. O diretório é criado automaticamente; índices existentes precisam declarar o schema local v1 e a mesma dimensão configurada, caso contrário a inicialização falha de forma controlada.

O adapter MongoDB/mongot da Fase 5 e seus testes Testcontainers foram removidos do backend. Como aquele armazenamento continha somente dados de prova e teste, não existe migração automática de documentos MongoDB; uma migração de formato futuro deverá ser explícita e versionada.

O diretório, a dimensão e o `top-K` são externos. A troca de versão principal do Lucene, schema ou dimensão exige uma estratégia explícita de migração ou reindexação.

## 13. Fluxo do PromptOrchestrator

1. validar a requisição;
2. sanitizar prompt e contexto;
3. obter contexto local estruturado;
4. normalizar o prompt;
5. gerar o hash;
6. buscar candidatos exatos;
7. avaliar compatibilidade;
8. se houver `FULL`, registrar uso e responder localmente;
9. caso contrário, gerar embedding local;
10. executar busca vetorial;
11. classificar candidatos;
12. construir um `ResolutionPlan`;
13. em `FULL`, responder localmente;
14. em `PARTIAL`, enviar à IA apenas conhecimento relevante e diferenças conhecidas;
15. em `NONE`, enviar à IA somente prompt e contexto mínimo;
16. persistir de modo idempotente a solução produzida;
17. registrar métricas;
18. devolver resposta e metadados de origem.

Pesquisa externa terá uma decisão própria e posterior à consulta de memória. Ela permanecerá desativada no primeiro MVP.

## 14. Política de falhas

Se a memória não puder ser consultada integralmente, nenhuma integração externa será chamada. O backend retornará um erro controlado e registrará a falha sem incluir conteúdo sensível.

Se a IA produzir uma resposta e a persistência falhar, a operação não deverá ser apresentada como completamente bem-sucedida. Idempotência e estratégia de recuperação serão definidas durante a implementação do provider.

## 15. Segurança

- nunca armazenar ou registrar API keys, tokens e senhas;
- minimizar o contexto enviado;
- não enviar automaticamente arquivos completos;
- aplicar allowlist de informações do workspace;
- sanitizar conteúdo antes de chamadas externas;
- não persistir caminhos absolutos por padrão;
- manter segredos em configuração externa;
- impedir que respostas da API exponham configurações secretas.

## 16. Observabilidade

O backend deverá distinguir medidas reais de estimativas. A principal evidência de economia será `avoidedAiCalls`.

Métricas planejadas:

```text
totalPrompts
exactCacheHits
semanticFullHits
semanticPartialHits
aiCalls
avoidedAiCalls
externalSearchCalls
localResponses
tokensInput
tokensOutput
estimatedTokensSaved
averageSimilarity
```

Também serão medidas latências das etapas locais e externas, sem usar conteúdo do prompt como label.

## 17. Restrições do MVP

O MVP não executará comandos, não modificará automaticamente código, não abrirá pull requests, não terá múltiplos agentes, não dependerá do Copilot e não fará deploy em cloud.

## 18. Proteção arquitetural

Testes arquiteturais deverão garantir que:

- controllers dependam apenas de ports de entrada;
- domínio não dependa de Spring ou infraestrutura;
- adapters externos não sejam acessados pela apresentação;
- a IA nunca seja chamada antes da conclusão da consulta à memória;
- falha na memória impeça chamadas externas.

As decisões detalhadas estão registradas em `docs/decisions`.
