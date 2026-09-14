package com.aidevassistant.prompt.application;

import com.aidevassistant.memory.application.port.out.EmbeddingProvider;
import com.aidevassistant.memory.application.port.out.MemoryRepository;
import com.aidevassistant.memory.application.port.out.SemanticMemoryCandidate;
import com.aidevassistant.memory.domain.model.Embedding;
import com.aidevassistant.memory.domain.model.KnowledgeEntry;
import com.aidevassistant.memory.domain.model.MatchType;
import com.aidevassistant.memory.domain.model.SimilarityThresholds;
import com.aidevassistant.memory.domain.policy.KnowledgeCompatibilityPolicy;
import com.aidevassistant.memory.domain.policy.MemoryMatchClassifier;
import com.aidevassistant.observability.application.model.AiExecutionMetrics;
import com.aidevassistant.observability.application.model.MemoryLookupSource;
import com.aidevassistant.observability.application.port.out.PromptMetricsRecorder;
import com.aidevassistant.projectcontext.domain.model.TechnicalContext;
import com.aidevassistant.prompt.application.exception.AiInvocationException;
import com.aidevassistant.prompt.application.exception.MemoryPersistenceException;
import com.aidevassistant.prompt.application.exception.MemoryUnavailableException;
import com.aidevassistant.prompt.application.exception.SensitiveContentException;
import com.aidevassistant.prompt.application.model.ExternalAiRequest;
import com.aidevassistant.prompt.application.model.PromptProcessingResult;
import com.aidevassistant.prompt.application.port.in.CompleteAiResponseCommand;
import com.aidevassistant.prompt.application.port.in.ProcessPromptCommand;
import com.aidevassistant.prompt.application.service.PromptOrchestrator;
import com.aidevassistant.prompt.domain.model.AssistantResponse;
import com.aidevassistant.prompt.domain.model.NormalizedPrompt;
import com.aidevassistant.prompt.domain.model.Prompt;
import com.aidevassistant.prompt.domain.model.PromptHash;
import com.aidevassistant.prompt.domain.model.ResponseSource;
import com.aidevassistant.prompt.domain.policy.ConservativePromptNormalizer;
import com.aidevassistant.prompt.domain.policy.Sha256PromptHasher;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class PromptOrchestratorTest {

    private static final Instant NOW = Instant.parse("2026-09-10T12:00:00Z");
    private static final Prompt PROMPT = new Prompt("Como criar um endpoint Spring Boot?");
    private static final TechnicalContext CURRENT_CONTEXT = context("spring-boot", "3.5.0", "code");
    private static final ProcessPromptCommand COMMAND = new ProcessPromptCommand(PROMPT, CURRENT_CONTEXT);
    private static final Embedding QUERY_EMBEDDING = new Embedding(
            "multilingual-minilm", "1", new float[]{0.5f, 0.5f});

    @Mock
    private MemoryRepository memoryRepository;

    @Mock
    private EmbeddingProvider embeddingProvider;

    @Mock
    private PromptMetricsRecorder metricsRecorder;

    private PromptOrchestrator orchestrator;

    @BeforeEach
    void setUp() {
        MemoryMatchClassifier classifier = new MemoryMatchClassifier(
                new SimilarityThresholds(0.90, 0.70),
                Duration.ofDays(180),
                new KnowledgeCompatibilityPolicy());
        orchestrator = new PromptOrchestrator(
                new ConservativePromptNormalizer(),
                new Sha256PromptHasher(),
                memoryRepository,
                embeddingProvider,
                classifier,
                metricsRecorder,
                Clock.fixed(NOW, ZoneOffset.UTC),
                Duration.ofMinutes(5),
                20_000);
    }

    @Test
    void exactFullMatchRespondsLocallyBeforeGeneratingAnEmbedding() {
        KnowledgeEntry candidate = knowledge(CURRENT_CONTEXT, "Use @RestController.");
        when(memoryRepository.findActiveByPromptHash(any())).thenReturn(List.of(candidate));
        when(memoryRepository.registerReuse(candidate.id(), NOW))
                .thenReturn(Optional.of(candidate.registerReuse(NOW)));

        AssistantResponse response = completed(orchestrator.process(COMMAND));

        assertEquals(ResponseSource.LOCAL_MEMORY, response.source());
        assertEquals("Use @RestController.", response.response());
        assertFalse(response.aiCalled());
        verifyNoInteractions(embeddingProvider);
        verify(memoryRepository, never()).findSimilar(any());
        verify(memoryRepository, never()).save(any());
        verify(metricsRecorder).recordMemoryMatch(MemoryLookupSource.EXACT, MatchType.FULL, 1.0);
        verify(metricsRecorder).recordLocalResponse(anyLong());
    }

    @Test
    void semanticFullMatchRespondsLocallyWithoutPreparingAnExternalRequest() {
        KnowledgeEntry candidate = knowledge(CURRENT_CONTEXT, "Use a focused controller.");
        when(memoryRepository.findActiveByPromptHash(any())).thenReturn(List.of());
        when(embeddingProvider.generate(any())).thenReturn(QUERY_EMBEDDING);
        when(memoryRepository.findSimilar(QUERY_EMBEDDING))
                .thenReturn(List.of(new SemanticMemoryCandidate(candidate, 0.95)));
        when(memoryRepository.registerReuse(candidate.id(), NOW))
                .thenReturn(Optional.of(candidate.registerReuse(NOW)));

        PromptProcessingResult result = orchestrator.process(COMMAND);

        assertEquals(ResponseSource.LOCAL_MEMORY, completed(result).source());
        assertTrue(result.externalAiRequest().isEmpty());
        verify(memoryRepository, never()).save(any());
        verify(metricsRecorder)
                .recordMemoryMatch(MemoryLookupSource.SEMANTIC, MatchType.FULL, 0.95);
    }

    @Test
    void exactPartialCandidateDoesNotPreventSemanticFullResolution() {
        KnowledgeEntry exactPartial = knowledge(
                context("spring-boot", "3.2.0", "code"), "Adapt this older solution.");
        KnowledgeEntry semanticFull = knowledge(CURRENT_CONTEXT, "Use the compatible solution.");
        when(memoryRepository.findActiveByPromptHash(any())).thenReturn(List.of(exactPartial));
        when(embeddingProvider.generate(any())).thenReturn(QUERY_EMBEDDING);
        when(memoryRepository.findSimilar(QUERY_EMBEDDING))
                .thenReturn(List.of(new SemanticMemoryCandidate(semanticFull, 0.95)));
        when(memoryRepository.registerReuse(semanticFull.id(), NOW))
                .thenReturn(Optional.of(semanticFull.registerReuse(NOW)));

        AssistantResponse response = completed(orchestrator.process(COMMAND));

        assertEquals("Use the compatible solution.", response.response());
        assertEquals(Optional.of(semanticFull.id()), response.memoryId());
    }

    @Test
    void partialMatchPreparesMinimalRequestAndPersistsOnlyAfterCompletion() {
        KnowledgeEntry candidate = knowledge(
                context("spring-boot", "3.2.0", "code"),
                "Reuse the existing endpoint pattern.");
        arrangePartial(candidate, 0.96);
        when(memoryRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        ExternalAiRequest request = pending(orchestrator.process(COMMAND));

        assertEquals(MatchType.PARTIAL, request.matchType());
        assertEquals(Optional.of(candidate.solution()), request.reusableSolution());
        assertFalse(request.requiredAdaptations().isEmpty());
        verify(memoryRepository, never()).save(any());

        AiExecutionMetrics executionMetrics = new AiExecutionMetrics(
                120, 40, Duration.ofMillis(800));
        AssistantResponse response = orchestrator.complete(new CompleteAiResponseCommand(
                request.invocationId(), "Adapted solution.", Optional.of(executionMetrics)));

        assertEquals(ResponseSource.LOCAL_MEMORY_AND_AI, response.source());
        assertTrue(response.aiCalled());
        ArgumentCaptor<KnowledgeEntry> persisted = ArgumentCaptor.forClass(KnowledgeEntry.class);
        verify(memoryRepository).save(persisted.capture());
        assertEquals("Adapted solution.", persisted.getValue().solution());
        assertEquals(Optional.of(QUERY_EMBEDDING), persisted.getValue().embedding());
        verify(metricsRecorder).recordAiInvocationAuthorized(MatchType.PARTIAL);
        verify(metricsRecorder).recordAiCall(
                MatchType.PARTIAL, Optional.of(executionMetrics));
        verify(metricsRecorder).recordAiInvocationCompleted(MatchType.PARTIAL);
    }

    @Test
    void noneMatchPreparesRequestOnlyAfterCompleteMemoryLookup() {
        arrangeNoMatch();

        ExternalAiRequest request = pending(orchestrator.process(COMMAND));

        assertEquals(MatchType.NONE, request.matchType());
        assertTrue(request.reusableSolution().isEmpty());
        assertTrue(request.requiredAdaptations().isEmpty());
        InOrder order = inOrder(memoryRepository, embeddingProvider);
        order.verify(memoryRepository).findActiveByPromptHash(any());
        order.verify(embeddingProvider).generate(any());
        order.verify(memoryRepository).findSimilar(QUERY_EMBEDDING);
        verify(memoryRepository, never()).save(any());
    }

    @Test
    void completingNoneMatchPersistsAndReturnsFinalResponse() {
        arrangeNoMatch();
        when(memoryRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        ExternalAiRequest request = pending(orchestrator.process(COMMAND));

        AssistantResponse response = orchestrator.complete(
                new CompleteAiResponseCommand(request.invocationId(), "New solution."));

        assertEquals(ResponseSource.AI, response.source());
        assertEquals(MatchType.NONE, response.matchType());
        assertTrue(response.aiCalled());
        assertTrue(response.memoryId().isPresent());
    }

    @Test
    void repeatedCompletionWithSameResponseIsIdempotent() {
        arrangeNoMatch();
        when(memoryRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        ExternalAiRequest request = pending(orchestrator.process(COMMAND));
        CompleteAiResponseCommand completion =
                new CompleteAiResponseCommand(request.invocationId(), "New solution.");

        AssistantResponse first = orchestrator.complete(completion);
        AssistantResponse repeated = orchestrator.complete(completion);

        assertEquals(first, repeated);
        verify(memoryRepository).save(any());
        verify(metricsRecorder, times(1)).recordAiCall(MatchType.NONE, Optional.empty());
        verify(metricsRecorder, times(1)).recordAiInvocationCompleted(MatchType.NONE);
    }

    @Test
    void completedInvocationRejectsADifferentResponse() {
        arrangeNoMatch();
        when(memoryRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        ExternalAiRequest request = pending(orchestrator.process(COMMAND));
        orchestrator.complete(new CompleteAiResponseCommand(request.invocationId(), "First response."));

        assertThrows(
                AiInvocationException.class,
                () -> orchestrator.complete(
                        new CompleteAiResponseCommand(request.invocationId(), "Different response.")));
    }

    @Test
    void unknownInvocationCannotSubmitAnExternalResponse() {
        assertThrows(
                AiInvocationException.class,
                () -> orchestrator.complete(
                        new CompleteAiResponseCommand(UUID.randomUUID(), "Unsolicited response.")));
        verifyNoInteractions(memoryRepository, embeddingProvider);
    }

    @Test
    void expiredInvocationCannotSubmitAnExternalResponse() {
        Clock advancingClock = mock(Clock.class);
        when(advancingClock.instant())
                .thenReturn(NOW, NOW.plus(Duration.ofMinutes(6)));
        orchestrator = new PromptOrchestrator(
                new ConservativePromptNormalizer(),
                new Sha256PromptHasher(),
                memoryRepository,
                embeddingProvider,
                new MemoryMatchClassifier(
                        new SimilarityThresholds(0.90, 0.70),
                        Duration.ofDays(180),
                        new KnowledgeCompatibilityPolicy()),
                metricsRecorder,
                advancingClock,
                Duration.ofMinutes(5),
                20_000);
        arrangeNoMatch();
        ExternalAiRequest request = pending(orchestrator.process(COMMAND));

        assertThrows(
                AiInvocationException.class,
                () -> orchestrator.complete(
                        new CompleteAiResponseCommand(request.invocationId(), "Late response.")));

        verify(memoryRepository, never()).save(any());
    }

    @Test
    void memoryFailuresNeverProduceAnExternalRequest() {
        when(memoryRepository.findActiveByPromptHash(any()))
                .thenThrow(new IllegalStateException("index unavailable"));

        assertThrows(MemoryUnavailableException.class, () -> orchestrator.process(COMMAND));

        verifyNoInteractions(embeddingProvider);
        verify(memoryRepository, never()).save(any());
    }

    @Test
    void partialReuseFailureNeverProducesAnExternalRequest() {
        KnowledgeEntry candidate = knowledge(
                context("spring-boot", "3.2.0", "code"), "Reuse this pattern.");
        when(memoryRepository.findActiveByPromptHash(any())).thenReturn(List.of());
        when(embeddingProvider.generate(any())).thenReturn(QUERY_EMBEDDING);
        when(memoryRepository.findSimilar(QUERY_EMBEDDING))
                .thenReturn(List.of(new SemanticMemoryCandidate(candidate, 0.96)));
        when(memoryRepository.registerReuse(candidate.id(), NOW)).thenReturn(Optional.empty());

        assertThrows(MemoryUnavailableException.class, () -> orchestrator.process(COMMAND));
        verify(memoryRepository, never()).save(any());
    }

    @Test
    void sensitiveContentIsBlockedOnlyAfterTheLocalLookupCompletes() {
        ProcessPromptCommand sensitiveCommand = new ProcessPromptCommand(
                new Prompt("Corrija api_key=" + "a".repeat(16)), CURRENT_CONTEXT);
        arrangeNoMatch();

        assertThrows(SensitiveContentException.class, () -> orchestrator.process(sensitiveCommand));

        verify(memoryRepository).findSimilar(QUERY_EMBEDDING);
        verify(memoryRepository, never()).save(any());
    }

    @Test
    void externalInputLimitIsEnforcedAfterTheLocalLookup() {
        orchestrator = orchestratorWithMaximumInput(10);
        ProcessPromptCommand longCommand = new ProcessPromptCommand(
                new Prompt("A sufficiently long request"), TechnicalContext.empty());
        arrangeNoMatch();

        assertThrows(AiInvocationException.class, () -> orchestrator.process(longCommand));
        verify(memoryRepository).findSimilar(QUERY_EMBEDDING);
    }

    @Test
    void persistenceFailureKeepsTheInvocationAvailableForRetry() {
        arrangeNoMatch();
        when(memoryRepository.save(any()))
                .thenThrow(new IllegalStateException("disk unavailable"))
                .thenAnswer(invocation -> invocation.getArgument(0));
        ExternalAiRequest request = pending(orchestrator.process(COMMAND));
        CompleteAiResponseCommand completion =
                new CompleteAiResponseCommand(request.invocationId(), "New solution.");

        assertThrows(MemoryPersistenceException.class, () -> orchestrator.complete(completion));
        AssistantResponse retried = orchestrator.complete(completion);

        assertEquals("New solution.", retried.response());
        verify(memoryRepository, org.mockito.Mockito.times(2)).save(any());
        verify(metricsRecorder, times(1)).recordAiCall(MatchType.NONE, Optional.empty());
        verify(metricsRecorder, times(1)).recordAiInvocationCompleted(MatchType.NONE);
    }

    @Test
    void metricsFailureNeverChangesTheMemoryFirstOutcome() {
        KnowledgeEntry candidate = knowledge(CURRENT_CONTEXT, "Use @RestController.");
        when(memoryRepository.findActiveByPromptHash(any())).thenReturn(List.of(candidate));
        when(memoryRepository.registerReuse(candidate.id(), NOW))
                .thenReturn(Optional.of(candidate.registerReuse(NOW)));
        doThrow(new IllegalStateException("metrics unavailable"))
                .when(metricsRecorder).recordPrompt();

        AssistantResponse response = completed(orchestrator.process(COMMAND));

        assertEquals(ResponseSource.LOCAL_MEMORY, response.source());
        verifyNoInteractions(embeddingProvider);
    }

    private void arrangePartial(KnowledgeEntry candidate, double score) {
        when(memoryRepository.findActiveByPromptHash(any())).thenReturn(List.of());
        when(embeddingProvider.generate(any())).thenReturn(QUERY_EMBEDDING);
        when(memoryRepository.findSimilar(QUERY_EMBEDDING))
                .thenReturn(List.of(new SemanticMemoryCandidate(candidate, score)));
        when(memoryRepository.registerReuse(eq(candidate.id()), eq(NOW)))
                .thenReturn(Optional.of(candidate.registerReuse(NOW)));
    }

    private void arrangeNoMatch() {
        when(memoryRepository.findActiveByPromptHash(any())).thenReturn(List.of());
        when(embeddingProvider.generate(any())).thenReturn(QUERY_EMBEDDING);
        when(memoryRepository.findSimilar(QUERY_EMBEDDING)).thenReturn(List.of());
    }

    private PromptOrchestrator orchestratorWithMaximumInput(int maximumInput) {
        return new PromptOrchestrator(
                new ConservativePromptNormalizer(),
                new Sha256PromptHasher(),
                memoryRepository,
                embeddingProvider,
                new MemoryMatchClassifier(
                        new SimilarityThresholds(0.90, 0.70),
                        Duration.ofDays(180),
                        new KnowledgeCompatibilityPolicy()),
                metricsRecorder,
                Clock.fixed(NOW, ZoneOffset.UTC),
                Duration.ofMinutes(5),
                maximumInput);
    }

    private static AssistantResponse completed(PromptProcessingResult result) {
        return result.completedResponse().orElseThrow();
    }

    private static ExternalAiRequest pending(PromptProcessingResult result) {
        return result.externalAiRequest().orElseThrow();
    }

    private static KnowledgeEntry knowledge(TechnicalContext context, String solution) {
        ConservativePromptNormalizer normalizer = new ConservativePromptNormalizer();
        NormalizedPrompt normalizedPrompt = normalizer.normalize(PROMPT);
        PromptHash hash = new Sha256PromptHasher().hash(normalizedPrompt);
        return KnowledgeEntry.create(
                UUID.randomUUID(), PROMPT, normalizedPrompt, hash,
                solution, context, NOW.minus(Duration.ofDays(30)));
    }

    private static TechnicalContext context(String technology, String version, String taskType) {
        return new TechnicalContext(
                Set.of(technology), Map.of(technology, version), Optional.of(taskType));
    }
}
