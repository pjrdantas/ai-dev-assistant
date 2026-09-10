# Regras do projeto para o Codex

- Trabalhar de forma incremental.
- Não criar código desnecessário.
- Não alterar a arquitetura sem justificar a mudança.
- Não colocar regras de negócio em controllers.
- Preservar a arquitetura hexagonal quando o desenvolvimento do backend for iniciado.
- Não acessar diretamente provedores de IA a partir da camada de apresentação.
- Nunca colocar API Keys, tokens, senhas ou outros segredos no código.
- Sempre criar ou atualizar testes quando uma regra de negócio for implementada.
- Evitar classes com nomes artificiais que não representem um domínio ou uma responsabilidade real.
- Antes de grandes alterações, analisar o impacto no projeto.
- O produto final deve funcionar no Windows sem Docker, containers ou daemon de banco de dados instalado separadamente.
- Não introduzir novas dependências operacionais de Docker; a infraestrutura MongoDB atual é somente uma prova técnica temporária de desenvolvimento.
- Antes de iniciar qualquer atividade, descrever de forma objetiva o que será desenvolvido ou alterado.
- Antes de planejar ou implementar funcionalidades, consultar `docs/product-specification.md`, `docs/architecture.md`, `docs/roadmap.md` e os ADRs aplicáveis em `docs/decisions`.

## Regra central da aplicação

Toda solicitação do usuário deverá consultar primeiro a memória local antes de qualquer chamada para IA externa.

Esta regra deve orientar a arquitetura e a implementação futuras, mas ainda não deve ser implementada nesta fase.
