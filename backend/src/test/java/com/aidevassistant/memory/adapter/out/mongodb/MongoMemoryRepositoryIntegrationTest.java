package com.aidevassistant.memory.adapter.out.mongodb;

import com.aidevassistant.memory.application.port.out.MemoryRepository;
import com.aidevassistant.memory.domain.model.KnowledgeEntry;
import com.aidevassistant.prompt.domain.model.NormalizedPrompt;
import com.aidevassistant.prompt.domain.model.Prompt;
import com.aidevassistant.prompt.domain.model.PromptHash;
import com.aidevassistant.test.MongoTestConfiguration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.data.mongodb.core.MongoOperations;
import org.springframework.data.mongodb.core.index.IndexInfo;
import org.springframework.data.mongodb.core.query.Query;

import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

@SpringBootTest
@AutoConfigureMockMvc
@Import(MongoTestConfiguration.class)
class MongoMemoryRepositoryIntegrationTest {

    private static final PromptHash PROMPT_HASH = new PromptHash("b".repeat(64), 1);
    private static final Instant CREATED_AT = Instant.parse("2026-09-09T12:00:00Z");

    private final MemoryRepository repository;
    private final MongoOperations mongoOperations;

    @Autowired
    MongoMemoryRepositoryIntegrationTest(
            MemoryRepository repository,
            MongoOperations mongoOperations) {
        this.repository = repository;
        this.mongoOperations = mongoOperations;
    }

    @BeforeEach
    void removeKnowledgeDocuments() {
        mongoOperations.remove(new Query(), KnowledgeDocument.class);
    }

    @Test
    void createsRequiredIndexes() {
        Set<String> indexNames = mongoOperations.indexOps(KnowledgeDocument.class)
                .getIndexInfo()
                .stream()
                .map(IndexInfo::getName)
                .collect(Collectors.toSet());

        assertTrue(indexNames.contains(MongoMemoryIndexInitializer.EXACT_LOOKUP_INDEX));
        assertTrue(indexNames.contains(MongoMemoryIndexInitializer.DEDUPLICATION_INDEX));
        assertTrue(indexNames.contains(MongoMemoryIndexInitializer.UPDATED_AT_INDEX));
    }

    @Test
    void savesAndFindsAllActiveExactCandidates() {
        KnowledgeEntry first = repository.save(knowledge("First solution", CREATED_AT));
        KnowledgeEntry second = repository.save(knowledge("Second solution", CREATED_AT.plusSeconds(1)));

        List<KnowledgeEntry> candidates = repository.findActiveByPromptHash(PROMPT_HASH);

        assertEquals(List.of(second.id(), first.id()),
                candidates.stream().map(KnowledgeEntry::id).toList());
    }

    @Test
    void saveIsIdempotentForTheSamePromptAndSolution() {
        KnowledgeEntry first = repository.save(knowledge("Same solution", CREATED_AT));
        KnowledgeEntry duplicate = repository.save(knowledge("Same solution", CREATED_AT.plusSeconds(1)));

        assertEquals(first.id(), duplicate.id());
        assertEquals(1, mongoOperations.count(new Query(), KnowledgeDocument.class));
    }

    @Test
    void concurrentEquivalentSavesConvergeToOneDocument() throws Exception {
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
            assertEquals(1, mongoOperations.count(new Query(), KnowledgeDocument.class));
        } finally {
            executor.shutdownNow();
        }
    }

    @Test
    void registersReuseAtomically() {
        KnowledgeEntry saved = repository.save(knowledge("Reusable solution", CREATED_AT));
        Instant usedAt = CREATED_AT.plusSeconds(60);

        KnowledgeEntry reused = repository.registerReuse(saved.id(), usedAt).orElseThrow();

        assertEquals(1, reused.usage().reuseCount());
        assertEquals(usedAt, reused.usage().lastUsedAt());
        assertEquals(usedAt, reused.updatedAt());
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

    private UUID completedValue(Future<UUID> future) {
        try {
            return future.get();
        } catch (Exception exception) {
            throw new IllegalStateException("Concurrent persistence failed", exception);
        }
    }
}
