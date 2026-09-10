# Avaliação da busca semântica

## Objetivo

Validar o mecanismo local definitivo da Fase 6A: persistência dos vetores, abertura segura do índice, ordenação por similaridade e filtros aplicados pela consulta k-NN do Lucene.

## Dataset

O arquivo `backend/src/test/resources/semantic-search-evaluation.csv` contém sete casos controlados. Os vetores bidimensionais descritos no arquivo são completados com zeros até as 384 dimensões exigidas pelo índice.

Quatro conhecimentos ativos usam o mesmo modelo e versão da consulta e possuem uma ordem esperada por similaridade. O teste configura `top-K=3`, portanto somente os três primeiros podem ser devolvidos. Outros três casos devem ser excluídos por estado descontinuado, modelo diferente ou versão diferente.

Esse dataset é propositalmente determinístico e testa o adapter Lucene, não a qualidade linguística do modelo. A qualidade, a latência e o consumo do ONNX selecionado são avaliados separadamente em `docs/embedding-benchmark.md`.

## Critérios verificados

- o índice é criado ou aberto e tem schema e dimensão validados antes das consultas;
- somente embeddings com 384 dimensões são aceitos;
- `top-K` é obtido da configuração externa;
- o resultado mantém a ordem de score normalizado retornada pelo Lucene;
- conhecimentos que não atendem aos filtros de estado, modelo, versão e dimensão não participam da busca;
- o score permanece como resultado de recuperação, sem classificação `FULL`, `PARTIAL` ou `NONE` no adapter.

## Execução

Na pasta `backend`:

```powershell
.\mvnw.cmd verify
```

Os testes de integração criam um índice Lucene em diretório temporário e não exigem Docker, MongoDB ou outro processo externo.
