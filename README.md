# AI Dev Assistant

Assistente de desenvolvimento integrado ao VS Code que consulta uma memória local antes de utilizar uma IA externa, visando reutilização de conhecimento e economia de tokens.

## Estrutura do projeto

- `backend`: backend em Java 21 com Spring Boot.
- `vscode-extension`: extensão do VS Code em TypeScript.
- `docker`: arquivos auxiliares relacionados aos containers.
- `docs`: documentação técnica, arquitetura e decisões do projeto.
- `scripts`: scripts auxiliares de desenvolvimento.

## Estado atual

As Fases 1 a 5 contêm a fundação executável do backend, o núcleo de domínio, a persistência MongoDB da memória, o adapter de embeddings ONNX locais e a busca semântica. Busca exata, deduplicação idempotente, registro de reutilização, persistência de embeddings e `$vectorSearch` com índice verificado estão implementados. Classificação, compatibilidade, orquestração e integração com IA ainda não foram implementadas.

## Requisitos locais

- Java 21;
- Docker com Docker Compose.

O Maven não precisa estar instalado globalmente porque o backend inclui o Maven Wrapper.

## Preparar o modelo de embedding

Na raiz do projeto, baixe explicitamente os artefatos fixados e verifique seus checksums:

```powershell
.\scripts\embedding-model.ps1 prepare
```

Os binários ficam em `backend/models` e não são versionados no Git. Para ativar o provider, execute o backend a partir da pasta `backend` com `EMBEDDING_LOCAL_ENABLED=true`. Se os artefatos estiverem ausentes ou divergirem dos checksums esperados, a inicialização falhará sem tentar download automático.

Os resultados e comandos da prova técnica estão em `docs/embedding-benchmark.md`.

## Busca semântica

Na inicialização, o backend cria o índice vetorial quando necessário e aguarda seu estado `READY`. A execução é interrompida se o índice não ficar consultável dentro do prazo configurado.

Parâmetros externos disponíveis:

- `MEMORY_SEMANTIC_INDEX_NAME` (padrão `semantic_vector_idx`);
- `MEMORY_SEMANTIC_DIMENSION` (padrão `384`);
- `MEMORY_SEMANTIC_TOP_K` (padrão `5`);
- `MEMORY_SEMANTIC_NUM_CANDIDATES` (padrão `100`);
- `MEMORY_SEMANTIC_INDEX_TIMEOUT` (padrão `90s`);
- `MEMORY_SEMANTIC_INDEX_POLL_INTERVAL` (padrão `250ms`).

O dataset e os limites desta validação estão descritos em `docs/semantic-search-evaluation.md`.

## Executar o ambiente local

Na raiz do projeto, inicie o MongoDB local:

```powershell
docker compose up -d mongodb
```

Em outro terminal, inicie o backend:

```powershell
cd backend
.\mvnw.cmd spring-boot:run
```

Endpoints operacionais:

- health check: `http://localhost:8080/actuator/health`;
- OpenAPI: `http://localhost:8080/v3/api-docs`;
- Swagger UI: `http://localhost:8080/swagger-ui.html`.

## Testes do backend

Os testes de integração iniciam um MongoDB Atlas Local temporário e exigem que o Docker esteja disponível.

```powershell
cd backend
.\mvnw.cmd verify
```
