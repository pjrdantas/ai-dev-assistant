# Roadmap — AI Dev Assistant

## Fase atual — consolidação do VSIX nativo

Status: concluída tecnicamente, sujeita à validação manual com uma conta GitHub Copilot
compatível.

- Custom Agent registrado no seletor nativo do Copilot;
- ferramentas locais `searchMemory` e `saveMemory` registradas pela extensão;
- memória e histórico persistidos no MongoDB local configurado para o usuário;
- busca exata antes de ONNX lazy e busca semântica;
- empacotamento em um único VSIX sem backend, Docker, MongoDB Atlas ou outro serviço remoto.

## Próximas decisões, apenas quando autorizadas

- observar o uso real e ajustar documentação ou thresholds com evidência;
- evoluir o formato da memória mediante compatibilidade e migração explícitas;
- avaliar recursos adicionais somente sem reduzir as capacidades nativas do Agent.
