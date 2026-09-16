# Arquitetura — AI Dev Assistant

```text
VS Code
  -> GitHub Copilot Chat
      -> model picker nativo
          -> AI Dev Assistant (Custom Agent contribuído pelo VSIX)
              -> tools nativas do Copilot Agent
                 (workspace search, code search, leitura, edição, terminal, build, testes)
              -> searchMemory
              -> saveMemory
```

## Custom Agent

O manifesto contribui `contributes.chatAgents` para o arquivo
`agents/ai-dev-assistant.agent.md`. O frontmatter deliberadamente não define `model`:
o model picker nativo mantém a escolha do usuário. Também não define `tools`: essa
omissão evita restringir as ferramentas padrão do Copilot Agent. As ferramentas de
memória são contribuições adicionais da extensão, não uma substituição das ferramentas
nativas.

O agente pode descobrir arquivos em todo o workspace, inclusive os que não estão
abertos. Ele usa ferramentas para pesquisar, ler e editar somente os arquivos relevantes;
isso não implica que o modelo recebe todos os arquivos de uma vez.

## Extensão e memória

Na ativação, a extensão registra `ai-dev-assistant_searchMemory` e
`ai-dev-assistant_saveMemory` com `vscode.lm.registerTool`. A memória ativa é persistida
no MongoDB local pelo driver oficial Node.js, com um único cliente lazy por Extension Host.

O manifesto torna ambas referenciáveis e o Custom Agent usa a sintaxe oficial
`#tool:searchMemory` e `#tool:saveMemory` no corpo de suas
instruções. Não há `model:` ou `tools:` no frontmatter: o primeiro preserva o model picker
nativo e o segundo evita restringir as ferramentas nativas.

O agent loop instrui explicitamente `searchMemory` antes de cada nova solução técnica e,
quando houver solução reutilizável, `saveMemory` antes da resposta final. Essa é uma
orquestração declarativa do Custom Agent: a comprovação de sua aderência em uma conversa
real requer teste manual no VS Code com Copilot autenticado.

`searchMemory` normaliza local e deterministicamente a solicitação, obtém o contexto técnico permitido do workspace
e procura um hit exato. Somente na ausência de hit exato ela carrega tokenizer e modelo
MiniLM empacotados, verifica os checksums e executa ONNX/WebAssembly para busca
semântica. `FULL` requer compatibilidade de contexto; `PARTIAL` pode trazer contexto
incompatível explicitamente para adaptação. Falhas locais são retornadas pela tool e não
habilitam um provider alternativo.

`saveMemory` recebe a solicitação original do usuário, sem resumo ou reformulação, pede
confirmação, bloqueia conteúdo potencialmente sensível e persiste uma solução reutilizável.
A extensão gera a chave `normalizedPrompt` localmente com normalização Unicode NFKC,
espaços normalizados e minúsculas; conteúdo técnico não é removido. Nenhuma tool seleciona modelo, chama LLM, usa internet ou depende
de backend, banco, Docker ou daemon.

## Histórico, hooks e promoção

`UserPromptSubmit`, quando o AI Dev Assistant está ativo, grava uma interaction PENDING
com `originalRequest` literal. O hook passivo `Stop` tenta extrair apenas a resposta final
por um adapter isolado; a interaction passa para COMPLETED ou RESPONSE_UNAVAILABLE sem
persistir o transcript bruto. Antes de uma busca de memória, uma fila local limitada de
interactions COMPLETED pode promovê-las para `memories` por critérios técnicos locais.
Essa promoção não chama outro LLM e reutiliza exact-first, ONNX lazy e deduplicação.

## Legado JSON e durabilidade

`knowledge-v1.json` é exclusivamente uma fonte histórica para migração; MongoDB é o
store ativo. O arquivo JSON legado usa `schemaVersion: 2`, `originalRequest`, `normalizedPrompt` e
`revision`. `originalRequest` preserva a solicitação técnica real; `normalizedPrompt` é
somente a chave determinística de exact match. A leitura de `schemaVersion: 1` preserva
cada registro e usa o `normalizedPrompt` antigo como fallback de `originalRequest`; a
próxima escrita o persiste em schema 2. Escritas usam arquivo temporário e
rename atômico, protegidas por lock file para evitar lost update entre janelas do VS Code.
JSON inválido é renomeado como backup datado próprio antes de iniciar memória vazia; a
retenção conserva somente os cinco backups próprios mais recentes. Locks ativos aguardam
por tempo finito; somente locks comprovadamente obsoletos por `mtime` podem ser removidos.
Arquivos temporários abandonados não são lidos como memória. Entradas podem ser substituídas,
invalidadas, excluídas ou limpas; invalidadas não participam da busca.
No save, correspondência exata evita ONNX; após exact miss, deduplicação semântica usa o
mesmo embedding e só mescla candidatos compatíveis a partir de 0,85. O valor foi
calibrado com as duas formulações reais sobre `pom.xml` (similaridade 0,850090208950) e
permanece mais rigoroso que o limiar PARTIAL de 0,70. Um diagnostic sink opcional, usado
em desenvolvimento e testes, expõe candidato, similaridade, compatibilidade, classificação
e motivo sem ampliar a resposta normal da tool.

## Fronteiras

O VSIX contém JavaScript compilado, a definição do agente, os assets do modelo, os avisos
de terceiros e apenas as dependências de runtime necessárias para tokenizer e ONNX.
TypeScript, testes, mapas de fonte e documentação de desenvolvimento não fazem parte da
distribuição.
