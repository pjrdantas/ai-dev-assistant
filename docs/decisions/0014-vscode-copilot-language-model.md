# ADR 0014 — GitHub Copilot Enterprise pela Language Model API do VS Code

- Status: aceita e implementada
- Data: 2026-09-10
- Complementa: ADR 0002

## Contexto

A IA externa será consumida pela licença GitHub Copilot Enterprise do usuário. O produto
não terá uma chave própria de OpenAI ou de outro fornecedor. A Language Model API existe
no processo da extensão do VS Code, exige uma ação iniciada pelo usuário e pode solicitar
consentimento antes de permitir o uso dos modelos do Copilot.

Como o backend Java não pode chamar essa API, a orquestração precisa atravessar dois
processos sem permitir que a extensão contorne a consulta obrigatória à memória local.

## Decisão

O backend executará a preparação da solicitação:

1. normaliza o prompt e conclui as buscas exata e semântica;
2. avalia compatibilidade e classifica `FULL`, `PARTIAL` ou `NONE`;
3. devolve imediatamente a resposta local em `FULL`;
4. em `PARTIAL` ou `NONE`, cria uma solicitação externa temporária somente após o
   pipeline local terminar;
5. bloqueia padrões de credenciais e aplica o limite de contexto antes de liberar a
   solicitação para a extensão.

A extensão terá um adapter TypeScript dedicado para `vscode.lm`. A interface visual não
chamará o modelo diretamente. O adapter selecionará somente modelos com
`vendor: "copilot"`, respeitará consentimento, licença, quota e políticas do Enterprise,
e não habilitará ferramentas, comandos, pesquisa ou envio automático de arquivos.

Depois de receber a resposta do Copilot, a extensão a devolverá ao backend junto com o
identificador temporário. O backend aceitará a conclusão apenas se encontrar a preparação
correspondente e não expirada. Só então persistirá a solução e produzirá a resposta final.
Reenvios com o mesmo identificador e o mesmo conteúdo serão idempotentes; conteúdo
divergente, identificador desconhecido ou expirado será recusado.

As preparações pendentes são estado efêmero do processo e possuem validade limitada.
Uma reinicialização do backend invalida solicitações ainda não concluídas. Essa escolha é
adequada ao MVP local e evita persistir prompts apenas para coordenar uma chamada curta.

O backend não terá `AiProvider`, cliente HTTP de IA, API key ou dependência do SDK de um
fornecedor. O adapter `CopilotLanguageModelGateway` seleciona modelos somente com
`vendor: "copilot"`, tenta primeiro a família opcional configurada, trata ausência de
modelo sem fallback de provider e consome a resposta em streaming antes de concluir a
autorização no backend.

A view não acessa `vscode.lm`. O `PromptCoordinator` captura contexto local permitido,
consulta o backend e chama o gateway apenas quando recebe `AI_REQUIRED` ainda válido.
Tokens são contados com o tokenizer do modelo e a duração é medida na extensão.

## Consequências

- o usuário utiliza sua licença e as políticas do GitHub Copilot Enterprise;
- o backend continua sendo a autoridade da regra memory-first;
- a extensão e o backend precisam de um contrato REST em duas etapas;
- a IA fica indisponível sem consentimento, seat, quota ou modelo permitido;
- não existe fallback automático para OpenAI ou outro provider;
- o modelo não pode ser fixado como se sua disponibilidade fosse permanente;
- chamadas reais não devem fazer parte dos testes automatizados da extensão.

## Referências

- [Language Model API](https://code.visualstudio.com/api/extension-guides/ai/language-model)
- [VS Code API — LanguageModelChat](https://code.visualstudio.com/api/references/vscode-api#LanguageModelChat)
- [Administração do Copilot CLI e modelos Enterprise](https://docs.github.com/en/copilot/how-tos/copilot-cli/administer-copilot-cli-for-your-enterprise)
