# Especificação do produto — AI Dev Assistant

## Visão

O AI Dev Assistant é um único VSIX que contribui um Custom Agent nativo ao GitHub
Copilot Chat do VS Code. O GitHub Copilot é a única IA do produto; o modelo é escolhido
pelo usuário no seletor nativo do Copilot.

O agente conserva as capacidades nativas apropriadas para desenvolvimento: descoberta e
pesquisa no workspace, leitura de arquivos, edição de múltiplos arquivos, terminal,
build e testes, conforme permissões normais do VS Code. Não há backend, serviço próprio,
WebView, Activity Bar própria, container ou daemon empacotado. MongoDB local é um
pré-requisito externo para persistir a memória.

## Memória local

Antes de produzir uma nova solução técnica, o agente deve chamar
`searchMemory`. A ferramenta pesquisa MongoDB local: primeiro por correspondência exata
e, apenas se necessário, por similaridade local
com ONNX/WebAssembly. Ela classifica o resultado em `FULL`, `PARTIAL` ou `NONE` e não
chama IA nem internet.

Memory-first significa **consultar a memória antes de produzir uma nova solução
técnica**. Não significa impedir o Copilot de existir antes da consulta nem substituir a
investigação do codebase. A memória é contexto complementar; o agente ainda descobre,
pesquisa, lê e edita os arquivos relevantes.

Depois de uma solução validada e reutilizável, o agente deve chamar `saveMemory` antes da
resposta final, sem exigir uma referência manual da tool pelo usuário. A gravação recebe a
solicitação original literal do usuário e a solução; a extensão
produz localmente uma chave normalizada determinística para exact match. A gravação é
local, pede confirmação e rejeita padrões de
segredos. Credenciais nunca devem ser persistidas.

## Contexto do workspace

O agente não recebe todos os arquivos simultaneamente. Ele usa as ferramentas nativas do
Copilot para localizar, pesquisar, ler e editar os arquivos relevantes, inclusive quando
estão fechados no editor. Assim, uma solicitação que envolva um `pom.xml` fechado pode
localizá-lo no workspace, lê-lo, alterá-lo e validar a mudança com build e testes.

## Armazenamento local

MongoDB local é o store ativo, por padrão em `mongodb://127.0.0.1:27017`, database
`ai_dev_assistant`. `memories` armazena conhecimento técnico reutilizável e
`interactions` armazena histórico de perguntas e respostas capturado pelos hooks.
Embeddings são produzidos localmente por ONNX. MongoDB Atlas não é obrigatório e o
servidor MongoDB não é distribuído dentro do VSIX.

`knowledge-v1.json` é suportado exclusivamente como fonte de migração legada; MongoDB é
o store ativo.

## Limites

O produto não possui seletor de modelo, provider próprio de IA, chamadas diretas para
OpenAI, Anthropic ou Gemini, nem integrações com Java, Spring, Lucene ou Docker.
O VSIX requer VS Code compatível e GitHub Copilot disponível para respostas que dependam
da IA; as consultas de memória local continuam independentes de rede.
