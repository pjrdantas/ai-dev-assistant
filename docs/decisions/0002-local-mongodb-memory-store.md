# ADR 0002 — MongoDB local como store ativo de memória

## Decisão

O VSIX continua sendo o único componente da extensão, mas sua memória ativa passa a usar
MongoDB local pelo driver oficial Node.js. Não há backend, Docker obrigatório, Atlas,
Mongoose ou serviço de IA adicional.

## Consequências

O padrão é `mongodb://127.0.0.1:27017`, database `ai_dev_assistant`, configuráveis por
Settings do VS Code. Um único `MongoClient` lazy é reutilizado pelo Extension Host. A
indisponibilidade do Mongo retorna estado explícito de memória indisponível e não usa JSON
como fallback; o Agent e suas tools nativas continuam disponíveis.

As collections são `memories` e `interactions`. A similaridade cosine continua local, e
exact match continua antes da inicialização ONNX. O JSON histórico é migrado por comando
idempotente, preservado no disco e nunca apagado automaticamente.
