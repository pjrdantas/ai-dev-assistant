# AUD-14 — Consolidação final do Lote 6

Data da execução: 2026-11-08 (America/Sao_Paulo). Branch observada: `master`.
Os commits `95bd51f`, `b3138aa`, `6c016c6` e `ba2fb68` foram publicados normalmente em `master`.
A versão publicada de referência é `0.1.12`; `0.1.13` continua candidata não publicada.

## Matriz final T01–T25

| ID | Descrição | Resultado esperado | Evidência executada | Status | Pendência |
|---|---|---|---|---|---|
| T01 | Manifesto e arquitetura nativa | Um VSIX, sem `model:`/`tools:` próprios | `agentManifest.test.ts` | PASS | — |
| T02 | Agente no seletor nativo Copilot | Agente visível no Agent picker | Não executado em sessão autenticada | BLOCKED | AUD-11 manual |
| T03 | Troca no model picker | Agente permanece selecionado | Não executado em sessão autenticada | BLOCKED | AUD-11 manual |
| T04 | Leitura de arquivo fechado | Copilot localiza arquivo fechado | Não executado em sessão autenticada | BLOCKED | AUD-11 manual |
| T05 | Pesquisa/edição multiarquivo | Ferramentas nativas preservadas | Manifesto sem `tools:` + teste estático | PASS | Sessão real pendente |
| T06 | Terminal, build e testes pelo Agent | Capacidades nativas disponíveis | Não executado em sessão autenticada | BLOCKED | AUD-11 manual |
| T07 | Exact memory | `FULL`, sem ONNX | `localMemoryService.test.ts`, `localEmbeddingProvider.test.ts` | PASS | — |
| T08 | Semantic memory | ONNX lazy e sessão compartilhada | Testes ONNX + `verify-local-onnx.mjs` | PASS | — |
| T09 | Salvamento e consentimento | Confirmação, `MANUAL/SHARED`, sem segredo | `memoryConfirmation.test.ts`, `lot2.test.ts` | PASS | — |
| T10 | Captura agent-scoped | Só AI Dev Assistant captura | Testes de hooks; sessão real não executada | BLOCKED | AUD-12 manual |
| T11 | Timeout e launchers | `timeoutSec: 5`, Windows/Unix | `agentManifest.test.ts`, `interactionHookInstallation.test.ts` | PASS | — |
| T12 | Reinstalação segura | Launcher desconhecido não é sobrescrito | Testes AUD-11/5B.5 | PASS | — |
| T13 | Isolamento Mongo/workspace | Sem vazamento entre workspaces | Integrações Mongo efêmeras em 27018 | PASS | — |
| T14 | Memórias LEGACY | Leitura/revisão segura, sem cruzar workspace | `mongoMemoryStore.integration.test.ts`, `workspaceIsolation.test.ts` | PASS | — |
| T15 | Retenção e histórico | Backups/locks conforme limites | `fileLocalMemoryStore.test.ts` | PASS | — |
| T16 | Diagnóstico operacional | Erros sanitizados e explícitos | `mongoConnectionManager.test.ts` | PASS | — |
| T17 | Instrumentação AUD-13 | Pares A/B, ordem, latência, chamadas, match e reuso | `measure-copilot-memory-reuse.mjs` + `aud13TokenEconomy.test.ts` | PASS | Coletar sessão real |
| T18 | Tokens faturados Copilot | Fonte oficial por execução | Nenhuma fonte oficial disponível | BLOCKED | Não declarar economia faturada |
| T19 | Escalabilidade sem claim indevido | O(n) documentado e top-K determinístico | `benchmarkSecurity.test.ts`, benchmark AUD-10 | PASS | — |
| T20 | Overrides de dependências | Lockfile compatível com manifest | `npm ci`, compile e testes | PASS | Revisar em upgrade futuro |
| T21 | ONNX/assets | Checksum, lazy load, 384-D | `verify-local-onnx.mjs` | PASS | — |
| T22 | Licenças | Inventário consistente | `verify-dependencies.mjs`: 190 pacotes | PASS | — |
| T23 | SBOM | CycloneDX gerado | `npm sbom`: 242818 bytes | PASS | Artefato temporário |
| T24 | Empacotamento isolado | VSIX candidata empacota sem publicar | `vsce package`: 440 arquivos, 78.23 MB | PASS | Instalação manual pendente |
| T25 | Integridade do lote | Só `master`, diff sem whitespace error, sem perda de histórico | `git status`, `git diff --check`, `origin/master` | PASS | Artefatos locais não rastreados permanecem fora do commit |

## Validações e contagens

- Suíte completa com MongoDB efêmero em `127.0.0.1:27018`: **177 PASS, 0 FAIL,
  0 SKIP**.
- Execução sem URI, registrada para transparência: **151 descobertos, 148 PASS,
  2 FAIL por pré-condição ausente, 1 SKIP**; não foi usada como aprovação.
- `npm ci`: PASS; 153 pacotes auditados, 0 vulnerabilidades reportadas pelo npm.
- Compilação TypeScript: PASS.
- ONNX: PASS, vetor 384-D e norma L2 1.
- Licenças: PASS, 190 pacotes verificados.
- `npm audit --omit=dev --audit-level=high`: PASS, 0 vulnerabilidades.
- SBOM CycloneDX: PASS, gerado em diretório temporário.
- VSIX isolada: PASS, 440 arquivos e 78,23 MB; artefatos de auditoria excluídos; nenhuma release publicada.
- GitHub Actions: PASS, run [42438625492](https://github.com/pjrdantas/ai-dev-assistant/actions/runs/42438625492), todos os passos verdes no commit `ba2fb68`.
- `git diff --check`: PASS, com apenas avisos de normalização LF/CRLF já existentes.

## AUD-13 e AUD-14

**AUD-13: BLOCKED para quantificação faturada; instrumentação CORRIGIDA.** A extensão
mede reutilização local e o novo agregador aceita evidência de latência/chamadas. Sem
telemetria/exportação oficial do Copilot, tokens exatos, créditos e percentual faturado
continuam desconhecidos. A economia local estimada só deve ser calculada após a coleta
de pares reais e não deve ser apresentada como consumo do Copilot.

**AUD-14: CORRIGIDO.** A documentação agora reflete `0.1.12`, `0.1.13` candidata,
hooks agent-scoped, `timeoutSec`, consentimento, retenção, MongoDB, LEGACY,
FULL/PARTIAL/NONE, reuso, O(n), operação, atualização/desinstalação, diagnóstico e
limitações de homologação.

## Segurança, dependências e riscos residuais

A revisão final do estado auditado cobriu os 21 itens de código/configuração; as duas
correções posteriores, exclusivamente no workflow, também foram revisadas separadamente.
Todas as revisões tiveram cobertura completa, zero candidatos reportáveis e zero achados.
Artefatos locais com caminhos de auditoria, relatórios gerados e imagem não relacionada
foram excluídos do staging. Não foram encontrados segredos nos arquivos selecionados para
publicação. Os overrides principais
(`@azure/identity`, `@azure/msal-node`, `minimatch` e `qs`) foram aceitos por
`npm ci`, compilação, testes e auditoria; isso confirma compatibilidade operacional local,
não substitui revisão futura de advisories.

Riscos residuais reais: a sessão VS Code/Copilot autenticada ainda não foi executada
(AUD-11/AUD-12), a economia faturada não é observável pela extensão, a busca semântica
continua com ranking local O(n), e a disponibilidade dos hooks depende do runtime,
admissão e políticas do Copilot. O banco habitual não foi acessado; as integrações
usaram somente a instância efêmera em 27018.
