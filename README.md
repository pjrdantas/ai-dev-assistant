# AI Dev Assistant

Assistente de desenvolvimento integrado ao VS Code que consulta uma memória local antes de utilizar uma IA externa, visando reutilização de conhecimento e economia de tokens.

## Estrutura do projeto

- `backend`: backend em Java 21 com Spring Boot.
- `vscode-extension`: extensão do VS Code em TypeScript.
- `docker`: diretório reservado da estrutura inicial; o produto não utiliza containers.
- `docs`: documentação técnica, arquitetura e decisões do projeto.
- `scripts`: scripts auxiliares de desenvolvimento.

## Estado atual

As Fases 1 a 11 estão concluídas e contêm a fundação do backend,
o núcleo de domínio, embeddings ONNX,
busca exata e semântica, compatibilidade técnica, classificação `FULL`, `PARTIAL` e
`NONE`, a orquestração obrigatória memory-first em duas etapas e a observabilidade
local com Micrometer, o contrato REST e a extensão funcional do VS Code.

A memória final usa Apache Lucene embutido no processo Java. MongoDB, mongot, Testcontainers e Docker foram removidos do backend e não são necessários para executar ou testar o produto.

O `PromptOrchestrator` responde somente com a memória em `FULL`, usa uma única solução
local selecionada como contexto para complemento em `PARTIAL` e solicita uma resposta
externa em `NONE`. Qualquer falha durante a consulta local impede a chamada externa.
Em `PARTIAL` e `NONE`, o backend prepara uma solicitação temporária somente depois da
consulta local. A extensão chama o GitHub Copilot Enterprise pela Language Model API do
VS Code e devolve a resposta ao backend para persistência. Somente o
`CopilotLanguageModelGateway` acessa `vscode.lm`; a view depende do coordenador.

## Requisitos locais

- Java 21;
- Node.js 22 para desenvolver a extensão;
- VS Code 1.137 ou superior;
- GitHub Copilot Enterprise disponível no VS Code para respostas externas.

O Maven não precisa estar instalado globalmente porque o backend inclui o Maven Wrapper.

## Preparar o modelo de embedding

Na raiz do projeto, baixe explicitamente os artefatos fixados e verifique seus checksums:

```powershell
.\scripts\embedding-model.ps1 prepare
```

Os binários ficam em `backend/models` e não são versionados no Git. Para ativar o provider, execute o backend a partir da pasta `backend` com `EMBEDDING_LOCAL_ENABLED=true`. Se os artefatos estiverem ausentes ou divergirem dos checksums esperados, a inicialização falhará sem tentar download automático.

Os resultados e comandos da prova técnica estão em `docs/embedding-benchmark.md`.

## Memória local e busca semântica

Na inicialização, o backend cria ou abre um índice Lucene no diretório configurado. O schema e a dimensão vetorial são validados antes de o repositório ficar disponível.

Parâmetros externos disponíveis:

- `AI_DEV_ASSISTANT_MEMORY_DIRECTORY` (padrão `%USERPROFILE%\.ai-dev-assistant\memory` no Windows);
- `MEMORY_VECTOR_DIMENSION` (padrão `384`);
- `MEMORY_SEMANTIC_TOP_K` (padrão `5`).

O dataset e os limites desta validação estão descritos em `docs/semantic-search-evaluation.md`.

## Classificação

Parâmetros externos iniciais:

- `MEMORY_FULL_THRESHOLD` (padrão `0.90`);
- `MEMORY_PARTIAL_THRESHOLD` (padrão `0.70`);
- `MEMORY_MAXIMUM_FULL_AGE` (padrão `180d`).

A calibração e suas limitações estão documentadas em `docs/classification-calibration.md`.

## Executar o backend

O produto não utiliza API key própria de IA. Na fase da extensão, o acesso será feito
pelo usuário autenticado no GitHub Copilot Enterprise dentro do VS Code, sujeito a
consentimento, licença, quota e políticas da organização.

Na raiz do projeto:

```powershell
cd backend
$env:EMBEDDING_LOCAL_ENABLED="true"
.\mvnw.cmd spring-boot:run
```

Endpoints operacionais:

- health check: `http://localhost:8080/actuator/health`;
- métricas: `http://localhost:8080/actuator/metrics`;
- OpenAPI: `http://localhost:8080/v3/api-docs`;
- Swagger UI: `http://localhost:8080/swagger-ui.html`.

Endpoints funcionais:

- preparação: `POST http://localhost:8080/api/v1/prompts`;
- conclusão externa: `POST http://localhost:8080/api/v1/prompts/{requestId}/ai-response`.

## Executar a extensão

```powershell
cd vscode-extension
npm install
npm test
```

Abra a raiz do projeto no VS Code e pressione `F5`. A view `AI Dev Assistant` aparecerá
na Activity Bar. A extensão aceita somente um backend HTTP em localhost, lê apenas
`pom.xml` e `package.json` com limite de tamanho e envia somente tecnologias e versões.

O roteiro completo de execução, validação do Copilot Enterprise, falhas controladas,
métricas e empacotamento está em [`docs/operations.md`](docs/operations.md).

Para gerar o pacote instalável local:

```powershell
cd vscode-extension
npm run package:vsix
```

## Testes do backend

Toda a suíte executa com Java e Maven, sem Docker ou serviço de banco de dados externo.

```powershell
cd backend
.\mvnw.cmd verify
```
