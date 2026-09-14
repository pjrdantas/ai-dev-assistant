# AI Dev Assistant — extensão VS Code

Interface local do AI Dev Assistant. A extensão sempre envia a solicitação primeiro ao
backend memory-first. O GitHub Copilot só é acessado quando o backend devolve uma
autorização temporária `AI_REQUIRED`.

## Requisitos

- VS Code 1.137 ou superior;
- Node.js 22 para desenvolvimento;
- backend local em `http://127.0.0.1:8080`;
- GitHub Copilot Enterprise disponível e autorizado no VS Code para respostas externas.

## Desenvolvimento

```powershell
npm install
npm test
npm run package:vsix
```

Na raiz do repositório, pressione `F5` para abrir o Extension Development Host. A view
`AI Dev Assistant` estará disponível na Activity Bar.

## Configurações

- `aiDevAssistant.backendUrl`: aceita somente uma URL HTTP de localhost;
- `aiDevAssistant.requestTimeoutMs`: timeout das chamadas ao backend;
- `aiDevAssistant.copilotModelFamily`: preferência opcional; se indisponível, a extensão
  usa outro modelo permitido com `vendor: "copilot"`.

A extensão lê somente `pom.xml` e `package.json`, com limite de tamanho, para extrair
tecnologias e versões. Conteúdo de arquivo e caminhos não são enviados. A extensão não
executa comandos, não modifica código e não possui API key própria.

O pacote `ai-dev-assistant-0.1.0.vsix` pode ser instalado com
`code --install-extension .\ai-dev-assistant-0.1.0.vsix`. A extensão não declara o
Copilot como dependência obrigatória: respostas locais `FULL` continuam disponíveis sem
modelo, enquanto solicitações `AI_REQUIRED` falham de forma controlada quando o Copilot
Enterprise não estiver autorizado.

O roteiro operacional e de aceite manual está em `../docs/operations.md`.
