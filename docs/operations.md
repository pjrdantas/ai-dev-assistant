# Operação local do MVP

## Objetivo

Este guia descreve como preparar, executar, validar e empacotar o AI Dev Assistant no
Windows. O produto não exige Docker, container, MongoDB ou outro daemon de banco de
dados.

## Requisitos

- Java 21;
- Node.js 22;
- VS Code 1.137 ou superior;
- GitHub Copilot disponível e autenticado no VS Code com a licença Enterprise do
  usuário;
- acesso à internet somente para instalar dependências, preparar explicitamente o
  modelo e consumir o Copilot.

O backend não recebe credenciais do GitHub e a extensão não possui API key própria.
O VS Code solicita o consentimento do usuário quando a extensão tenta selecionar um
modelo Copilot pela primeira vez.

## Preparação inicial

Na raiz do repositório:

```powershell
java -version
node --version
code --version
.\scripts\embedding-model.ps1 prepare
cd vscode-extension
npm ci
```

O comando do modelo é explícito, valida os checksums e grava os artefatos ignorados pelo
Git em `backend/models`. Nenhum download ocorre durante o processamento de um prompt.

## Iniciar o backend

Em um terminal na raiz:

```powershell
cd backend
$env:EMBEDDING_LOCAL_ENABLED="true"
.\mvnw.cmd spring-boot:run
```

Antes de abrir a extensão, confirme:

```powershell
Invoke-RestMethod http://127.0.0.1:8080/actuator/health
```

O resultado esperado é `status` igual a `UP`. A memória fica, por padrão, em
`%USERPROFILE%\.ai-dev-assistant\memory`. Para uma validação isolada, defina
`AI_DEV_ASSISTANT_MEMORY_DIRECTORY` antes de iniciar o backend.

## Executar no Extension Development Host

1. Abra a raiz do repositório no VS Code.
2. Pressione `F5` e selecione `Executar AI Dev Assistant` se solicitado.
3. No novo Extension Development Host, abra `AI Dev Assistant` na Activity Bar.
4. Confirme que o GitHub Copilot está autenticado com a conta Enterprise.
5. Envie uma solicitação técnica sem credenciais ou conteúdo confidencial.

O primeiro envio sem conhecimento local deve mostrar o consentimento do VS Code quando
necessário. A extensão só seleciona `vendor: "copilot"` depois de o backend devolver
`AI_REQUIRED`. Não existe fallback para outro provider.

## Roteiro manual de aceite

Use um prompt novo e mantenha o mesmo contexto técnico entre as repetições.

1. Primeiro envio: o resultado esperado é `AI`, classificação `NONE` e IA utilizada.
2. Repita exatamente o mesmo prompt: o resultado esperado é `LOCAL_MEMORY`,
   classificação `FULL` e IA não utilizada.
3. Confirme que a segunda resposta é a solução persistida no primeiro envio.
4. Consulte as métricas:

```powershell
Invoke-RestMethod http://127.0.0.1:8080/actuator/metrics/ai.dev.assistant.prompts
Invoke-RestMethod http://127.0.0.1:8080/actuator/metrics/ai.dev.assistant.ai.calls
Invoke-RestMethod http://127.0.0.1:8080/actuator/metrics/ai.dev.assistant.ai.calls.avoided
Invoke-RestMethod http://127.0.0.1:8080/actuator/metrics/ai.dev.assistant.tokens.saved.estimated
```

Depois desse roteiro, deve existir uma chamada realizada e pelo menos uma chamada
evitada. Tokens contados pelo modelo e economia estimada são métricas diferentes.

Chamadas reais ao Copilot não fazem parte da suíte automatizada porque consomem quota,
dependem de consentimento e produzem respostas não determinísticas.

## Cenários de indisponibilidade

- Backend parado: a extensão informa que não conseguiu conectar ao backend local e não
  chama o Copilot.
- Modelo de embedding ausente ou inválido: o backend não inicia com o provider habilitado
  ou responde com falha fechada; não existe fallback externo.
- Memória local indisponível: o backend devolve `MEMORY_UNAVAILABLE` e a extensão informa
  que a IA não foi chamada.
- Copilot sem consentimento, licença, quota ou modelo permitido: a extensão informa a
  indisponibilidade e não tenta outro fornecedor.
- Autorização expirada: a conclusão é recusada e o usuário deve reenviar a solicitação.
- Resposta ou contrato acima dos limites: a extensão interrompe o fluxo sem apresentar
  conteúdo bruto do backend ou do provider.

## Testes automatizados

Backend:

```powershell
cd backend
.\mvnw.cmd clean verify
```

Extensão:

```powershell
cd vscode-extension
npm test
```

O teste ponta a ponta do backend usa embedding determinístico e memória Lucene temporária.
Ele executa preparação REST, conclusão externa simulada, persistência, reutilização
`FULL` e validação das métricas, sem rede e sem consumir Copilot.

## Gerar e instalar o VSIX

```powershell
cd vscode-extension
npm run package:vsix
code --install-extension .\ai-dev-assistant-0.1.0.vsix
```

O VSIX é um artefato local ignorado pelo Git. Esta fase não publica a extensão no
Marketplace e não exige token de publisher.
