package com.aidevassistant.memory.domain;

import com.aidevassistant.memory.domain.model.Embedding;
import com.aidevassistant.memory.domain.model.KnowledgeEntry;
import com.aidevassistant.memory.domain.model.KnowledgeStatus;
import com.aidevassistant.prompt.domain.model.NormalizedPrompt;
import com.aidevassistant.prompt.domain.model.Prompt;
import com.aidevassistant.prompt.domain.model.PromptHash;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class MemoryDomainTest {

    private static final String VALID_HASH = "a".repeat(64);
    private static final Instant CREATED_AT = Instant.parse("2026-09-09T12:00:00Z");

    @Test
    void createsActiveReusableKnowledge() {
        KnowledgeEntry entry = knowledgeEntry(new PromptHash(VALID_HASH, 1), "Use a focused unit test.");

        assertEquals(KnowledgeStatus.ACTIVE, entry.status());
        assertTrue(entry.embedding().isEmpty());
    }

    @Test
    void knowledgeRejectsHashFromAnotherNormalizationVersion() {
        assertThrows(IllegalArgumentException.class,
                () -> knowledgeEntry(new PromptHash(VALID_HASH, 2), "Use a focused unit test."));
    }

    @Test
    void knowledgeRejectsBlankSolution() {
        assertThrows(IllegalArgumentException.class,
                () -> knowledgeEntry(new PromptHash(VALID_HASH, 1), "  "));
    }

    @Test
    void knowledgeRegistersReuseWithoutMutatingOriginalEntry() {
        KnowledgeEntry original = knowledgeEntry(
                new PromptHash(VALID_HASH, 1),
                "Use a focused unit test.");
        Instant usedAt = CREATED_AT.plusSeconds(60);

        KnowledgeEntry reused = original.registerReuse(usedAt);

        assertEquals(0, original.usage().reuseCount());
        assertEquals(1, reused.usage().reuseCount());
        assertEquals(usedAt, reused.usage().lastUsedAt());
        assertEquals(usedAt, reused.updatedAt());
    }

    @Test
    void embeddingProtectsVectorFromExternalMutation() {
        float[] values = {0.1f, 0.2f};
        Embedding embedding = new Embedding("model", "1", values);

        values[0] = 9.0f;
        float[] returnedValues = embedding.values();
        returnedValues[1] = 9.0f;

        assertArrayEquals(new float[]{0.1f, 0.2f}, embedding.values());
        assertEquals(2, embedding.dimension());
    }

    @Test
    void embeddingRejectsInvalidValues() {
        assertThrows(IllegalArgumentException.class,
                () -> new Embedding("model", "1", new float[]{Float.NaN}));
        assertThrows(IllegalArgumentException.class,
                () -> new Embedding("model", "1", new float[]{}));
    }

    @Test
    void knowledgeReceivesEmbeddingWithoutMutatingOriginalEntry() {
        KnowledgeEntry original = knowledgeEntry(
                new PromptHash(VALID_HASH, 1),
                "Use a focused unit test.");
        Embedding embedding = new Embedding("model", "1", new float[]{0.1f, 0.2f});
        Instant generatedAt = CREATED_AT.plusSeconds(30);

        KnowledgeEntry vectorized = original.withEmbedding(embedding, generatedAt);

        assertTrue(original.embedding().isEmpty());
        assertEquals(embedding, vectorized.embedding().orElseThrow());
        assertEquals(generatedAt, vectorized.updatedAt());
    }

    @Test
    void knowledgeRejectsEmbeddingGeneratedBeforeLastUpdate() {
        KnowledgeEntry original = knowledgeEntry(
                new PromptHash(VALID_HASH, 1),
                "Use a focused unit test.");

        assertThrows(IllegalArgumentException.class, () -> original.withEmbedding(
                new Embedding("model", "1", new float[]{0.1f, 0.2f}),
                CREATED_AT.minusSeconds(1)));
    }

    private KnowledgeEntry knowledgeEntry(PromptHash hash, String solution) {
        Prompt prompt = new Prompt("How do I test this?");
        return KnowledgeEntry.create(
                UUID.randomUUID(),
                prompt,
                new NormalizedPrompt(prompt.value(), 1),
                hash,
                solution,
                CREATED_AT);
    }
}
