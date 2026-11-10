# Operação e validação manual

## Pré-requisitos

Instale VS Code compatível, o VSIX, MongoDB local e use uma conta com GitHub Copilot
disponível. Não instale Java, backend, Docker ou daemon do AI Dev Assistant. MongoDB não
é empacotado no VSIX; o padrão é `mongodb://127.0.0.1:27017`, database `ai_dev_assistant`.

## Roteiro manual de cenário real

1. Para a release publicada, instale `ai-dev-assistant-0.1.14.vsix` com
   `code --install-extension`.
2. Abra Copilot Chat e confirme **AI Dev Assistant** no seletor de Agents.
3. Selecione o agente, abra o model picker e alterne entre modelos Copilot disponíveis.
   O agente deve continuar selecionado; não existe seletor de modelo do plugin.
4. **Cenário A — arquivo fechado:** abra um projeto Java, mantenha aberta somente uma
   classe e deixe `pom.xml` fechado. Pergunte: “Qual versão do Spring Boot está neste
   projeto?”. O agente deve localizar e ler o arquivo sem o usuário abri-lo.
5. **Cenário B — alteração e validação:** peça: “Atualize dependência XPTO e execute os
   testes.” O agente deve localizar o manifesto, editar os arquivos necessários e usar o
   terminal para executar os testes, sujeito às permissões normais do VS Code.
6. Peça para localizar os usos de uma interface no projeto e, depois, uma alteração que
   envolva manifesto, classe e teste. Confirme pesquisa e edição multiarquivo.
7. Peça para compilar e corrigir erros. Autorize as ferramentas usuais quando o VS Code
   solicitar; o Agent deve conseguir usar terminal, build e testes.
8. **Cenário C — modelo:** troque o modelo no model picker. **AI Dev Assistant** deve
   continuar selecionado e usar o novo modelo disponível.
9. **Cenário D — exact memory:** repita uma solicitação já salva. Confirme resultado
   `FULL` sem inicialização de ONNX.
10. **Cenário E — semantic memory:** faça solicitação semanticamente relacionada e
   confirme a inicialização lazy de ONNX somente nesse momento.
11. Salve uma solução reutilizável pela tool, feche e reabra o VS Code. Confirme que o
   agente aparece sem carregar ONNX e que a memória local persiste.
12. Confirme a presença do ícone nativo do AI Dev Assistant na Activity Bar, com sua
    TreeView de administração, e a ausência de WebView ou chat paralelo próprios.

## Confirmação das tools de memória

O VS Code pode solicitar confirmação antes de executar uma Language Model Tool de uma
extensão. Revise a invocação e seus dados antes de permitir; quando a interface oferecer
uma opção como **Always Allow**, ela controla a permissão no VS Code, não altera a
localidade das tools. `searchMemory` consulta somente armazenamento e embedding locais;
`saveMemory` salva somente no perfil local após a confirmação prevista pela extensão.
Nenhuma das duas chama internet ou outro LLM.

## Captura automática de interações e consentimento

`UserPromptSubmit` é declarado no frontmatter de
`vscode-extension/agents/ai-dev-assistant.agent.md`. Portanto, quando o runtime oferece
suporte a hooks agent-scoped, o VS Code executa a captura **somente** quando
o **AI Dev Assistant** está selecionado (ou é invocado como subagent). Não é usado
transcript, título de conversa, conteúdo do prompt ou `cwd` para determinar o agente.

Para habilitar, execute **AI Dev Assistant: Enable Automatic Interaction Capture** e
confirme o aviso. A extensão instala somente launchers privados para os hooks
agent-scoped; ela não força uma configuração Preview nem cria fallback global. A
disponibilidade efetiva depende da versão/build do VS Code, admissão do workspace,
políticas da organização e controles do runtime Copilot. Confirme o Session Target
Copilot e Agent Customizations no perfil descartável. Ela cria somente estes artefatos
privados:

```text
~/.copilot/ai-dev-assistant/run-interaction-hook.ps1   (Windows)
~/.copilot/ai-dev-assistant/run-interaction-hook.sh    (Linux/macOS)
~/.copilot/ai-dev-assistant/.ai-dev-assistant-managed
```

O runner permanece no VSIX instalado, em `out/src/interactionHookRunner.js`. Os
launchers usam o executável Node/Electron do Extension Host capturado durante a
habilitação; não dependem de `node` no `PATH`. Windows usa o launcher PowerShell; Linux
e macOS usam o launcher `sh`. Não é criado arquivo em `~/.copilot/hooks`, pois esse é
um escopo global de usuário e poderia capturar prompts de outros Agents.

Para desabilitar, execute **AI Dev Assistant: Disable Automatic Interaction Capture**.
O comando remove apenas os dois launchers e o marcador acima, e só os remove se o
marcador contiver o valor criado pelo próprio AI Dev Assistant. Hooks e arquivos de
outros produtos não são modificados. Ao habilitar ou desabilitar, a extensão também pode
remover o arquivo global legado `~/.copilot/hooks/ai-dev-assistant.json`, mas somente se
o conteúdo comprovar que ele executa `interactionHookRunner.js` do AI Dev Assistant.
O runtime Copilot compartilhado carrega hooks agent-scoped conforme a versão instalada,
admissão do workspace, políticas da organização e controles de desabilitação do runtime.
Não se deve presumir que uma configuração local antiga como `chat.useCustomAgentHooks`
controle o Copilot atual.

### Teste manual de escopo

1. Execute **AI Dev Assistant: Clear Interaction History**.
2. Selecione **AI Dev Assistant** e envie: `Responda apenas teste AI Dev Assistant`.
3. Execute **AI Dev Assistant: Show Interaction Statistics**. O esperado é **1** interação.
4. Troque para o Agent padrão do Copilot e envie uma mensagem curta.
5. Execute novamente **AI Dev Assistant: Show Interaction Statistics**. O total deve
   continuar em **1**. Se chegar a 2, a captura tem falha de escopo e não deve ser usada.

## Diagnóstico

Execute no diretório `vscode-extension`:

```powershell
npm ci
npm test
npm run compile
npm run package:vsix
npx vsce ls
node ..\scripts\verify-local-onnx.mjs
node ..\scripts\verify-dependencies.mjs
npm audit --omit=dev --audit-level=high
npm sbom --sbom-format cyclonedx > sbom.cdx.json
```

Um usuário **não precisa abrir `pom.xml` manualmente**. O Custom Agent preserva as
ferramentas nativas de busca e leitura de workspace do Copilot, que permitem descobrir e
ler arquivos fechados; o acesso continua sujeito às permissões normais do VS Code.

## Legado JSON

`knowledge-v1.json` e `FileLocalMemoryStore` permanecem exclusivamente para migração
histórica e seus testes de durabilidade. MongoDB é o store ativo.

## Parâmetros operacionais do legado JSON

Os valores abaixo são os defaults efetivamente definidos em `FileLocalMemoryStore`; não
representam recomendação nem configuração externa do usuário.

- `MAX_CORRUPTION_BACKUPS`: `5`. Após renomear uma memória inválida, o store mantém no
  máximo os cinco backups próprios mais recentes, ordenados por `mtime` decrescente e,
  em empate, por nome decrescente.
- stale lock: `30.000 ms`. Um arquivo `.lock` somente é removido após esse tempo desde
  seu `mtime`; um lock mais novo permanece intacto.
- timeout de aquisição: `1.000 ms`. Sem adquirir ou recuperar um lock obsoleto nesse
  prazo, a operação falha sem executar a escrita protegida.
- retry/backoff: intervalo fixo de `10 ms` entre tentativas enquanto não atinge o
  timeout. Não há backoff exponencial.

Para o arquivo principal `knowledge-v1.json`, os formatos gerados são:

```text
backup: knowledge-v1.corrupt.<YYYYMMDDTHHMMSSmmmZ>.<uuid>.json
lock:   knowledge-v1.json.lock
temp:   knowledge-v1.json.<uuid>.tmp
```

O padrão de retenção aceita somente backups próprios com timestamp UTC e UUID em
minúsculas hexadecimais; arquivos de nome parecido não são candidatos à remoção. Arquivos
temporários órfãos não são lidos como memória: somente o arquivo principal é interpretado
na leitura.

## Métricas de reutilização e tokens (AUD-13)

Use `scripts/measure-copilot-memory-reuse.mjs` com observações A/B coletadas em um
perfil isolado, alternando a ordem e mantendo modelo, tarefa e contexto iguais. O
relatório registra latência, chamadas, `FULL`/`PARTIAL`/`NONE`, reutilizações efetivas e
estimativas locais de tokens. A estimativa não é consumo do Copilot. Sem exportação
oficial por execução, economia faturada permanece indisponível e não deve ser inferida.
O método e o formato estão em [aud-13-token-economy.md](aud-13-token-economy.md).

## Versões e atualização

`0.1.14` é a versão de produção deste lote. Ela restaura os padrões configuráveis
`mongodb://127.0.0.1:27017` e `ai_dev_assistant`; o usuário pode substituir ambos pelas
Settings `aiDevAssistant.mongodb.uri` e `aiDevAssistant.mongodb.database`. O roteamento
experimental AUD-13 por workspace e porta 27019 não faz parte da release. Para atualizar,
instale o VSIX em um perfil descartável, preserve a instalação cotidiana e confirme o
agente, hooks, ferramentas e memória antes de substituir qualquer release.

A captura automática é opt-in: a extensão não instala nem reconcilia launchers na
ativação. O comando explícito de habilitação instala somente os launchers privados
gerenciados pelo AI Dev Assistant; não restaura lançadores antigos nem altera arquivos
de usuário de outros produtos.

As classificações NONE, PARTIAL e FULL, embeddings, deduplicação e isolamento por
workspace foram preservados. As estimativas locais de tokens não representam consumo ou
cobrança do GitHub Copilot; a eficiência de 50% para PARTIAL e 80% para FULL permanece
não homologada.
Para desinstalar, use `code --uninstall-extension ai-dev-assistant-local.ai-dev-assistant`
e remova apenas dados locais após revisar o consentimento; a extensão não apaga o
MongoDB automaticamente.
