# AI Dev Assistant

Assistente de desenvolvimento integrado ao VS Code que consulta uma memória local antes de utilizar uma IA externa, visando reutilização de conhecimento e economia de tokens.

## Estrutura do projeto

- `backend`: backend em Java 21 com Spring Boot.
- `vscode-extension`: extensão do VS Code em TypeScript.
- `docker`: diretório reservado da estrutura inicial; o produto não utiliza containers.
- `docs`: documentação técnica, arquitetura e decisões do projeto.
- `scripts`: scripts auxiliares de desenvolvimento.

## Estado atual

As Fases 1 a 6A contêm a fundação do backend, o núcleo de domínio, embeddings ONNX, busca exata e semântica, compatibilidade técnica e classificação `FULL`, `PARTIAL` e `NONE`.

A memória final usa Apache Lucene embutido no processo Java. MongoDB, mongot, Testcontainers e Docker foram removidos do backend e não são necessários para executar ou testar o produto.

## Requisitos locais

- Java 21.

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

Na raiz do projeto:

```powershell
cd backend
.\mvnw.cmd spring-boot:run
```

Endpoints operacionais:

- health check: `http://localhost:8080/actuator/health`;
- OpenAPI: `http://localhost:8080/v3/api-docs`;
- Swagger UI: `http://localhost:8080/swagger-ui.html`.

## Testes do backend

Toda a suíte executa com Java e Maven, sem Docker ou serviço de banco de dados externo.

```powershell
cd backend
.\mvnw.cmd verify
```
