# Operação e validação manual

## Pré-requisitos

Instale VS Code compatível, o VSIX, MongoDB local e use uma conta com GitHub Copilot
disponível. Não instale Java, backend, Docker ou daemon do AI Dev Assistant. MongoDB não
é empacotado no VSIX; o padrão é `mongodb://127.0.0.1:27017`, database `ai_dev_assistant`.

## Roteiro manual de cenário real

1. Instale `ai-dev-assistant-0.1.0.vsix` com `code --install-extension`.
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
12. Confirme a ausência de Activity Bar e WebView próprias.

## Confirmação das tools de memória

O VS Code pode solicitar confirmação antes de executar uma Language Model Tool de uma
extensão. Revise a invocação e seus dados antes de permitir; quando a interface oferecer
uma opção como **Always Allow**, ela controla a permissão no VS Code, não altera a
localidade das tools. `searchMemory` consulta somente armazenamento e embedding locais;
`saveMemory` salva somente no perfil local após a confirmação prevista pela extensão.
Nenhuma das duas chama internet ou outro LLM.

## Captura automática de interações (Preview)

`UserPromptSubmit` é declarado no frontmatter de
`vscode-extension/agents/ai-dev-assistant.agent.md`. Portanto, quando o runtime oferece
suporte a hooks agent-scoped, o VS Code executa a captura **somente** quando
o **AI Dev Assistant** está selecionado (ou é invocado como subagent). Não é usado
transcript, título de conversa, conteúdo do prompt ou `cwd` para determinar o agente.

Para habilitar, execute **AI Dev Assistant: Enable Automatic Interaction Capture** e
confirme o aviso. A disponibilidade da configuração Preview
`chat.useCustomAgentHooks` depende da versão/build do VS Code: o comando a detecta em
runtime com `WorkspaceConfiguration.inspect` e só a ativa no perfil do usuário quando
ela está registrada. Se não estiver disponível, a preparação dos launchers continua e o
comando informa o suporte oferecido pelo runtime atual, sem erro e sem criar fallback
global. Ele cria somente estes artefatos privados:

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
A configuração Preview permanece uma escolha do
usuário e pode ser desativada manualmente nas Settings do VS Code.

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
