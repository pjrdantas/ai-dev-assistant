# Regras do projeto para o Codex

Antes de qualquer atividade, descreva objetivamente o que será analisado ou alterado.
Antes de planejar ou mudar o projeto, consulte `docs/product-specification.md`,
`docs/architecture.md`, `docs/roadmap.md` e os ADRs aplicáveis. Trabalhe de forma
incremental, sem código desnecessário, e analise o impacto antes de mudanças grandes.
Nunca coloque API keys, tokens, senhas ou segredos no código, documentação ou memória.
Crie ou atualize testes ao implementar ou alterar regra de negócio.

## Arquitetura obrigatória

O produto é um único VSIX com um Custom Agent nativo do GitHub Copilot e memória local.
O GitHub Copilot, por meio do model picker nativo, é a única IA do produto.

### Nunca

- Adicionar WebView de chat, Activity Bar própria ou seletor próprio de LLM.
- Adicionar backend, Java, Spring, REST, MongoDB Atlas, Lucene, Docker ou outro daemon
  além do MongoDB local definido na ADR 0002 como requisito.
- Fixar `model:` no arquivo `.agent.md`.
- Declarar `tools:` de modo a restringir o agente às tools de memória.
- Substituir as tools nativas do Copilot pelas tools `searchMemory` e `saveMemory`.
- Alterar a arquitetura sem justificativa documentada em ADR.

### Sempre

- Preservar pesquisa e descoberta em todo o workspace, leitura de arquivos fechados,
  edição multiarquivo, terminal, build e testes conforme as permissões nativas.
- Preservar o model picker nativo do Copilot e o único VSIX como produto final.
- Manter ONNX lazy: não carregar `onnxruntime-web` nem gerar embedding antes de um exact
  miss; reutilizar a inicialização e a única `InferenceSession` compartilhada.
- Manter `searchMemory` e `saveMemory` como ferramentas
  complementares, locais e sem acesso à internet ou outro LLM.

## Regra central

Toda solicitação técnica tratada pelo AI Dev Assistant deve consultar primeiro a memória
local antes de produzir uma nova solução técnica dentro do agent loop. Isso fornece
contexto complementar e não impede o Copilot de pesquisar, ler, editar ou validar o
workspace com suas ferramentas nativas.
