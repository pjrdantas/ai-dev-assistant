# Contrato REST inicial do MVP

## 1. Objetivo

Definir o contrato entre a extensão VS Code e o backend sem acoplar o cliente a MongoDB ou a qualquer provider de IA.

O contrato está implementado no backend e é consumido pela extensão. Ajustes
incompatíveis antes da primeira versão pública continuam permitidos, desde que
documentados e atualizados nos dois módulos.

## 2. Endpoint de preparação

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

Na Fase 10, a extensão preenche somente `languages`, `frameworks` e `buildTool`, extraídos
de `pom.xml` e `package.json` permitidos. `projectId`, Git, caminhos e conteúdo dos
arquivos não são enviados. O backend ignora campos desconhecidos e converte os metadados
aceitos em `TechnicalContext`.

## 4. Resposta local

```http
200 OK
Content-Type: application/json
```

```json
{
  "requestId": "uuid",
  "status": "COMPLETED",
  "response": "...",
  "source": "LOCAL_MEMORY",
  "matchType": "FULL",
  "similarity": 0.96,
  "aiCalled": false,
  "externalSearchCalled": false,
  "memoryId": "uuid"
}
```

Essa resposta ocorre quando a memória resolve a solicitação como `FULL`.

## 5. Solicitação de IA necessária

```http
202 Accepted
Content-Type: application/json
```

```json
{
  "requestId": "uuid",
  "status": "AI_REQUIRED",
  "matchType": "PARTIAL",
  "similarity": 0.82,
  "expiresAt": "2026-09-10T15:05:00Z",
  "aiRequest": {
    "prompt": "...",
    "technicalContext": {},
    "reusableSolution": "...",
    "requiredAdaptations": ["..."]
  }
}
```

O backend somente poderá emitir `AI_REQUIRED` depois de concluir a consulta local. Em
`NONE`, `similarity`, `reusableSolution` e `requiredAdaptations` serão ausentes ou vazios.

## 6. Endpoint de conclusão da IA

```http
POST /api/v1/prompts/{requestId}/ai-response
Content-Type: application/json
```

```json
{
  "response": "Resposta produzida pelo modelo Copilot autorizado no VS Code.",
  "executionMetrics": {
    "inputTokens": 120,
    "outputTokens": 45,
    "durationMs": 900
  }
}
```

A extensão chamará esse endpoint depois de consumir `vscode.lm`. O backend validará se
o identificador corresponde a uma preparação pendente e não expirada, persistirá a
solução e somente então devolverá `200 OK` com o contrato de resposta final. Repetir a
mesma conclusão é idempotente; tentar concluir com conteúdo diferente será recusado.
`executionMetrics` será opcional. Na Fase 10, a extensão contará entrada e saída com
`LanguageModelChat.countTokens` e medirá a duração da execução. Esses valores não serão
interpretados como consumo faturado pelo provider e a ausência deles não será preenchida
com estimativas.

### Valores de `source` na resposta final

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
- `AI_REQUIRED` não significa que a IA já foi chamada;
- somente o adapter Copilot da extensão poderá consumir a solicitação autorizada;
- uma conclusão sem preparação válida nunca será persistida.

## 7. Erros

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
| 422 | `AI_INVOCATION_REJECTED` | Autorização excede limites ou não pode ser criada com segurança |
| 503 | `MEMORY_UNAVAILABLE` | Consulta obrigatória à memória não foi concluída |
| 409 | `AI_INVOCATION_MISMATCH` | A conclusão diverge de uma conclusão anterior |
| 410 | `AI_INVOCATION_EXPIRED` | A preparação não existe mais ou expirou |
| 503 | `MEMORY_PERSISTENCE_FAILURE` | Solução externa não pôde ser persistida com segurança |

Mensagens de erro não devem incluir prompt, API key, token, senha, stack trace ou resposta bruta do provider.

Erros de consentimento, licença, quota, indisponibilidade de modelo ou falha do Copilot
ocorrem na extensão e não autorizam fallback para outro provider.

## 8. Endpoints operacionais

Health checks e a lista de métricas são expostos localmente por `/actuator/health` e
`/actuator/metrics`. Eles não fazem parte do contrato funcional entre a extensão e o
assistente. O catálogo está em `docs/observability.md`.

## 9. Itens adiados

- streaming de resposta;
- cancelamento;
- anexos e seleção de arquivos;
- histórico de conversa;
- feedback;
- edição automática;
- pesquisa externa;
- autenticação e multiusuário.
