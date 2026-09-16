# AI Dev Assistant

## O que é

AI Dev Assistant é um único VSIX que adiciona ao VS Code um Custom Agent nativo do
GitHub Copilot com memória técnica local reutilizável. Ele não cria um chat próprio nem
substitui o Copilot Agent.

## Arquitetura

O fluxo é: VS Code → GitHub Copilot Chat → model picker nativo → **AI Dev Assistant** →
ferramentas nativas do Copilot Agent e tools adicionais de memória local. Antes de
produzir uma nova solução técnica, o agente consulta a memória; em um exact miss, a busca
semântica usa ONNX/WebAssembly local sob demanda.

Não há backend, Java, Spring, Docker obrigatório, WebView, API key própria ou outro
provider de IA. O GitHub Copilot é a única IA integrada pelo produto; MongoDB local é o
store operacional da memória.

## Requisitos

- VS Code `1.137.0` ou superior;
- GitHub Copilot disponível no VS Code;
- suporte a Custom Agents e Agent mode na instalação e na conta do usuário.
- MongoDB Community Server local em execução, acessível em
  `mongodb://127.0.0.1:27017` por padrão.

Os modelos disponíveis dependem da conta, plano e políticas do GitHub Copilot. O produto
não exige Copilot Enterprise especificamente e não escolhe nem fixa um modelo.

## Instalação

Baixe ou gere `vscode-extension/ai-dev-assistant-0.1.0.vsix` e instale-o:

```powershell
code --install-extension .\ai-dev-assistant-0.1.0.vsix
```

Também é possível usar **Extensions: Install from VSIX...** no VS Code.

## Uso

1. Abra o workspace no VS Code.
2. Abra o GitHub Copilot Chat e selecione **AI Dev Assistant** no seletor de Agents.
3. Escolha o modelo disponível no model picker nativo.
4. Faça sua solicitação de desenvolvimento.

## Workspace

Os arquivos não precisam estar abertos. O Agent pode usar as ferramentas normais do
VS Code/Copilot para localizar, pesquisar, ler e alterar os arquivos relevantes em todo
o workspace, além de executar terminal, build e testes conforme suas permissões. Isso não
significa que todo o codebase é enviado integralmente ao modelo.

## Memória local

`saveMemory` preserva a solicitação original do usuário e a solução reutilizável. A chave
de exact match é normalizada localmente de forma determinística; o Copilot não define essa
chave. `searchMemory` procura primeiro uma correspondência exata e, se necessário, uma
correspondência semântica local. Os resultados são `FULL` (reutilizável e compatível),
`PARTIAL` (relevante, mas requer adaptação) ou `NONE`.

O conhecimento é salvo no MongoDB local, database `ai_dev_assistant` por padrão. URI e
database podem ser alterados pelas Settings `aiDevAssistant.mongodb.uri` e
`aiDevAssistant.mongodb.database`; não coloque credenciais em configurações compartilhadas
do workspace. ONNX e o tokenizer somente são
inicializados na primeira busca semântica necessária; por isso essa primeira busca pode
demorar mais, dependendo do hardware. Um exact match não inicializa ONNX.

## Comandos

- **AI Dev Assistant: MongoDB Status** mostra conexão, URI sem credenciais, database e
  contagens.
- **AI Dev Assistant: Migrate Local Memory to MongoDB** migra o JSON histórico sem apagá-lo.
- **AI Dev Assistant: Show Memory Statistics** e **Clear Local Memory** usam MongoDB;
  limpar inativa memórias e preserva interações.

## Privacidade

O MongoDB local pode armazenar perguntas e respostas capturadas quando os hooks Preview
estão habilitados, contexto técnico, sessões e embeddings numéricos de memórias
reutilizáveis. Por padrão, ele é acessado somente em `mongodb://127.0.0.1:27017`; o
produto não copia esse banco para um servidor próprio.

A memória e seus embeddings são processados e persistidos localmente. As tools de memória
não chamam internet nem outro LLM. A conversa enviada ao Copilot é processada pelo serviço
normal do GitHub Copilot, sujeito à conta e às políticas aplicáveis. O AI Dev Assistant
não faz chamadas próprias a OpenAI, Anthropic ou Gemini e não requer API key externa.

## Desenvolvimento e validação

Consulte [docs/operations.md](docs/operations.md) para os cenários manuais e os comandos
de validação. A arquitetura e suas decisões estão em [docs](docs).
