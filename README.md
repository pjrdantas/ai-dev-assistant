# AI Dev Assistant

Assistente de desenvolvimento integrado ao VS Code que consulta uma memória local antes de utilizar uma IA externa, visando reutilização de conhecimento e economia de tokens.

## Estrutura do projeto

- `backend`: backend em Java 21 com Spring Boot.
- `vscode-extension`: extensão do VS Code em TypeScript.
- `docker`: arquivos auxiliares relacionados aos containers.
- `docs`: documentação técnica, arquitetura e decisões do projeto.
- `scripts`: scripts auxiliares de desenvolvimento.

## Estado atual

As Fases 1 a 3 contêm a fundação executável do backend, o núcleo de domínio e a persistência MongoDB da memória. Busca exata, deduplicação idempotente, índices tradicionais e registro de reutilização estão implementados. Geração de embeddings, busca semântica, classificação, orquestração e integração com IA ainda não foram implementadas.

## Requisitos locais

- Java 21;
- Docker com Docker Compose.

O Maven não precisa estar instalado globalmente porque o backend inclui o Maven Wrapper.

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
