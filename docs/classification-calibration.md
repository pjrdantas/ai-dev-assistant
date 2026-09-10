# Calibração da classificação

## Objetivo

Definir limites iniciais de similaridade e validar as regras de compatibilidade da Fase 6 sem misturar classificação com infraestrutura ou orquestração.

## Dataset semântico

O arquivo `backend/src/test/resources/similarity-threshold-calibration.csv` contém treze pares representativos de Java, Spring Boot, JUnit, Cucumber, Kafka, Angular, AWS e Terraform. Os embeddings são produzidos pelo modelo ONNX fixado na Fase 4 e convertidos para a mesma escala normalizada de score usada pela busca vetorial.

Resultados observados:

- menor score entre exemplos completos: `0.7818`;
- maior score entre exemplos parciais: `0.8282`;
- menor score entre exemplos reutilizáveis: `0.7082`;
- maior score entre exemplos não relacionados: `0.5962`.

Há sobreposição entre exemplos completos e parciais. Por isso o score não classifica sozinho um match completo.

## Limites iniciais

- `FULL`: `0.90`;
- `PARTIAL`: `0.70`;
- abaixo de `0.70`: `NONE` semântico.

O limite de `FULL` é deliberadamente conservador. Pares equivalentes abaixo de `0.90` continuam disponíveis como `PARTIAL`, evitando uma reutilização integral arriscada.

## Compatibilidade

Além do score, a política considera:

- estado do conhecimento;
- idade máxima para reutilização completa;
- tipo de tarefa;
- tecnologias presentes;
- versões conhecidas.

Conflito de versão principal, como Spring Boot 2 versus 3, impede `FULL` e resulta em `NONE`. Diferença de versão dentro da mesma versão principal, contexto incompleto ou conhecimento antigo exigem adaptação e limitam o resultado a `PARTIAL`.

## Reprodução

Na raiz do projeto:

```powershell
.\scripts\embedding-model.ps1 benchmark paraphrase-multilingual-minilm
```

O comando executa o benchmark do modelo e a calibração. Os artefatos precisam ter sido preparados previamente e não há download durante os testes.
