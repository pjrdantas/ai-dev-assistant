# Critérios de aceite — VSIX nativo

- O VSIX instala sem Java, banco de dados, Docker ou serviço do AI Dev Assistant.
- **AI Dev Assistant** aparece no seletor de Agents do Copilot Chat.
- O model picker nativo continua controlando o modelo; o agente não fixa `model`.
- As ferramentas nativas de pesquisa, leitura, edição, terminal, build e testes continuam
  disponíveis conforme permissões do VS Code.
- Arquivos fechados podem ser localizados, lidos e alterados pelo Agent.
- `searchMemory` e `saveMemory` são adicionais às ferramentas nativas.
- Uma correspondência exata não inicializa ONNX; a busca semântica inicializa ONNX sob
  demanda.
- A memória permanece no perfil local após reabrir o VS Code.
- Segredos são recusados pela memória e não há provider próprio de IA.
- O pacote não contém código TypeScript, testes, mapas de fonte, Java legado, WebView ou
  outro VSIX.
- O pacote contém a definição do Agent, runtime JavaScript compilado, modelo, tokenizer,
  WASM necessário e `THIRD_PARTY_NOTICES.md`.
- A instalação e os cenários de arquivo fechado, edição multiarquivo, terminal/testes,
  troca de modelo, exact e semantic memory estão documentados em `docs/operations.md`.
