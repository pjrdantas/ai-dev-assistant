# Contrato REST inicial do MVP

## 1. Objetivo

Definir o contrato entre a extensão VS Code e o backend sem acoplar o cliente a MongoDB ou a qualquer provider de IA.

O contrato ainda não representa uma implementação. Ajustes incompatíveis antes da primeira versão pública são permitidos, desde que documentados.

## 2. Endpoint principal

```http
POST /api/v1/prompts
Content-Type: application/json
```

## 3. Requisição

```json
{
  "prompt": "Crie um endpoint Java para buscar cliente por CPF.",
  "projectContext": {
    "projectId": "project-fingerprint",
    "languages": [
      {
        "name": "JAVA",
        "version": "21"
      }
    ],
    "frameworks": [
      {
        "name": "SPRING_BOOT",
        "version": "3"
      }
    ],
    "buildTool": "MAVEN",
    "git": {
      "branch": "feature/example",
      "commit": "commit-hash"
    }
  }
}
```

### Regras

- `prompt` é obrigatório, não pode ser vazio e terá tamanho máximo configurável.
- `projectContext` é opcional no primeiro MVP.
- o contexto deve conter dados estruturados, não arquivos completos;
- `projectId` não deve ser um caminho absoluto;
- campos desconhecidos não devem provocar execução ou leitura automática de recursos locais;
- conteúdo sensível deverá ser rejeitado ou sanitizado antes de integrações externas.

## 4. Resposta de sucesso

```http
200 OK
Content-Type: application/json
```

```json
{
  "requestId": "uuid",
  "response": "...",
  "source": "LOCAL_MEMORY",
  "matchType": "FULL",
  "similarity": 0.96,
  "aiCalled": false,
  "externalSearchCalled": false,
  "memoryId": "uuid"
}
```

### Valores de `source`

```text
LOCAL_MEMORY
LOCAL_MEMORY_AND_AI
AI
```

### Valores de `matchType`

```text
FULL
PARTIAL
NONE
```

### Invariantes

- `LOCAL_MEMORY` implica `aiCalled=false`;
- `FULL` implica resposta proveniente da memória local e nenhuma IA externa;
- `LOCAL_MEMORY_AND_AI` implica `matchType=PARTIAL` e `aiCalled=true`;
- `AI` implica `matchType=NONE` e `aiCalled=true`;
- `externalSearchCalled` será sempre `false` no primeiro MVP;
- `similarity` poderá ser `null` em `NONE`;
- nenhum segredo, configuração interna ou caminho absoluto poderá ser devolvido.

## 5. Erros

Formato inicial baseado em Problem Details:

```json
{
  "type": "about:blank",
  "title": "Memória local indisponível",
  "status": 503,
  "detail": "A solicitação não pôde ser processada porque a consulta obrigatória à memória falhou.",
  "instance": "/api/v1/prompts",
  "requestId": "uuid",
  "code": "MEMORY_UNAVAILABLE"
}
```

Erros iniciais:

| Status | Código | Situação |
|---|---|---|
| 400 | `INVALID_PROMPT` | Prompt ausente, vazio ou acima do limite |
| 400 | `INVALID_PROJECT_CONTEXT` | Contexto malformado ou não permitido |
| 422 | `SENSITIVE_CONTEXT_REJECTED` | Conteúdo não pode ser enviado com segurança |
| 503 | `MEMORY_UNAVAILABLE` | Consulta obrigatória à memória não foi concluída |
| 502 | `AI_PROVIDER_FAILURE` | Provider falhou após uma consulta de memória válida |
| 503 | `MEMORY_PERSISTENCE_FAILURE` | Solução externa não pôde ser persistida com segurança |

Mensagens de erro não devem incluir prompt, API key, token, senha, stack trace ou resposta bruta do provider.

## 6. Endpoints operacionais

Health checks e métricas serão expostos posteriormente pelos recursos operacionais do Spring Boot. Eles não fazem parte do contrato funcional entre a extensão e o assistente.

## 7. Itens adiados

- streaming de resposta;
- cancelamento;
- anexos e seleção de arquivos;
- histórico de conversa;
- feedback;
- edição automática;
- pesquisa externa;
- autenticação e multiusuário.
