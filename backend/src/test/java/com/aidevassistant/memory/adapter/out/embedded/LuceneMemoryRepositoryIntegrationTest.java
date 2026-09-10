package com.aidevassistant.memory.adapter.out.embedded;

import com.aidevassistant.memory.application.port.out.SemanticMemoryCandidate;
import com.aidevassistant.memory.domain.model.Embedding;
import com.aidevassistant.memory.domain.model.KnowledgeEntry;
import com.aidevassistant.memory.domain.model.KnowledgeStatus;
import com.aidevassistant.projectcontext.domain.model.TechnicalContext;
import com.aidevassistant.prompt.domain.model.NormalizedPrompt;
import com.aidevassistant.prompt.domain.model.Prompt;
import com.aidevassistant.prompt.domain.model.PromptHash;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class LuceneMemoryRepositoryIntegrationTest {

    private static final PromptHash PROMPT_HASH = new PromptHash("b".repeat(64), 1);
    private static final String MODEL = "phase5-model";
    private static final String MODEL_VERSION = "revision-1";
    private static final int DIMENSION = 384;
    private static final Instant CREATED_AT = Instant.parse("2026-09-10T00:00:00Z");

    @TempDir
    Path memoryDirectory;

    private LuceneMemoryRepository repository;

    @BeforeEach
    void openRepository() {
        repository = new LuceneMemoryRepository(memoryDirectory, DIMENSION, 3);
    }

    @AfterEach
    void closeRepository() {
        if (repository != null) {
            repository.close();
        }
    }

    @Test
    void persistsCompleteKnowledgeAndFindsExactCandidatesInUpdateOrder() {
        TechnicalContext technicalContext = new TechnicalContext(
                Set.of("java", "spring-boot"),
                Map.of("java", "21", "spring-boot", "3.5.0"),
                Optional.of("test"));
        KnowledgeEntry first = repository.save(knowledge("First solution", CREATED_AT)
                .withTechnicalContext(technicalContext, CREATED_AT.plusSeconds(10)));
        Embedding embedding = new Embedding(MODEL, MODEL_VERSION, vector(1.0f, 0.0f));
        KnowledgeEntry vectorized = repository.saveEmbedding(
                first.id(),
                embedding,
                CREATED_AT.plusSeconds(20)).orElseThrow();
        KnowledgeEntry second = repository.save(knowledge("Second solution", CREATED_AT.plusSeconds(30)));

        List<KnowledgeEntry> candidates = repository.findActiveByPromptHash(PROMPT_HASH);

        assertEquals(List.of(second.id(), vectorized.id()),
                candidates.stream().map(KnowledgeEntry::id).toList());
        assertEquals(technicalContext, candidates.get(1).technicalContext());
        assertEquals(embedding, candidates.get(1).embedding().orElseThrow());
    }

    @Test
    void saveIsIdempotentUnderConcurrency() {
        int attempts = 8;
        ExecutorService executor = Executors.newFixedThreadPool(attempts);
        CountDownLatch start = new CountDownLatch(1);

        try {
            List<Future<UUID>> futures = IntStream.range(0, attempts)
                    .mapToObj(attempt -> executor.submit(() -> {
                        start.await();
                        return repository.save(knowledge(
                                "Concurrent solution",
                                CREATED_AT.plusSeconds(attempt))).id();
                    }))
                    .toList();

            start.countDown();
            Set<UUID> persistedIds = futures.stream()
                    .map(this::completedValue)
                    .collect(Collectors.toSet());

            assertEquals(1, persistedIds.size());
            assertEquals(1, repository.findActiveByPromptHash(PROMPT_HASH).size());
        } finally {
            executor.shutdownNow();
        }
    }

    @Test
    void repeatedSavePreservesTheFirstPersistedEntry() {
        KnowledgeEntry first = repository.save(knowledge("Same solution", CREATED_AT));
        KnowledgeEntry duplicate = repository.save(knowledge(
                "Same solution",
                CREATED_AT.plusSeconds(30)));

        assertEquals(first.id(), duplicate.id());
        assertEquals(first.createdAt(), duplicate.createdAt());
        assertEquals(1, repository.findActiveByPromptHash(PROMPT_HASH).size());
    }

    @Test
    void semanticSearchRanksCandidatesAndFiltersLifecycleAndEmbeddingIdentification() {
        List<EvaluationCase> dataset = loadDataset();
        for (int index = 0; index < dataset.size(); index++) {
            repository.save(toKnowledge(dataset.get(index), index));
        }

        List<SemanticMemoryCandidate> candidates = repository.findSimilar(
                new Embedding(MODEL, MODEL_VERSION, vector(1.0f, 0.0f)));

        assertEquals(
                List.of("Como processar uma lista com streams Java",
                        "Como testar um service Java com JUnit",
                        "Como criar um indice no MongoDB"),
                candidates.stream().map(candidate -> candidate.knowledge().prompt().value()).toList());
        assertTrue(candidates.get(0).score() > candidates.get(1).score());
        assertTrue(candidates.get(1).score() > candidates.get(2).score());
        assertFalse(candidates.stream().anyMatch(candidate ->
                candidate.knowledge().status() == KnowledgeStatus.DEPRECATED));
        assertTrue(candidates.stream().allMatch(candidate ->
                candidate.knowledge().embedding().orElseThrow().model().equals(MODEL)));
        assertTrue(candidates.stream().allMatch(candidate ->
                candidate.knowledge().embedding().orElseThrow().modelVersion().equals(MODEL_VERSION)));
    }

    @Test
    void registersEveryConcurrentReuseWithoutLosingUpdates() {
        KnowledgeEntry saved = repository.save(knowledge("Reusable solution", CREATED_AT));
        int attempts = 8;
        Instant usedAt = CREATED_AT.plusSeconds(60);
        ExecutorService executor = Executors.newFixedThreadPool(attempts);
        CountDownLatch start = new CountDownLatch(1);

        try {
            List<Future<Long>> futures = IntStream.range(0, attempts)
                    .mapToObj(attempt -> executor.submit(() -> {
                        start.await();
                        return repository.registerReuse(saved.id(), usedAt)
                                .orElseThrow()
                                .usage()
                                .reuseCount();
                    }))
                    .toList();
            start.countDown();
            futures.forEach(this::completedValue);

            KnowledgeEntry reused = repository.findActiveByPromptHash(PROMPT_HASH).getFirst();
            assertEquals(attempts, reused.usage().reuseCount());
            assertEquals(usedAt, reused.usage().lastUsedAt());
        } finally {
            executor.shutdownNow();
        }
    }

    @Test
    void preservesKnowledgeAfterRepositoryRestart() {
        Embedding embedding = new Embedding(MODEL, MODEL_VERSION, vector(1.0f, 0.0f));
        KnowledgeEntry saved = repository.save(knowledge("Persistent solution", CREATED_AT));
        repository.saveEmbedding(saved.id(), embedding, CREATED_AT.plusSeconds(1)).orElseThrow();

        repository.close();
        repository = new LuceneMemoryRepository(memoryDirectory, DIMENSION, 3);

        KnowledgeEntry restored = repository.findActiveByPromptHash(PROMPT_HASH).getFirst();
        assertEquals(saved.id(), restored.id());
        assertEquals(embedding, restored.embedding().orElseThrow());
        assertEquals(saved.id(), repository.findSimilar(embedding).getFirst().knowledge().id());
    }

    @Test
    void rejectsWrongVectorDimensionAndStaleMutations() {
        KnowledgeEntry saved = repository.save(knowledge("Protected solution", CREATED_AT));

        assertThrows(IllegalArgumentException.class, () -> repository.findSimilar(
                new Embedding(MODEL, MODEL_VERSION, new float[]{1.0f, 0.0f})));
        assertTrue(repository.saveEmbedding(
                saved.id(),
                new Embedding(MODEL, MODEL_VERSION, vector(1.0f, 0.0f)),
                CREATED_AT.minusSeconds(1)).isEmpty());
        assertTrue(repository.registerReuse(saved.id(), CREATED_AT.minusSeconds(1)).isEmpty());
    }

    @Test
    void rejectsAnExistingIndexCreatedForAnotherVectorDimension() {
        repository.close();
        repository = null;

        assertThrows(LocalMemoryStorageException.class,
                () -> new LuceneMemoryRepository(memoryDirectory, 2, 3));
    }

    private KnowledgeEntry knowledge(String solution, Instant createdAt) {
        Prompt prompt = new Prompt("How do I test this?");
        return KnowledgeEntry.create(
                UUID.randomUUID(),
                prompt,
                new NormalizedPrompt(prompt.value(), 1),
                PROMPT_HASH,
                solution,
                createdAt);
    }

    private KnowledgeEntry toKnowledge(EvaluationCase evaluationCase, int index) {
        Prompt prompt = new Prompt(evaluationCase.prompt());
        KnowledgeEntry active = KnowledgeEntry.create(
                        UUID.nameUUIDFromBytes(evaluationCase.id().getBytes(StandardCharsets.UTF_8)),
                        prompt,
                        new NormalizedPrompt(prompt.value(), 1),
                        new PromptHash("%064x".formatted(index + 1), 1),
                        evaluationCase.solution(),
                        CREATED_AT.plusSeconds(index))
                .withEmbedding(
                        new Embedding(evaluationCase.model(), evaluationCase.modelVersion(),
                                vector(evaluationCase.firstCoordinate(), evaluationCase.secondCoordinate())),
                        CREATED_AT.plusSeconds(index + 10));

        if (evaluationCase.status() == KnowledgeStatus.ACTIVE) {
            return active;
        }
        return new KnowledgeEntry(
                active.id(),
                active.prompt(),
                active.normalizedPrompt(),
                active.promptHash(),
                active.solution(),
                evaluationCase.status(),
                active.usage(),
                active.technicalContext(),
                active.embedding(),
                active.createdAt(),
                active.updatedAt());
    }

    private List<EvaluationCase> loadDataset() {
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                Objects.requireNonNull(
                        getClass().getResourceAsStream("/semantic-search-evaluation.csv"),
                        "Semantic search evaluation dataset is missing"),
                StandardCharsets.UTF_8))) {
            return reader.lines()
                    .skip(1)
                    .filter(line -> !line.isBlank())
                    .map(this::parseEvaluationCase)
                    .toList();
        } catch (IOException exception) {
            throw new IllegalStateException("Could not load semantic search evaluation dataset", exception);
        }
    }

    private EvaluationCase parseEvaluationCase(String line) {
        String[] columns = line.split(",", -1);
        String[] coordinates = columns[3].split(";", -1);
        return new EvaluationCase(
                columns[0],
                columns[1],
                columns[2],
                Float.parseFloat(coordinates[0]),
                Float.parseFloat(coordinates[1]),
                KnowledgeStatus.valueOf(columns[4]),
                columns[5],
                columns[6]);
    }

    private <T> T completedValue(Future<T> future) {
        try {
            return future.get();
        } catch (Exception exception) {
            throw new IllegalStateException("Concurrent local persistence failed", exception);
        }
    }

    private float[] vector(float first, float second) {
        float[] values = new float[DIMENSION];
        values[0] = first;
        values[1] = second;
        return values;
    }

    private record EvaluationCase(
            String id,
            String prompt,
            String solution,
            float firstCoordinate,
            float secondCoordinate,
            KnowledgeStatus status,
            String model,
            String modelVersion) {
    }
}
