# AI Dev Assistant — extensão VS Code

Esta extensão distribui o Custom Agent nativo **AI Dev Assistant** e duas tools locais de
memória. Ela não cria interface própria, backend, configuração de modelo ou provider de
IA.

## Desenvolvimento

Requer Node.js 22 e VS Code 1.137 ou superior.

```powershell
npm ci
npm test
npm run package:vsix
```

Abra a raiz no VS Code, pressione `F5` e selecione **AI Dev Assistant** no Copilot Chat.
O GitHub Copilot e o model picker nativo controlam a IA. O agente mantém as ferramentas
nativas para pesquisar, ler, editar, executar terminal, build e testes em todo o
workspace.

A memória ativa fica no MongoDB local, com URI padrão `mongodb://127.0.0.1:27017` e
database `ai_dev_assistant`; ambos são configuráveis nas Settings do VS Code. O JSON em
`globalStorageUri` é apenas fonte histórica para a migração idempotente. O pacote pode ser instalado
com `code --install-extension .\ai-dev-assistant-0.1.0.vsix`. Consulte
`../docs/operations.md` para o roteiro completo.

## Captura automática de interações

Agent Hooks são Preview. **AI Dev Assistant: Enable Automatic Interaction Capture**
prepara somente launchers privados e detecta em runtime se
`chat.useCustomAgentHooks` está registrada antes de tentar ativá-la. Quando a setting não
existe no build instalado, o comando não falha e não cria hook global; o hook permanece
declarado no frontmatter do AI Dev Assistant, portanto não captura prompts do Agent
padrão nem de outros Custom Agents.

## Privacidade e armazenamento

Por padrão, o MongoDB **local** em `mongodb://127.0.0.1:27017`, database
`ai_dev_assistant`, pode armazenar perguntas técnicas, respostas capturadas, contexto
técnico do workspace, metadados de sessão, memórias reutilizáveis e embeddings numéricos
das memórias. O AI Dev Assistant não envia essa base MongoDB para um servidor próprio e
produz embeddings localmente.

Armazenamento local não torna o GitHub Copilot local: a conversa continua sendo
processada pelo serviço GitHub Copilot conforme suas políticas. A extensão não possui
chamadas próprias para OpenAI, Anthropic ou Groq. Prompts sensíveis detectados não são
persistidos em texto bruto. Agent Hooks são recursos Preview.
