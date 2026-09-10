package com.aidevassistant.memory.adapter.out.mongodb;

import com.aidevassistant.memory.application.port.out.MemoryRepository;
import com.aidevassistant.memory.application.port.out.SemanticMemoryCandidate;
import com.aidevassistant.memory.domain.model.Embedding;
import com.aidevassistant.memory.domain.model.KnowledgeEntry;
import com.aidevassistant.memory.domain.model.KnowledgeStatus;
import com.aidevassistant.prompt.domain.model.NormalizedPrompt;
import com.aidevassistant.prompt.domain.model.Prompt;
import com.aidevassistant.prompt.domain.model.PromptHash;
import com.aidevassistant.test.MongoTestConfiguration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.data.mongodb.core.MongoOperations;
import org.springframework.data.mongodb.core.query.Query;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

@SpringBootTest(properties = {
        "memory.semantic-search.top-k=3",
        "memory.semantic-search.num-candidates=6"
})
@Import(MongoTestConfiguration.class)
class MongoSemanticSearchIntegrationTest {

    private static final String MODEL = "phase5-model";
    private static final String MODEL_VERSION = "revision-1";
    private static final int DIMENSION = 384;
    private static final Instant CREATED_AT = Instant.parse("2026-09-10T00:00:00Z");

    private final MemoryRepository repository;
    private final MongoOperations mongoOperations;
    private final MongoMemoryIndexInitializer indexInitializer;

    @Autowired
    MongoSemanticSearchIntegrationTest(
            MemoryRepository repository,
            MongoOperations mongoOperations,
            MongoMemoryIndexInitializer indexInitializer) {
        this.repository = repository;
        this.mongoOperations = mongoOperations;
        this.indexInitializer = indexInitializer;
    }

    @BeforeEach
    void resetDataset() {
        mongoOperations.remove(new Query(), KnowledgeDocument.class);
    }

    @Test
    void vectorIndexIsReadyBeforeSemanticQueries() {
        assertTrue(indexInitializer.isVectorIndexReady());
    }

    @Test
    void ranksCandidatesAndAppliesLifecycleAndEmbeddingIdentificationFilters() {
        List<EvaluationCase> dataset = loadDataset();
        for (int index = 0; index < dataset.size(); index++) {
            repository.save(toKnowledge(dataset.get(index), index));
        }

        List<SemanticMemoryCandidate> candidates = awaitIndexedCandidates(
                new Embedding(MODEL, MODEL_VERSION, vector(1.0f, 0.0f)),
                3,
                Duration.ofSeconds(30));

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
                active.embedding(),
                active.createdAt(),
                active.updatedAt());
    }

    private List<SemanticMemoryCandidate> awaitIndexedCandidates(
            Embedding query,
            int expectedCount,
            Duration timeout) {
        Instant deadline = Instant.now().plus(timeout);
        List<SemanticMemoryCandidate> candidates = List.of();
        while (Instant.now().isBefore(deadline)) {
            candidates = repository.findSimilar(query);
            if (candidates.size() == expectedCount) {
                return candidates;
            }
            try {
                Thread.sleep(250);
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException("Interrupted while waiting for indexed documents", exception);
            }
        }
        return candidates;
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
