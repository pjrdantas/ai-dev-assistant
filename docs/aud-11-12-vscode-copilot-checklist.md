# Checklist executável — AUD-11/AUD-12

Este roteiro deve ser executado em um perfil descartável do VS Code. Ele não autoriza
uso do MongoDB habitual: configure uma instância efêmera em porta diferente de 27017.

## CI/local

```powershell
cd C:\Projeto\git\ai-dev-assistant\vscode-extension
npm ci
npm run compile
$env:AI_DEV_ASSISTANT_E3_006_MONGODB_URI = 'mongodb://127.0.0.1:27018/ai_dev_assistant_e3_006?directConnection=true'
$env:AI_DEV_ASSISTANT_E3_007_MONGODB_URI = 'mongodb://127.0.0.1:27018/ai_dev_assistant_e3_007?directConnection=true'
npm test
node ..\scripts\verify-local-onnx.mjs
node ..\scripts\verify-dependencies.mjs
npm audit --omit=dev --audit-level=high
npm audit --json > npm-audit-full.json; if ($LASTEXITCODE -ne 0) { Write-Warning 'Há vulnerabilidades transitivas de desenvolvimento; revisar o relatório antes do fechamento.' }
npm sbom --sbom-format cyclonedx > sbom.cdx.json
npx vsce package --dependencies --out audit-temporary.vsix
npx vsce ls --tree
```

O workflow `.github/workflows/ci.yml` repete esses passos com MongoDB efêmero do job,
publica SBOM, licenças, lista do VSIX e o pacote como artefatos. A confirmação de
`CORRIGIDO` para CI exige um run real aprovado no GitHub; este arquivo sozinho não é
essa evidência.

## VS Code/Copilot em perfil isolado

- [ ] Instalar a VSIX temporária no perfil descartável; não instalar ou substituir a 0.1.12 cotidiana.
- [ ] Selecionar o Custom Agent `AI Dev Assistant` no seletor nativo.
- [ ] Confirmar pesquisa, leitura de arquivo fechado, edição multiarquivo, terminal, build e testes nativos.
- [ ] Trocar o modelo no model picker; confirmar que o agente permanece selecionado.
- [ ] Confirmar `FULL` para uma solicitação exata e `PARTIAL`/`NONE` para casos preparados.
- [ ] Habilitar captura, enviar prompt no AI Dev Assistant e confirmar uma interação.
- [ ] Trocar para outro Agent e confirmar que a contagem não cresce.
- [ ] Desabilitar captura e confirmar que os launchers gerenciados deixam de existir.
- [ ] Reinstalar/atualizar uma VSIX temporária; confirmar que launcher antigo é reconciliado apenas quando marcado e reconhecível.
- [ ] Alterar um launcher marcado ou remover o snapshot MongoDB; confirmar aviso e nenhum overwrite automático.
- [ ] Reiniciar o VS Code e repetir a verificação de estado e escopo.
- [ ] Registrar versão do VS Code, versão da VSIX, Session Target Copilot, eventos observados, logs sem prompts/credenciais e screenshots.

Hooks agent-scoped são complementares às ferramentas nativas. `UserPromptSubmit` e `Stop`
usam o formato VS Code compatível (`hook_event_name`, `session_id`, `transcript_path`);
`Stop` pode ser tratado como `agentStop`/`SubagentStop` em subagentes conforme o runtime.
