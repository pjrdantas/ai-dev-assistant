# AI Dev Assistant

Assistente de desenvolvimento integrado ao VS Code que consulta uma memória local antes de utilizar uma IA externa, visando reutilização de conhecimento e economia de tokens.

## Estrutura do projeto

- `backend`: backend em Java 21 com Spring Boot.
- `vscode-extension`: extensão do VS Code em TypeScript.
- `docker`: arquivos auxiliares relacionados aos containers.
- `docs`: documentação técnica, arquitetura e decisões do projeto.
- `scripts`: scripts auxiliares de desenvolvimento.

## Estado atual

As Fases 1 a 6 contêm a fundação do backend, o núcleo de domínio, a prova de persistência MongoDB, embeddings ONNX, busca semântica, compatibilidade técnica e classificação `FULL`, `PARTIAL` e `NONE`.

O produto final não dependerá de Docker. O adapter MongoDB/mongot da Fase 5 permanece apenas como prova técnica; a Fase 6A substituirá esse caminho por persistência e busca vetorial embutidas antes da orquestração.

## Requisitos locais

- Java 21.

O Maven não precisa estar instalado globalmente porque o backend inclui o Maven Wrapper.

Docker é usado temporariamente por testes legados do adapter MongoDB, mas não é requisito nem componente permitido no runtime final.

## Preparar o modelo de embedding

Na raiz do projeto, baixe explicitamente os artefatos fixados e verifique seus checksums:

```powershell
.\scripts\embedding-model.ps1 prepare
```

Os binários ficam em `backend/models` e não são versionados no Git. Para ativar o provider, execute o backend a partir da pasta `backend` com `EMBEDDING_LOCAL_ENABLED=true`. Se os artefatos estiverem ausentes ou divergirem dos checksums esperados, a inicialização falhará sem tentar download automático.

Os resultados e comandos da prova técnica estão em `docs/embedding-benchmark.md`.

## Busca semântica — prova MongoDB de desenvolvimento

Na inicialização, o backend cria o índice vetorial quando necessário e aguarda seu estado `READY`. A execução é interrompida se o índice não ficar consultável dentro do prazo configurado.

Parâmetros externos disponíveis:

- `MEMORY_SEMANTIC_INDEX_NAME` (padrão `semantic_vector_idx`);
- `MEMORY_SEMANTIC_DIMENSION` (padrão `384`);
- `MEMORY_SEMANTIC_TOP_K` (padrão `5`);
- `MEMORY_SEMANTIC_NUM_CANDIDATES` (padrão `100`);
- `MEMORY_SEMANTIC_INDEX_TIMEOUT` (padrão `90s`);
- `MEMORY_SEMANTIC_INDEX_POLL_INTERVAL` (padrão `250ms`).

O dataset e os limites desta validação estão descritos em `docs/semantic-search-evaluation.md`.

## Classificação

Parâmetros externos iniciais:

- `MEMORY_FULL_THRESHOLD` (padrão `0.90`);
- `MEMORY_PARTIAL_THRESHOLD` (padrão `0.70`);
- `MEMORY_MAXIMUM_FULL_AGE` (padrão `180d`).

A calibração e suas limitações estão documentadas em `docs/classification-calibration.md`.

## Executar a prova MongoDB de desenvolvimento

Os comandos abaixo existem apenas enquanto o adapter embutido da Fase 6A não foi concluído. Eles não representam o modo de execução do produto final.

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

Os testes unitários de domínio não exigem Docker. A suíte completa ainda inclui temporariamente os testes de integração da prova MongoDB e, por isso, exige Docker até a conclusão da Fase 6A.

```powershell
cd backend
.\mvnw.cmd verify
```
