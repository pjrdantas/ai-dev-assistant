# Critérios de aceite do MVP

## 1. Regra central

- Toda solicitação válida consulta a memória antes de qualquer integração externa.
- Controller e componentes visuais não acessam modelos diretamente.
- O adapter Copilot da extensão só chama `vscode.lm` após autorização do backend.
- Falha na memória impede chamadas de IA e pesquisa externa.
- A regra é protegida por testes unitários, de integração e arquiteturais.

## 2. Busca exata

- O prompt é normalizado por uma estratégia conservadora e versionada.
- O hash é SHA-256 e possui testes determinísticos.
- A busca por hash ocorre antes de qualquer embedding.
- Um match exato ainda passa por avaliação de compatibilidade.
- Um match `FULL` responde localmente sem chamar IA.

## 3. Busca semântica

- Embeddings são gerados localmente.
- Nenhum download remoto de modelo ocorre durante uma solicitação.
- Modelo, versão e dimensão do embedding são persistidos.
- A busca vetorial utiliza somente vetores compatíveis.
- Thresholds e top-K são configuráveis e validados.
- O índice vetorial precisa estar pronto antes da busca.

## 4. Classificação

- O resultado é `FULL`, `PARTIAL` ou `NONE`.
- Similaridade e compatibilidade são avaliadas separadamente.
- Conflito técnico relevante impede `FULL`.
- A classificação informa score e razões suficientes para diagnóstico interno.

## 5. Orquestração

- `FULL`: responde com memória e não cria autorização para IA.
- `PARTIAL`: usa memória e prepara contexto mínimo para adaptação ou complemento.
- `NONE`: prepara contexto mínimo somente depois de concluir a busca local.
- Uma resposta externa só é aceita com autorização pendente e não expirada.
- Respostas geradas externamente são persistidas antes de uma conclusão bem-sucedida.
- Persistência e reprocessamento são idempotentes.

## 6. Persistência local

- Conhecimento reutilizável não é tratado como histórico de conversa.
- O documento contém versão de schema e ciclo de vida.
- Existem índices para hash, deduplicação e busca vetorial.
- Reutilização registra quantidade, data, projeto e similaridade mais recentes.
- O domínio não depende de classes ou anotações MongoDB.
- O produto final inicia e mantém sua memória sem Docker, containers ou daemon externo.

## 7. Segurança

- API keys, tokens e senhas não ficam no código ou repositório.
- Segredos não aparecem em logs, erros ou respostas HTTP.
- A extensão não envia automaticamente arquivos inteiros.
- O contexto enviado à IA é limitado ao necessário.
- Caminhos absolutos não são persistidos por padrão.
- Payloads possuem limites definidos.

## 8. Observabilidade

- O backend mede prompts, hits locais, chamadas de IA e chamadas evitadas.
- Tokens contados pelo modelo são separados de valores estimados e não são apresentados
  como consumo faturado.
- `estimatedTokensSaved` possui metodologia documentada.
- Prompts e identificadores de alta cardinalidade não são labels de métricas.

## 9. Extensão VS Code

- A IA externa exige GitHub Copilot Enterprise disponível para o usuário no VS Code.
- A extensão se comunica apenas com o backend local configurado.
- Um adapter separado usa `vscode.lm` com `vendor: "copilot"` e consentimento do usuário.
- O usuário consegue enviar prompt e visualizar resposta.
- A interface apresenta fonte, similaridade e utilização de IA.
- A extensão não executa comandos nem modifica arquivos automaticamente.

## 10. Qualidade

- Testes automatizados cobrem normalização, hash, busca, classificação e orquestração.
- Testes comprovam que nenhuma solicitação externa é criada em `FULL`.
- Testes comprovam que conclusões externas não correlacionadas são recusadas.
- Testes comprovam que memória indisponível bloqueia integrações externas.
- Testes arquiteturais verificam a direção das dependências.
- O ambiente final pode ser iniciado de forma reproduzível sem Docker.
- A documentação operacional corresponde ao comportamento implementado.

## 11. Fora do aceite do MVP

Não são necessários para considerar o primeiro MVP concluído:

- múltiplos agentes;
- execução e edição automática;
- pull requests;
- integração geral com repositórios e APIs do GitHub;
- autenticação ou multiusuário;
- cloud, Kubernetes ou marketplace;
- dashboard complexo;
- fine-tuning;
- pesquisa externa ativa.

## 12. Evidências da Fase 11

- O teste `PromptEndToEndIntegrationTest` cobre REST, orquestração, Lucene, conclusão
  externa simulada, persistência, reutilização e métricas no mesmo cenário.
- Os testes TypeScript comprovam seleção exclusiva de `vendor: "copilot"`, ausência de
  fallback de fornecedor, limites de entrada e saída e rejeição de contratos inválidos.
- O pacote VSIX é gerado pelo `@vscode/vsce` oficial e validado em um diretório isolado.
- O smoke test com ONNX e Lucene reais confirmou persistência, reutilização e os
  contadores de uma chamada realizada e uma chamada evitada.
- O aceite manual iniciado pelo usuário com sua sessão GitHub Copilot Enterprise foi
  concluído. A repetição exata retornou `LOCAL_MEMORY`, `FULL`, similaridade `1.00` e
  nenhuma nova chamada à IA; as métricas da sessão registraram seis solicitações, duas
  chamadas externas e quatro chamadas evitadas.
- O procedimento reproduzível e os cenários de falha estão em `docs/operations.md`.
