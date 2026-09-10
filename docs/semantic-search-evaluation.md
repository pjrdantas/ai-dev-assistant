# Avaliação da busca semântica

## Objetivo

Validar o mecanismo local da Fase 5: persistência dos vetores, prontidão do índice, ordenação por similaridade e pré-filtros aplicados pelo `$vectorSearch`.

## Dataset

O arquivo `backend/src/test/resources/semantic-search-evaluation.csv` contém sete casos controlados. Os vetores bidimensionais descritos no arquivo são completados com zeros até as 384 dimensões exigidas pelo índice.

Quatro conhecimentos ativos usam o mesmo modelo e versão da consulta e possuem uma ordem esperada por similaridade. O teste configura `top-K=3`, portanto somente os três primeiros podem ser devolvidos. Outros três casos devem ser excluídos por estado descontinuado, modelo diferente ou versão diferente.

Esse dataset é propositalmente determinístico e testa o adapter MongoDB, não a qualidade linguística do modelo. A qualidade, a latência e o consumo do ONNX selecionado são avaliados separadamente em `docs/embedding-benchmark.md`.

## Critérios verificados

- o índice existe, está `READY` e pode receber consultas;
- somente embeddings com 384 dimensões são aceitos;
- `top-K` e quantidade de candidatos são obtidos da configuração externa;
- o resultado mantém a ordem de score retornada pelo MongoDB;
- conhecimentos que não atendem aos filtros de estado, modelo, versão e dimensão não participam da busca;
- o score permanece bruto, sem classificação `FULL`, `PARTIAL` ou `NONE` nesta fase.

## Execução

Na pasta `backend`:

```powershell
.\mvnw.cmd verify
```

Os testes de integração usam a imagem Atlas Local fixada no projeto e exigem Docker disponível.
