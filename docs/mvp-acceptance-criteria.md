# Critérios de aceite do MVP

## 1. Regra central

- Toda solicitação válida consulta a memória antes de qualquer integração externa.
- Controller e extensão VS Code não possuem acesso direto a `AiProvider`.
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
- Thresholds, top-K e quantidade de candidatos são configuráveis e validados.
- O índice vetorial precisa estar pronto antes da busca.

## 4. Classificação

- O resultado é `FULL`, `PARTIAL` ou `NONE`.
- Similaridade e compatibilidade são avaliadas separadamente.
- Conflito técnico relevante impede `FULL`.
- A classificação informa score e razões suficientes para diagnóstico interno.

## 5. Orquestração

- `FULL`: responde com memória e nunca chama `AiProvider`.
- `PARTIAL`: usa memória, envia contexto mínimo e chama IA para adaptação ou complemento.
- `NONE`: chama IA somente depois de concluir a busca local.
- Respostas geradas externamente são persistidas antes de uma conclusão bem-sucedida.
- Persistência e reprocessamento são idempotentes.

## 6. MongoDB

- Conhecimento reutilizável não é tratado como histórico de conversa.
- O documento contém versão de schema e ciclo de vida.
- Existem índices para hash, deduplicação e busca vetorial.
- Reutilização registra quantidade, data, projeto e similaridade mais recentes.
- O domínio não depende de classes ou anotações MongoDB.

## 7. Segurança

- API keys, tokens e senhas não ficam no código ou repositório.
- Segredos não aparecem em logs, erros ou respostas HTTP.
- A extensão não envia automaticamente arquivos inteiros.
- O contexto enviado à IA é limitado ao necessário.
- Caminhos absolutos não são persistidos por padrão.
- Payloads possuem limites definidos.

## 8. Observabilidade

- O backend mede prompts, hits locais, chamadas de IA e chamadas evitadas.
- Tokens reais são separados de valores estimados.
- `estimatedTokensSaved` possui metodologia documentada.
- Prompts e identificadores de alta cardinalidade não são labels de métricas.

## 9. Extensão VS Code

- A extensão funciona sem GitHub Copilot.
- A extensão se comunica apenas com o backend local configurado.
- O usuário consegue enviar prompt e visualizar resposta.
- A interface apresenta fonte, similaridade e utilização de IA.
- A extensão não executa comandos nem modifica arquivos automaticamente.

## 10. Qualidade

- Testes automatizados cobrem normalização, hash, busca, classificação e orquestração.
- Testes comprovam que `AiProvider` não é chamado em `FULL`.
- Testes comprovam que memória indisponível bloqueia integrações externas.
- Testes arquiteturais verificam a direção das dependências.
- O ambiente local pode ser iniciado de forma reproduzível.
- A documentação operacional corresponde ao comportamento implementado.

## 11. Fora do aceite do MVP

Não são necessários para considerar o primeiro MVP concluído:

- múltiplos agentes;
- execução e edição automática;
- pull requests;
- GitHub/Copilot;
- autenticação ou multiusuário;
- cloud, Kubernetes ou marketplace;
- dashboard complexo;
- fine-tuning;
- pesquisa externa ativa.
