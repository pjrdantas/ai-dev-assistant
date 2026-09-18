# AI Dev Assistant

## Autor

**Paulo Dantas**

Criador e desenvolvedor do **AI Dev Assistant**.

## O que é a ferramenta

O **AI Dev Assistant** é uma extensão para Visual Studio Code que adiciona um **Custom Agent ao GitHub Copilot**.

A ferramenta acrescenta ao Copilot uma **memória técnica local**, permitindo localizar e reutilizar soluções técnicas já utilizadas anteriormente.

O objetivo é evitar que problemas semelhantes precisem ser resolvidos do zero a cada nova solicitação.

O **GitHub Copilot continua sendo a inteligência artificial generativa**. O AI Dev Assistant complementa o Copilot com memória local, busca exata, busca semântica e reutilização de conhecimento.

## Como funciona

Quando o usuário seleciona o **AI Dev Assistant** no GitHub Copilot e faz uma solicitação:

1. O AI Dev Assistant recebe a solicitação.
2. Consulta primeiro a memória técnica local.
3. Procura uma correspondência exata.
4. Se necessário, realiza uma busca semântica local.
5. A memória classifica o resultado como **FULL**, **PARTIAL** ou **NONE**.
6. O GitHub Copilot continua normalmente a análise da tarefa.
7. O Copilot pode pesquisar o workspace, ler e alterar arquivos, executar terminal, build e testes.
8. A resposta final pode ser registrada.
9. Conhecimento técnico reutilizável pode ser armazenado para futuras solicitações.

### Fluxo resumido

**Usuário → AI Dev Assistant → Memória local → GitHub Copilot → Solução final → Conhecimento reutilizável**

## O que significam FULL, PARTIAL e NONE

### FULL

Existe uma solução reutilizável e tecnicamente compatível com a solicitação atual.

### PARTIAL

Existe conhecimento relacionado que pode ajudar, mas a solução pode precisar de adaptação.

### NONE

Não foi encontrado conhecimento suficientemente relacionado. O GitHub Copilot continua normalmente a análise e a produção da nova solução.

## Integração com o GitHub Copilot

O AI Dev Assistant **não substitui o GitHub Copilot** e não restringe suas ferramentas nativas.

O Copilot continua podendo:

- pesquisar arquivos em todo o workspace;
- localizar arquivos que não estão abertos;
- ler e alterar código;
- criar e editar múltiplos arquivos;
- executar comandos no terminal;
- executar builds;
- executar testes;
- analisar erros;
- usar o modelo escolhido pelo usuário no model picker nativo.

O AI Dev Assistant adiciona a camada de memória técnica local.

## Memória técnica local

A memória operacional utiliza **MongoDB local**.

Configuração padrão:

- **MongoDB URI:** `mongodb://127.0.0.1:27017`
- **Database:** `ai_dev_assistant`

A memória permanece no ambiente local do usuário.

## Gerenciamento da memória

O AI Dev Assistant permite ativar e desativar memórias sem apagar fisicamente os dados armazenados no MongoDB.

Os comandos estão disponíveis na Command Palette do Visual Studio Code:

- **AI Dev Assistant: Deactivate All Memories**
  Desativa todas as memórias atualmente ativas. As informações permanecem armazenadas no MongoDB e podem ser reativadas posteriormente.

- **AI Dev Assistant: Reactivate All Invalidated Memories**
  Reativa somente as memórias que foram explicitamente invalidadas e possuem registro de invalidação.

- **AI Dev Assistant: Reactivate Memory**
  Exibe as memórias inativas e permite selecionar uma memória específica para reativação.

- **AI Dev Assistant: Reactivate All Memories**
  Reativa todas as memórias inativas, independentemente do motivo pelo qual foram desativadas.

A desativação ou reativação não altera o conteúdo original da memória, incluindo solicitação, resposta, contexto técnico e embedding.

## Busca semântica local

Quando uma busca exata não encontra uma solução, o AI Dev Assistant pode realizar busca semântica local.

Essa busca utiliza um modelo **MiniLM** executado localmente através de **ONNX**.

O modelo de embeddings é carregado somente quando necessário.

## Captura automática de interações

As interações realizadas através do Custom Agent podem ser capturadas automaticamente.

O processo relaciona a solicitação do usuário com a resposta final do GitHub Copilot e permite que conhecimento técnico reutilizável seja promovido para a memória local.

## Privacidade

A memória do AI Dev Assistant é armazenada localmente.

A extensão não possui servidor próprio de memória e não utiliza API key própria de OpenAI, Anthropic ou Groq.

O GitHub Copilot continua operando de acordo com seus próprios serviços, políticas e permissões.

## Requisitos

- Visual Studio Code 1.137 ou superior
- GitHub Copilot
- suporte a Agent Mode e Custom Agents
- MongoDB local em execução

## Licença

O **AI Dev Assistant** é disponibilizado sob a **Apache License 2.0**.

Consulte o arquivo [LICENSE](LICENSE) para os termos completos.

Copyright 2026 Paulo Dantas.

## Autor

**Paulo Dantas**

Criador e desenvolvedor do **AI Dev Assistant**.
