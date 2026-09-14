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
┌───────────────────────────┐  ┌────────────────────────────┐
│ Pipeline local de memória │  │ Autorização temporária    │
│                           │  │ para o adapter Copilot    │
│ normalização              │  │ da extensão VS Code       │
│ hash SHA-256              │  └────────────────────────────┘
│ busca exata               │
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
  → resposta FULL ou autorização temporária PARTIAL/NONE
  → adapter Copilot da extensão, somente quando autorizado
  → CompleteAiResponseUseCase
  → persistência local antes da resposta final
```

Fluxos proibidos:

```text
Controller → modelo de IA
Componente visual → vscode.lm
Extensão → vscode.lm sem autorização temporária do backend
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
- `CompleteAiResponseUseCase`.

### Saída

- `MemoryRepository`;
- `EmbeddingProvider`;
- `ExternalSearchProvider`;
- `ProjectContextProvider`;
- `MetricsRecorder`.

O `ExternalSearchProvider` será uma extensão planejada, mas não terá implementação no primeiro MVP.

## 7. Adapters planejados

- adapter REST para entrada de prompts;
- adapter embutido para memória, busca exata e vetorial no produto final;
- adapter ONNX para embeddings locais;
- adapter TypeScript futuro para a Language Model API do VS Code;
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
14. em `PARTIAL`, autorizar temporariamente somente o conhecimento relevante e as diferenças;
15. em `NONE`, autorizar temporariamente somente prompt e contexto mínimo;
16. a extensão chama o Copilot com a autorização recebida;
17. validar a correlação quando a extensão devolver a resposta;
18. persistir de modo idempotente a solução produzida;
19. registrar métricas;
20. devolver resposta e metadados de origem.

Pesquisa externa terá uma decisão própria e posterior à consulta de memória. Ela permanecerá desativada no primeiro MVP.

### Implementação da Fase 7

O port de entrada `ProcessPromptUseCase` recebe um `ProcessPromptCommand` com o prompt
e o contexto técnico estruturado. O `PromptOrchestrator` implementa esse port sem
depender de Spring ou de adapters.

O fluxo implementado:

1. normaliza o prompt e gera o hash;
2. consulta todos os candidatos exatos e avalia a compatibilidade;
3. interrompe o pipeline local sem gerar embedding quando encontra um `FULL` exato;
4. quando necessário, gera o embedding local e consulta candidatos semânticos compatíveis;
5. seleciona primeiro um `FULL` e, na ausência dele, o `PARTIAL` de maior similaridade;
6. registra a reutilização antes de responder localmente ou autorizar seu uso externo;
7. em `PARTIAL`, prepara somente o prompt, o contexto técnico permitido, a solução
   selecionada e os motivos objetivos de adaptação;
8. em `NONE`, não inclui conhecimento local na solicitação externa;
9. exige que a resposta externa retorne com a autorização temporária correspondente;
10. persiste a resposta produzida externamente, com o embedding já calculado, antes de
    retornar sucesso.

O `ResolutionPlan` impede combinações inconsistentes entre classificação e memória
selecionada. O `AssistantResponse` protege as invariantes de origem, uso de IA,
similaridade e pesquisa externa desabilitada.

Falhas na busca exata, geração local do embedding, busca semântica ou registro de
reutilização resultam em `MemoryUnavailableException` sem autorização para IA externa.
Falha ao persistir uma resposta já produzida externamente resulta em
`MemoryPersistenceException` e não é apresentada como sucesso.

### Implementação da Fase 8

O canal externo foi corrigido para usar a licença GitHub Copilot Enterprise do usuário
pela Language Model API do VS Code. Como `vscode.lm` existe somente na extensão, o
backend não possui cliente de IA, API key ou dependência de fornecedor.

O `PromptOrchestrator` implementa duas operações. `ProcessPromptUseCase` conclui a
memória e retorna uma resposta `FULL` ou uma `ExternalAiRequest` temporária para
`PARTIAL`/`NONE`. `CompleteAiResponseUseCase` aceita a resposta do Copilot apenas quando
o identificador corresponde a uma preparação válida e não expirada, persiste o
conhecimento e então cria a resposta final.

O conteúdo externo é minimizado e examinado para padrões de credenciais depois da busca
local e antes de a autorização ser criada. Reenvios idênticos da conclusão retornam o
mesmo resultado; conclusões divergentes, desconhecidas ou expiradas são recusadas.
Preparações pendentes são efêmeras e desaparecem na reinicialização do backend.

Ao final da Fase 8, o adapter TypeScript, o consentimento do usuário, a seleção defensiva
de modelos `vendor: "copilot"` e o contrato REST funcional permaneceram pendentes para
a fase da extensão. Pesquisa externa continuou desabilitada.

### Implementação da Fase 10

O backend expõe `POST /api/v1/prompts` e
`POST /api/v1/prompts/{requestId}/ai-response` por um adapter REST. O controller somente
valida e mapeia DTOs para `ProcessPromptUseCase` e `CompleteAiResponseUseCase`; decisão,
consulta à memória, autorização e persistência permanecem no `PromptOrchestrator`.
Erros funcionais são convertidos para Problem Details sem conteúdo da solicitação.

A extensão é dividida em quatro responsabilidades concretas:

- `AssistantViewProvider`: campo de prompt, estado e apresentação da resposta;
- `PromptCoordinator`: impõe a ordem contexto local, backend, Copilot e conclusão;
- `HttpAssistantBackend`: aceita somente URL HTTP de localhost e valida o contrato;
- `CopilotLanguageModelGateway`: único componente que acessa `vscode.lm`.

`VscodeProjectContextProvider` procura no máximo vinte `pom.xml` e `package.json`, ignora
pastas de build e arquivos acima de 256 KiB e devolve somente linguagens, frameworks,
versões e ferramenta de build. Conteúdo e caminhos não atravessam o contrato REST.

O gateway seleciona exclusivamente `vendor: "copilot"`, respeita uma família preferida
sem fixar modelos indisponíveis, conta tokens com o tokenizer do modelo, verifica o
limite de entrada e consome a resposta em streaming. Falha de consentimento, licença,
quota ou modelo não habilita outro provider.

## 14. Política de falhas

Se a memória não puder ser consultada integralmente, nenhuma integração externa será chamada. O backend retornará um erro controlado e registrará a falha sem incluir conteúdo sensível.

Se a IA produzir uma resposta e a persistência falhar, a operação não será apresentada
como bem-sucedida. A preparação permanece disponível para repetir a mesma conclusão sem
contabilizar uma nova chamada externa.

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

O backend distingue medidas contadas de estimativas. A principal evidência de economia
é `avoidedAiCalls`. O caso de uso depende da porta de saída `PromptMetricsRecorder`, e o
adapter Micrometer traduz eventos operacionais para métricas sem expor conteúdo.

Indicadores cobertos pelas métricas implementadas:

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

Uma autorização é registrada separadamente e não conta como chamada de IA. A chamada é
considerada realizada somente na primeira conclusão externa aceita pelo backend. Tokens
opcionais são contados pela extensão com o tokenizer do modelo selecionado e não são
tratados como consumo faturado. A economia de uma resposta `FULL` usa uma estimativa por
caracteres, em série separada.

As latências de normalização, buscas, embedding, persistência e conclusão são medidas no
backend. A duração da execução do Copilot é medida pela extensão. Somente
enums limitados são labels; prompts, respostas, caminhos e identificadores nunca são
labels. Falhas de telemetria não alteram o fluxo memory-first. O catálogo e a metodologia
estão em `docs/observability.md` e na ADR 0015.

## 17. Restrições do MVP

O MVP não executará comandos, não modificará automaticamente código, não abrirá pull
requests, não terá múltiplos agentes e não fará deploy em cloud. A funcionalidade de IA
dependerá do GitHub Copilot Enterprise disponível e autorizado no VS Code do usuário;
sem ele, o reaproveitamento local continuará disponível.

## 18. Proteção arquitetural

Testes arquiteturais deverão garantir que:

- controllers dependam apenas de ports de entrada;
- domínio não dependa de Spring ou infraestrutura;
- adapters externos não sejam acessados pela apresentação;
- a IA nunca seja chamada antes da conclusão da consulta à memória;
- falha na memória impeça chamadas externas.

As decisões detalhadas estão registradas em `docs/decisions`.

## 19. Endurecimento da integração

Na Fase 11, um teste de aplicação atravessa o adapter REST, o `PromptOrchestrator` e o
adapter Lucene. O cenário cria uma autorização `NONE`, devolve uma conclusão externa
simulada, confirma a persistência e repete o mesmo prompt para obter `FULL` sem nova
chamada. O mesmo teste verifica os contadores de prompts, chamadas realizadas e chamadas
evitadas.

Na extensão, o contrato recebido do backend é aceito somente quando identificadores,
similaridade, classificação, fonte e indicador de IA formam uma combinação válida.
Corpos HTTP acima de 300.000 caracteres e respostas do Copilot acima de 200.000
caracteres são recusados. Esses limites protegem o processo da extensão e permanecem
acima do limite funcional de 200.000 caracteres aplicado à conclusão pelo backend.

O gateway carrega a API do VS Code somente ao executar uma autorização válida. Essa
fronteira permite testar seleção de modelo, fallback restrito ao mesmo vendor, streaming,
tokens e limites sem chamar um modelo real. A extensão não declara dependência obrigatória
do Copilot no manifesto, preservando respostas `FULL` para usuários sem modelo disponível.
