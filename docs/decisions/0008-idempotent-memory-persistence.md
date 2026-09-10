# ADR 0008 — Persistência idempotente da memória

- Status: aceita
- Data: 2026-09-09

## Contexto

Repetições da mesma operação não podem criar documentos idênticos, inclusive sob concorrência. Ao mesmo tempo, um mesmo prompt poderá ter soluções diferentes para contextos técnicos distintos, portanto o hash do prompt não pode ser a única chave exclusiva.

## Decisão

A versão inicial da chave de deduplicação combinará:

```text
v1:{hash do prompt}:{SHA-256 da solução}
```

Um índice único protegerá essa chave. A gravação será realizada por upsert atômico, de forma que a primeira inserção prevaleça e tentativas equivalentes retornem o conhecimento existente.

A busca exata retornará todos os candidatos ativos com o mesmo hash e versão de normalização. A aplicação avaliará a compatibilidade desses candidatos em uma fase posterior.

O registro de reutilização também será atômico, incrementando o contador e atualizando as datas em uma única operação.

## Consequências

- repetições exatas não criam documentos duplicados;
- soluções diferentes para o mesmo prompt podem coexistir;
- diferenças no texto da solução, inclusive espaços, produzem chaves distintas;
- deduplicação semântica e contexto técnico serão evoluções posteriores;
- o identificador e as datas da primeira inserção são preservados em novas tentativas equivalentes.
