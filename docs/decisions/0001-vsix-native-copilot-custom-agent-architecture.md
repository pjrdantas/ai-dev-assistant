# ADR 0001 — Arquitetura VSIX Native Copilot Custom Agent

## Decisão

O AI Dev Assistant será distribuído como um único VSIX que contribui um Custom Agent do
GitHub Copilot por `contributes.chatAgents`. O arquivo `.agent.md` não declara `model`,
para que a escolha permaneça no model picker nativo, e não declara `tools`, para não
restringir as capacidades padrão do Copilot Agent.

As tools `searchMemory` e `saveMemory` usam os IDs internos válidos
`ai-dev-assistant_searchMemory` e `ai-dev-assistant_saveMemory` em
`contributes.languageModelTools` e em `vscode.lm.registerTool`. Elas
complementam o Agent; não substituem descoberta, pesquisa, leitura de arquivos fechados,
edição multiarquivo, terminal, build ou testes.

O VSIX também contribui o container nativo `aiDevAssistant` na Activity Bar e a view
`aiDevAssistant.view`, implementada com `TreeDataProvider`. Essa central oferece somente
atalhos explícitos para comandos existentes, status/controle da memória e captura, além
de abrir o comando público `workbench.action.chat.open`. Ela não contém chat próprio,
não seleciona modelo e não executa efeitos colaterais ao ser aberta; a seleção do agente
AI Dev Assistant continua sendo feita pelo usuário no Chat nativo do GitHub Copilot.

O GitHub Copilot é a única IA. Não existem backend, WebView de chat, chat paralelo
próprio, provider de IA, seletor de modelo, Java, Spring, Lucene, Docker ou daemon
empacotado no produto final. O container nativo de administração na Activity Bar é
permitido conforme descrito acima. MongoDB local foi adotado posteriormente como store externo ativo pela
ADR 0002.

## Motivos

Um VSIX único reduz instalação, operação e superfície de segurança: o usuário usa a
identidade, os modelos e as permissões já administrados pelo GitHub Copilot. A ausência de
backend e daemon externo mantém a memória portátil no perfil do VS Code e evita
credenciais próprias do produto.

O Custom Agent preserva as capacidades adequadas ao desenvolvimento em vez de criar uma
interface paralela. As tools de memória são especializadas e adicionais, sem reduzir as
ferramentas nativas do Agent.

## Memória

A decisão original de arquivo privado foi substituída pela ADR 0002: MongoDB local é o
store ativo. `searchMemory` verifica primeiro uma correspondência exata; na ausência
dela, carrega sob demanda o modelo ONNX e o tokenizer empacotados para busca semântica.
`saveMemory` grava localmente apenas conteúdo reutilizável e não sensível.

Memory-first significa **consultar a memória antes de produzir uma nova solução técnica
dentro do agent loop**. Não significa que o Copilot não possa existir antes da consulta.
A memória é contexto complementar e nunca limita as ferramentas nativas necessárias para
investigar e validar o workspace.

O JSON em `globalStorageUri` permanece apenas como fonte de migração. A busca exata não
inicializa o modelo; apenas um exact miss pode inicializar sob demanda o ONNX e tokenizer
embutidos. A sessão permanece compartilhada enquanto a extensão estiver ativa.

## Consequências

O agente pode localizar um `pom.xml` fechado por suas ferramentas nativas, sem que o
usuário o abra manualmente. A escolha de modelo e permissões de ferramentas continuam sob
controle do VS Code e da conta Copilot do usuário. A extensão mantém o runtime local e
offline para memória, sem credenciais próprias.
