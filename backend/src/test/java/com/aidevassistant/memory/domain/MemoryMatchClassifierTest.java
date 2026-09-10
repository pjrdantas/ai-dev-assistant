package com.aidevassistant.memory.domain;

import com.aidevassistant.memory.domain.model.CompatibilityLevel;
import com.aidevassistant.memory.domain.model.KnowledgeEntry;
import com.aidevassistant.memory.domain.model.KnowledgeStatus;
import com.aidevassistant.memory.domain.model.MatchType;
import com.aidevassistant.memory.domain.model.MemoryMatch;
import com.aidevassistant.memory.domain.model.SimilarityScore;
import com.aidevassistant.memory.domain.model.SimilarityThresholds;
import com.aidevassistant.memory.domain.policy.KnowledgeCompatibilityPolicy;
import com.aidevassistant.memory.domain.policy.MemoryMatchClassifier;
import com.aidevassistant.projectcontext.domain.model.TechnicalContext;
import com.aidevassistant.prompt.domain.model.NormalizedPrompt;
import com.aidevassistant.prompt.domain.model.Prompt;
import com.aidevassistant.prompt.domain.model.PromptHash;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;

class MemoryMatchClassifierTest {

    private static final Instant EVALUATED_AT = Instant.parse("2026-09-10T12:00:00Z");
    private static final Instant RECENT_UPDATE = EVALUATED_AT.minus(Duration.ofDays(30));
    private static final Duration MAXIMUM_FULL_AGE = Duration.ofDays(180);

    private final MemoryMatchClassifier classifier = new MemoryMatchClassifier(
            new SimilarityThresholds(0.90, 0.70),
            MAXIMUM_FULL_AGE,
            new KnowledgeCompatibilityPolicy());

    @Test
    void classifiesHighSimilarityAndCompatibleContextAsFull() {
        TechnicalContext context = context("spring-boot", "3.5.0", "code");

        MemoryMatch match = classify(0.96, context, knowledge(context, RECENT_UPDATE));

        assertEquals(MatchType.FULL, match.type());
        assertEquals(CompatibilityLevel.COMPATIBLE, match.compatibility().level());
    }

    @Test
    void classifiesIntermediateSimilarityAsPartial() {
        TechnicalContext context = context("spring-boot", "3.5.0", "code");

        MemoryMatch match = classify(0.80, context, knowledge(context, RECENT_UPDATE));

        assertEquals(MatchType.PARTIAL, match.type());
    }

    @Test
    void classifiesSimilarityBelowPartialThresholdAsNone() {
        TechnicalContext context = context("spring-boot", "3.5.0", "code");

        MemoryMatch match = classify(0.69, context, knowledge(context, RECENT_UPDATE));

        assertEquals(MatchType.NONE, match.type());
    }

    @Test
    void majorFrameworkVersionConflictPreventsFullMatch() {
        TechnicalContext current = context("spring-boot", "3.5.0", "code");
        TechnicalContext stored = context("spring-boot", "2.7.18", "code");

        MemoryMatch match = classify(0.99, current, knowledge(stored, RECENT_UPDATE));

        assertEquals(MatchType.NONE, match.type());
        assertEquals(CompatibilityLevel.INCOMPATIBLE, match.compatibility().level());
        assertFalse(match.compatibility().reasons().isEmpty());
    }

    @Test
    void differentMinorVersionRequiresAdaptationEvenWithHighSimilarity() {
        TechnicalContext current = context("spring-boot", "3.5.0", "code");
        TechnicalContext stored = context("spring-boot", "3.2.0", "code");

        MemoryMatch match = classify(0.96, current, knowledge(stored, RECENT_UPDATE));

        assertEquals(MatchType.PARTIAL, match.type());
        assertEquals(CompatibilityLevel.ADAPTABLE, match.compatibility().level());
    }

    @Test
    void differentTaskTypeIsIncompatible() {
        TechnicalContext current = context("java", "21", "test");
        TechnicalContext stored = context("java", "21", "documentation");

        MemoryMatch match = classify(0.99, current, knowledge(stored, RECENT_UPDATE));

        assertEquals(MatchType.NONE, match.type());
        assertEquals(CompatibilityLevel.INCOMPATIBLE, match.compatibility().level());
    }

    @Test
    void contextsWithoutSharedTechnologyAreIncompatible() {
        TechnicalContext current = context("java", "21", "code");
        TechnicalContext stored = context("angular", "20", "code");

        MemoryMatch match = classify(0.99, current, knowledge(stored, RECENT_UPDATE));

        assertEquals(MatchType.NONE, match.type());
        assertEquals(CompatibilityLevel.INCOMPATIBLE, match.compatibility().level());
    }

    @Test
    void missingTechnicalContextCannotProduceFullMatch() {
        TechnicalContext current = context("java", "21", "test");

        MemoryMatch match = classify(0.99, current, knowledge(TechnicalContext.empty(), RECENT_UPDATE));

        assertEquals(MatchType.PARTIAL, match.type());
        assertEquals(CompatibilityLevel.ADAPTABLE, match.compatibility().level());
    }

    @Test
    void staleKnowledgeCannotProduceFullMatch() {
        TechnicalContext context = context("java", "21", "test");
        Instant staleUpdate = EVALUATED_AT.minus(MAXIMUM_FULL_AGE).minusSeconds(1);

        MemoryMatch match = classify(0.99, context, knowledge(context, staleUpdate));

        assertEquals(MatchType.PARTIAL, match.type());
        assertEquals(CompatibilityLevel.ADAPTABLE, match.compatibility().level());
    }

    @Test
    void inactiveKnowledgeIsIncompatible() {
        TechnicalContext context = context("java", "21", "test");
        KnowledgeEntry active = knowledge(context, RECENT_UPDATE);
        KnowledgeEntry deprecated = new KnowledgeEntry(
                active.id(),
                active.prompt(),
                active.normalizedPrompt(),
                active.promptHash(),
                active.solution(),
                KnowledgeStatus.DEPRECATED,
                active.usage(),
                active.technicalContext(),
                active.embedding(),
                active.createdAt(),
                active.updatedAt());

        MemoryMatch match = classify(0.99, context, deprecated);

        assertEquals(MatchType.NONE, match.type());
        assertEquals(CompatibilityLevel.INCOMPATIBLE, match.compatibility().level());
    }

    @Test
    void rejectsScoresOutsideNormalizedRange() {
        assertThrows(IllegalArgumentException.class, () -> new SimilarityScore(1.01));
        assertThrows(IllegalArgumentException.class, () -> new SimilarityScore(-0.01));
    }

    @Test
    void rejectsOverlappingThresholds() {
        assertThrows(IllegalArgumentException.class, () -> new SimilarityThresholds(0.80, 0.80));
    }

    private MemoryMatch classify(double score, TechnicalContext current, KnowledgeEntry candidate) {
        return classifier.classify(candidate, new SimilarityScore(score), current, EVALUATED_AT);
    }

    private KnowledgeEntry knowledge(TechnicalContext context, Instant updatedAt) {
        Prompt prompt = new Prompt("Como atualizar o projeto?");
        return KnowledgeEntry.create(
                UUID.randomUUID(),
                prompt,
                new NormalizedPrompt(prompt.value(), 1),
                new PromptHash("a".repeat(64), 1),
                "Atualize de forma incremental.",
                context,
                updatedAt);
    }

    private TechnicalContext context(String technology, String version, String taskType) {
        return new TechnicalContext(
                Set.of(technology),
                Map.of(technology, version),
                Optional.of(taskType));
    }
}
