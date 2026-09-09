# Especificação do produto — AI Dev Assistant

## 1. Propósito deste documento

Este documento é a fonte de verdade inicial dos requisitos do AI Dev Assistant. Ele deve ser consultado antes de decisões arquiteturais ou alterações relevantes de escopo. Mudanças futuras precisam ser justificadas e refletidas neste documento, nos ADRs e no roadmap quando aplicável.

## 2. Visão do produto

O AI Dev Assistant será um assistente de desenvolvimento integrado ao VS Code. Ele deverá reutilizar conhecimento técnico armazenado localmente antes de recorrer a uma IA ou a uma fonte externa.

Objetivos:

- reutilizar soluções anteriores;
- economizar tokens e chamadas pagas;
- evitar consultas externas desnecessárias;
- acumular conhecimento técnico útil;
- reutilizar padrões dos projetos do próprio desenvolvedor;
- melhorar progressivamente a qualidade das respostas;
- manter uma memória técnica local.

O produto deve atender inicialmente solicitações relacionadas a código, testes, documentação, correção de erros, refatoração, Java, Spring Boot, Angular, Cucumber, Kafka, AWS e Terraform, sem ficar arquiteturalmente preso a uma linguagem ou tipo de tarefa.

## 3. Invariante central

Toda solicitação do usuário deverá consultar primeiro a memória local antes de qualquer chamada para IA externa ou pesquisa externa.

Essa regra deve ser implementada no fluxo da aplicação. Ela não pode depender apenas de uma instrução enviada ao modelo.

Fluxo obrigatório:

```text
PROMPT DO USUÁRIO
        ↓
ANÁLISE LOCAL DO CONTEXTO
        ↓
CONSULTA À MEMÓRIA LOCAL
        ↓
BUSCA EXATA
        ↓
BUSCA SEMÂNTICA, SE NECESSÁRIA
        ↓
AVALIAÇÃO DE COMPATIBILIDADE
        ↓
CLASSIFICAÇÃO: FULL / PARTIAL / NONE
        ↓
DECISÃO SOBRE IA E PESQUISA EXTERNA
```

Nenhum controller, componente de apresentação ou extensão do VS Code poderá chamar um provedor de IA diretamente. Toda chamada deverá passar pelo `PromptOrchestrator`.

Se a consulta obrigatória à memória não puder ser concluída, o comportamento padrão do MVP será falhar de forma controlada sem chamar a IA externa.

## 4. Cenários de resolução

### 4.1. Conhecimento completo — FULL

Quando houver uma solução local suficientemente similar e tecnicamente compatível:

- responder usando a memória local;
- não chamar IA externa;
- não executar pesquisa externa;
- incrementar a quantidade de reutilizações;
- registrar data, projeto e similaridade da última utilização;
- registrar métricas de economia.

### 4.2. Conhecimento parcial — PARTIAL

Quando houver conhecimento útil, porém incompleto ou incompatível em algum aspecto adaptável:

- identificar as partes reutilizáveis;
- identificar diferenças objetivas e informações ausentes;
- selecionar somente o contexto necessário;
- chamar a IA apenas para produzir o complemento ou adaptação;
- produzir uma resposta final coerente;
- persistir a nova solução completa;
- registrar uso da memória e métricas da chamada.

### 4.3. Conhecimento não encontrado — NONE

Quando não houver conhecimento suficiente:

- decidir separadamente se pesquisa externa é necessária;
- chamar a IA externa com o menor contexto necessário;
- persistir a solução obtida;
- devolver a resposta com metadados da origem.

## 5. IA externa e pesquisa externa

IA e internet são integrações diferentes:

```text
AiProvider
ExternalSearchProvider
```

Uma ausência na memória não deverá iniciar pesquisa externa automaticamente. A necessidade de informações atuais deve ser avaliada por uma política independente, depois da consulta à memória.

Pesquisa externa não faz parte do primeiro MVP e deverá permanecer desabilitada até uma fase específica.

## 6. Tecnologias e estilo arquitetural

Backend preferencial:

- Java 21;
- Spring Boot;
- Maven;
- MongoDB local;
- Docker e Docker Compose;
- REST;
- Swagger/OpenAPI;
- JUnit 5;
- Mockito.

Princípios obrigatórios:

- arquitetura hexagonal;
- SOLID;
- Clean Code;
- baixo acoplamento;
- domínio independente de frameworks e fornecedores;
- separação entre domínio, aplicação e infraestrutura;
- nenhuma regra de negócio em controllers.

O MVP utilizará inicialmente um único módulo Maven, organizado internamente por capacidade funcional e limites hexagonais. A criação de múltiplos módulos Maven dependerá de necessidade concreta.

## 7. Capacidades principais

Responsabilidades conceituais esperadas:

- orquestração do prompt;
- análise local e segura do contexto;
- normalização e fingerprint do prompt;
- busca exata;
- geração local de embedding;
- busca semântica;
- avaliação de compatibilidade;
- classificação da memória;
- persistência e registro de reutilização;
- acesso abstrato a IA externa;
- acesso abstrato a pesquisa externa;
- composição da resposta;
- captura controlada do contexto do projeto;
- observabilidade.

Nomes sugeridos como `ExactMatchService`, `AiService` e `SolutionComposer` não tornam classes obrigatórias. Uma classe só deve existir quando possuir responsabilidade real, regra própria e comportamento testável.

## 8. Ports obrigatórios

O desenho deve permitir ports equivalentes a:

```text
ProcessPromptUseCase
MemoryRepository
EmbeddingProvider
AiProvider
ExternalSearchProvider
ProjectContextProvider
MetricsRecorder
```

O domínio não poderá depender diretamente de OpenAI, Anthropic, Gemini, MongoDB, APIs externas ou VS Code.

Novos providers, como OpenAI, Claude, Gemini ou LLM local, deverão ser adicionados por adapters sem alterar a regra central.

## 9. Busca exata

A busca exata deverá ocorrer antes da geração de embedding:

```text
prompt
  ↓
normalização conservadora e versionada
  ↓
SHA-256
  ↓
busca por hash
```

A normalização inicial deverá:

- remover espaços externos;
- normalizar quebras de linha;
- tratar espaços repetidos com cuidado;
- preservar blocos de código, strings, identificadores, pontuação relevante e caixa quando houver significado técnico;
- possuir uma versão persistida junto com o conhecimento.

O hash identifica equivalência textual normalizada, mas não comprova compatibilidade técnica.

## 10. Embeddings e busca semântica

Quando não houver match exato plenamente compatível:

```text
prompt
  ↓
embedding gerado localmente
  ↓
busca vetorial
  ↓
candidatos mais próximos
```

O embedding deverá ser gerado localmente sempre que tecnicamente viável. O modelo precisa ser versionado, ter dimensão fixa e estar disponível antes do processamento do prompt. O processamento não deverá provocar download remoto implícito do modelo.

Thresholds de classificação devem ser externos e validados. Valores iniciais como `0.90` para FULL e `0.72` para PARTIAL são hipóteses que precisarão de calibração com um conjunto de avaliação.

## 11. Similaridade e compatibilidade

Similaridade semântica não significa compatibilidade técnica.

A classificação deverá considerar:

- linguagem e versão;
- framework e versão;
- dependências relevantes;
- tipo de tarefa;
- tecnologias do projeto;
- estado e idade do conhecimento;
- modelo que produziu o embedding;
- conflitos explícitos entre o contexto atual e o conhecimento armazenado.

Conflitos importantes, como Spring Boot 2 versus Spring Boot 3, deverão impedir uma classificação `FULL`, mesmo com similaridade textual elevada.

## 12. Contexto do projeto

A arquitetura deve permitir evolução para detectar:

- linguagem e versão;
- Java e Spring Boot;
- Angular e Node;
- dependências;
- Maven ou Gradle;
- `pom.xml`, `build.gradle` e `package.json`;
- estrutura do projeto;
- branch e commit Git;
- caminhos relativos;
- tecnologias encontradas.

No MVP, o contexto deverá ser pequeno, estruturado e explicitamente permitido. Arquivos inteiros não devem ser enviados automaticamente para uma IA.

Caminhos absolutos do workspace não devem ser persistidos por padrão. Deve-se preferir identificadores estáveis ou fingerprints.

## 13. Memória reutilizável

A collection inicial será semelhante a `ai_memory` e deverá representar conhecimento reutilizável, não histórico infinito de conversa.

O conhecimento deverá prever:

- prompt original e normalizado;
- versão da normalização;
- hash;
- intent, domínio, assunto e tags;
- aplicabilidade técnica;
- solução;
- embedding e identificação do modelo;
- proveniência;
- projeto de origem;
- qualidade e validação;
- estado do ciclo de vida;
- revisão e conhecimento substituído;
- datas e estatísticas de utilização.

Para o MVP, respostas poderão ser persistidas automaticamente, mas a estrutura deverá permitir futuramente:

- `qualityScore`;
- feedback do usuário;
- promoção de memória;
- desativação;
- versionamento;
- conhecimento substituído;
- deduplicação.

Estados iniciais previstos:

```text
ACTIVE
SUPERSEDED
DEPRECATED
```

## 14. Deduplicação e evolução do conhecimento

Conhecimentos semanticamente equivalentes não devem gerar centenas de documentos repetidos.

O processo deverá evoluir para classificar uma nova solução como:

```text
novo conhecimento
complemento
melhoria
duplicado
```

No MVP, uma chave de deduplicação, índice apropriado e persistência idempotente devem impedir duplicações exatas e reduzir problemas de concorrência.

## 15. Integração com VS Code

A extensão utilizará TypeScript e a VS Code Extension API. A primeira interface deverá ser uma sidebar ou painel próprio com:

- campo para prompt;
- ação de envio;
- área de resposta;
- indicação da fonte;
- similaridade;
- indicação do uso de IA e pesquisa externa.

A extensão conversará inicialmente com:

```text
http://localhost:8080
```

Ela deverá funcionar sem GitHub Copilot. Integrações com Copilot, Chat Participant API e Language Model Tool API ficam para o futuro.

## 16. Configuração

Configurações externas previstas:

- URL e database do MongoDB;
- threshold de match completo;
- threshold de match parcial;
- top-K e quantidade de candidatos da busca vetorial;
- provider, modelo, temperatura e limite de tokens da IA;
- API key;
- provider e modelo de embedding;
- habilitação de pesquisa externa.

Segredos não podem ficar hardcoded, ser commitados, aparecer em logs ou ser devolvidos pelas APIs.

## 17. Segurança e privacidade

Princípio obrigatório:

```text
Enviar para a IA somente o contexto necessário.
```

O sistema deverá:

- sanitizar prompts e contexto;
- procurar padrões comuns de segredo antes de chamadas externas;
- usar uma allowlist de metadados e arquivos permitidos;
- evitar logs de conteúdo sensível;
- limitar tamanho dos payloads;
- não devolver configurações secretas;
- não ler ou enviar automaticamente o workspace inteiro.

## 18. Observabilidade

Métricas desejadas:

```text
totalPrompts
exactCacheHits
semanticFullHits
semanticPartialHits
aiCalls
externalSearchCalls
localResponses
tokensInput
tokensOutput
estimatedTokensSaved
averageSimilarity
```

Também deverão ser consideradas latências de normalização, embedding, MongoDB e IA, além de `avoidedAiCalls`.

Contagens reais e estimativas devem ser apresentadas separadamente. Prompts, caminhos e identificadores de projeto não devem ser usados como labels de alta cardinalidade.

## 19. Contrato de resposta

Além do texto, a API deverá retornar metadados suficientes para demonstrar a origem e a economia:

```json
{
  "response": "...",
  "source": "LOCAL_MEMORY",
  "matchType": "FULL",
  "similarity": 0.96,
  "aiCalled": false,
  "externalSearchCalled": false
}
```

## 20. Escopo do primeiro MVP

O MVP deverá:

1. receber um prompt;
2. analisar contexto local disponível;
3. normalizar o prompt;
4. gerar SHA-256;
5. procurar match exato;
6. gerar embedding local quando necessário;
7. procurar semanticamente;
8. avaliar compatibilidade;
9. classificar como `FULL`, `PARTIAL` ou `NONE`;
10. responder localmente em `FULL`;
11. usar memória e IA somente para complemento em `PARTIAL`;
12. chamar IA em `NONE`;
13. persistir a solução produzida;
14. devolver resposta e metadados;
15. integrar com a extensão do VS Code.

## 21. Fora do escopo inicial

Não implementar inicialmente:

- múltiplos agentes autônomos;
- execução automática de comandos;
- alteração automática de código;
- pull requests automáticos;
- integração com GitHub;
- multiusuário e autenticação;
- deploy em cloud ou Kubernetes;
- frontend Angular separado;
- dashboard complexo;
- marketplace e billing;
- fine-tuning.

## 22. Testes obrigatórios

Testes devem existir desde o início, especialmente para:

- normalização;
- hash;
- busca exata e semântica;
- classificação e conflitos de versões;
- orquestração;
- persistência idempotente;
- indisponibilidade da memória;
- limites arquiteturais.

Cenários mínimos do `PromptOrchestrator`:

```text
FULL    → AiProvider nunca é chamado
PARTIAL → memória é usada e a IA recebe somente o complemento necessário
NONE    → IA é chamada e a nova solução é persistida
ERRO NA MEMÓRIA → nenhuma integração externa é chamada
```

O `PromptOrchestrator` deve ser testável com mocks ou fakes dos ports externos.

## 23. Visão futura

A solução deverá permitir módulos especializados em:

```text
CODE
TESTES
DOCUMENTAÇÃO
ANÁLISE DE PROJETOS
JAVA
ANGULAR
JUNIT
CUCUMBER
KAFKA
AWS
TERRAFORM
```

Também poderá utilizar projetos locais como referência para geração de testes E2E/Cucumber. Essa evolução não deve introduzir dependência do núcleo em uma linguagem específica.

## 24. Forma de trabalho

- trabalhar de forma incremental;
- descrever o que será desenvolvido antes de iniciar cada atividade;
- analisar impactos antes de grandes mudanças;
- registrar decisões relevantes em ADRs;
- não criar dezenas de arquivos ou abstrações sem necessidade concreta;
- implementar e validar uma fase antes de avançar para a próxima;
- não alterar a regra `memory-first` sem uma decisão explícita do responsável pelo produto.
