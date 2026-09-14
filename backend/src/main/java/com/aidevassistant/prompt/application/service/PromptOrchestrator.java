package com.aidevassistant.prompt.application.service;

import com.aidevassistant.memory.application.port.out.EmbeddingProvider;
import com.aidevassistant.memory.application.port.out.MemoryRepository;
import com.aidevassistant.memory.application.port.out.SemanticMemoryCandidate;
import com.aidevassistant.memory.domain.model.Embedding;
import com.aidevassistant.memory.domain.model.KnowledgeEntry;
import com.aidevassistant.memory.domain.model.MatchType;
import com.aidevassistant.memory.domain.model.MemoryMatch;
import com.aidevassistant.memory.domain.model.SimilarityScore;
import com.aidevassistant.memory.domain.policy.MemoryMatchClassifier;
import com.aidevassistant.observability.application.model.MemoryLookupSource;
import com.aidevassistant.observability.application.model.PromptProcessingStage;
import com.aidevassistant.observability.application.port.out.PromptMetricsRecorder;
import com.aidevassistant.prompt.application.exception.AiInvocationException;
import com.aidevassistant.prompt.application.exception.MemoryPersistenceException;
import com.aidevassistant.prompt.application.exception.MemoryUnavailableException;
import com.aidevassistant.prompt.application.exception.SensitiveContentException;
import com.aidevassistant.prompt.application.model.ExternalAiRequest;
import com.aidevassistant.prompt.application.model.PromptProcessingResult;
import com.aidevassistant.prompt.application.port.in.CompleteAiResponseCommand;
import com.aidevassistant.prompt.application.port.in.CompleteAiResponseUseCase;
import com.aidevassistant.prompt.application.port.in.ProcessPromptCommand;
import com.aidevassistant.prompt.application.port.in.ProcessPromptUseCase;
import com.aidevassistant.prompt.domain.model.AssistantResponse;
import com.aidevassistant.prompt.domain.model.NormalizedPrompt;
import com.aidevassistant.prompt.domain.model.PromptHash;
import com.aidevassistant.prompt.domain.model.ResolutionPlan;
import com.aidevassistant.prompt.domain.policy.ConservativePromptNormalizer;
import com.aidevassistant.prompt.domain.policy.Sha256PromptHasher;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;
import java.util.function.Supplier;

public final class PromptOrchestrator implements ProcessPromptUseCase, CompleteAiResponseUseCase {

    private static final SimilarityScore EXACT_SIMILARITY = new SimilarityScore(1.0);
    private static final List<Pattern> SENSITIVE_PATTERNS = List.of(
            Pattern.compile("\\bsk-[A-Za-z0-9_-]{16,}\\b"),
            Pattern.compile("\\bAKIA[0-9A-Z]{16}\\b"),
            Pattern.compile("-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----"),
            Pattern.compile("(?i)\\bauthorization\\s*:\\s*bearer\\s+\\S{8,}"),
            Pattern.compile(
                    "(?i)(?:api[ _-]?key|access[ _-]?token|auth[ _-]?token|token|password|"
                            + "secret(?:[ _-]?access)?[ _-]?key)\\s*[:=]\\s*[\"']?\\S{8,}"));

    private final ConservativePromptNormalizer normalizer;
    private final Sha256PromptHasher hasher;
    private final MemoryRepository memoryRepository;
    private final EmbeddingProvider embeddingProvider;
    private final MemoryMatchClassifier matchClassifier;
    private final PromptMetricsRecorder metricsRecorder;
    private final Clock clock;
    private final Duration invocationLifetime;
    private final int maxExternalInputCharacters;
    private final Map<UUID, PendingAiInvocation> pendingInvocations = new ConcurrentHashMap<>();
    private final Map<UUID, CompletedAiInvocation> completedInvocations = new ConcurrentHashMap<>();
    private final Set<UUID> observedAiCalls = ConcurrentHashMap.newKeySet();

    public PromptOrchestrator(
            ConservativePromptNormalizer normalizer,
            Sha256PromptHasher hasher,
            MemoryRepository memoryRepository,
            EmbeddingProvider embeddingProvider,
            MemoryMatchClassifier matchClassifier,
            PromptMetricsRecorder metricsRecorder,
            Clock clock,
            Duration invocationLifetime,
            int maxExternalInputCharacters) {
        this.normalizer = Objects.requireNonNull(normalizer, "Prompt normalizer must not be null");
        this.hasher = Objects.requireNonNull(hasher, "Prompt hasher must not be null");
        this.memoryRepository = Objects.requireNonNull(memoryRepository, "Memory repository must not be null");
        this.embeddingProvider = Objects.requireNonNull(embeddingProvider, "Embedding provider must not be null");
        this.matchClassifier = Objects.requireNonNull(matchClassifier, "Memory match classifier must not be null");
        this.metricsRecorder = Objects.requireNonNull(metricsRecorder, "Metrics recorder must not be null");
        this.clock = Objects.requireNonNull(clock, "Clock must not be null");
        this.invocationLifetime = requirePositive(invocationLifetime, "AI invocation lifetime");
        if (maxExternalInputCharacters <= 0) {
            throw new IllegalArgumentException("Maximum external input characters must be positive");
        }
        this.maxExternalInputCharacters = maxExternalInputCharacters;
    }

    @Override
    public PromptProcessingResult process(ProcessPromptCommand command) {
        Objects.requireNonNull(command, "Process prompt command must not be null");
        recordMetric(metricsRecorder::recordPrompt);
        return measure(
                PromptProcessingStage.PROMPT_PROCESSING,
                () -> processAfterValidation(command));
    }

    private PromptProcessingResult processAfterValidation(ProcessPromptCommand command) {
        NormalizedPrompt normalizedPrompt = measure(
                PromptProcessingStage.NORMALIZATION,
                () -> normalizer.normalize(command.prompt()));
        PromptHash promptHash = hasher.hash(normalizedPrompt);
        Instant evaluatedAt = clock.instant();
        removeExpiredInvocations(evaluatedAt);

        LocalResolution localResolution = resolveFromMemory(
                command, normalizedPrompt, promptHash, evaluatedAt);
        localResolution.plan().memoryMatch().ifPresent(match -> recordMetric(
                () -> metricsRecorder.recordMemoryMatch(
                        localResolution.source(), match.type(), match.similarity().value())));
        return switch (localResolution.plan().type()) {
            case FULL -> {
                AssistantResponse response = respondFromMemory(localResolution.plan(), evaluatedAt);
                recordMetric(() -> metricsRecorder.recordLocalResponse(
                        estimateTokensSaved(command, response.response())));
                yield PromptProcessingResult.completed(response);
            }
            case PARTIAL -> preparePartialInvocation(
                    command, normalizedPrompt, promptHash, localResolution, evaluatedAt);
            case NONE -> prepareInvocationWithoutMemory(
                    command, normalizedPrompt, promptHash, localResolution, evaluatedAt);
        };
    }

    @Override
    public synchronized AssistantResponse complete(CompleteAiResponseCommand command) {
        Objects.requireNonNull(command, "Complete AI response command must not be null");
        return measure(
                PromptProcessingStage.AI_COMPLETION,
                () -> completeAfterValidation(command));
    }

    private AssistantResponse completeAfterValidation(CompleteAiResponseCommand command) {
        Instant completedAt = clock.instant();
        removeExpiredInvocations(completedAt);

        CompletedAiInvocation completed = completedInvocations.get(command.invocationId());
        if (completed != null) {
            if (!completed.externalResponse().equals(command.response())) {
                throw new AiInvocationException(
                        AiInvocationException.Reason.MISMATCH,
                        "AI invocation was already completed with a different response");
            }
            return completed.assistantResponse();
        }

        PendingAiInvocation pending = pendingInvocations.get(command.invocationId());
        if (pending == null) {
            throw new AiInvocationException(
                    AiInvocationException.Reason.UNKNOWN_OR_EXPIRED,
                    "AI invocation is unknown or expired");
        }

        if (observedAiCalls.add(command.invocationId())) {
            recordMetric(() -> metricsRecorder.recordAiCall(
                    pending.matchType(), command.executionMetrics()));
        }

        KnowledgeEntry persisted = persistGeneratedKnowledge(pending, command.response(), completedAt);
        AssistantResponse response = pending.matchType() == MatchType.PARTIAL
                ? AssistantResponse.fromMemoryAndAi(
                        command.response(), pending.similarity().orElseThrow(), persisted.id())
                : AssistantResponse.fromAi(command.response(), persisted.id());

        pendingInvocations.remove(command.invocationId(), pending);
        completedInvocations.put(
                command.invocationId(),
                new CompletedAiInvocation(
                        command.response(), response, completedAt.plus(invocationLifetime)));
        recordMetric(() -> metricsRecorder.recordAiInvocationCompleted(pending.matchType()));
        return response;
    }

    private LocalResolution resolveFromMemory(
            ProcessPromptCommand command,
            NormalizedPrompt normalizedPrompt,
            PromptHash promptHash,
            Instant evaluatedAt) {
        try {
            SelectedResolution bestResolution = SelectedResolution.none();
            Set<UUID> evaluatedKnowledge = new HashSet<>();

            List<KnowledgeEntry> exactCandidates = measure(
                    PromptProcessingStage.EXACT_MEMORY_LOOKUP,
                    () -> List.copyOf(memoryRepository.findActiveByPromptHash(promptHash)));
            for (KnowledgeEntry candidate : exactCandidates) {
                evaluatedKnowledge.add(candidate.id());
                MemoryMatch match = matchClassifier.classify(
                        candidate, EXACT_SIMILARITY, command.technicalContext(), evaluatedAt);
                if (match.type() == MatchType.FULL) {
                    return new LocalResolution(
                            ResolutionPlan.from(match), Optional.empty(), MemoryLookupSource.EXACT);
                }
                bestResolution = preferReusableMatch(
                        bestResolution, match, MemoryLookupSource.EXACT);
            }

            Embedding queryEmbedding = measure(
                    PromptProcessingStage.EMBEDDING,
                    () -> Objects.requireNonNull(
                            embeddingProvider.generate(normalizedPrompt),
                            "Embedding provider returned no embedding"));
            List<SemanticMemoryCandidate> semanticCandidates = measure(
                    PromptProcessingStage.SEMANTIC_MEMORY_LOOKUP,
                    () -> List.copyOf(memoryRepository.findSimilar(queryEmbedding)));
            for (SemanticMemoryCandidate candidate : semanticCandidates) {
                if (!evaluatedKnowledge.add(candidate.knowledge().id())) {
                    continue;
                }
                MemoryMatch match = matchClassifier.classify(
                        candidate.knowledge(),
                        new SimilarityScore(candidate.score()),
                        command.technicalContext(),
                        evaluatedAt);
                if (match.type() == MatchType.FULL) {
                    return new LocalResolution(
                            ResolutionPlan.from(match),
                            Optional.of(queryEmbedding),
                            MemoryLookupSource.SEMANTIC);
                }
                bestResolution = preferReusableMatch(
                        bestResolution, match, MemoryLookupSource.SEMANTIC);
            }
            return new LocalResolution(
                    bestResolution.plan(),
                    Optional.of(queryEmbedding),
                    bestResolution.source());
        } catch (MemoryUnavailableException exception) {
            throw exception;
        } catch (RuntimeException exception) {
            throw new MemoryUnavailableException(
                    "The required local memory lookup could not be completed", exception);
        }
    }

    private SelectedResolution preferReusableMatch(
            SelectedResolution current,
            MemoryMatch candidate,
            MemoryLookupSource source) {
        if (candidate.type() != MatchType.PARTIAL) {
            return current;
        }
        if (current.plan().type() == MatchType.NONE) {
            return new SelectedResolution(ResolutionPlan.from(candidate), source);
        }
        double currentSimilarity = current.plan().memoryMatch().orElseThrow().similarity().value();
        return candidate.similarity().value() > currentSimilarity
                ? new SelectedResolution(ResolutionPlan.from(candidate), source)
                : current;
    }

    private AssistantResponse respondFromMemory(ResolutionPlan plan, Instant usedAt) {
        MemoryMatch match = plan.memoryMatch().orElseThrow();
        KnowledgeEntry reused = registerReuse(match, usedAt);
        return AssistantResponse.fromLocalMemory(
                reused.solution(), match.similarity().value(), reused.id());
    }

    private PromptProcessingResult preparePartialInvocation(
            ProcessPromptCommand command,
            NormalizedPrompt normalizedPrompt,
            PromptHash promptHash,
            LocalResolution localResolution,
            Instant preparedAt) {
        MemoryMatch match = localResolution.plan().memoryMatch().orElseThrow();
        assertSafeExternalContent(
                command, Optional.of(match.knowledge().solution()), match.compatibility().reasons());
        KnowledgeEntry reused = registerReuse(match, preparedAt);
        UUID invocationId = UUID.randomUUID();
        Instant expiresAt = preparedAt.plus(invocationLifetime);
        ExternalAiRequest request = ExternalAiRequest.partial(
                invocationId, command.prompt(), command.technicalContext(),
                match.similarity().value(), reused.solution(),
                match.compatibility().reasons(), expiresAt);
        pendingInvocations.put(
                invocationId,
                new PendingAiInvocation(
                        command, normalizedPrompt, promptHash,
                        localResolution.requiredEmbedding(), MatchType.PARTIAL,
                        Optional.of(match.similarity().value()), expiresAt));
        recordMetric(() -> metricsRecorder.recordAiInvocationAuthorized(MatchType.PARTIAL));
        return PromptProcessingResult.pending(request);
    }

    private PromptProcessingResult prepareInvocationWithoutMemory(
            ProcessPromptCommand command,
            NormalizedPrompt normalizedPrompt,
            PromptHash promptHash,
            LocalResolution localResolution,
            Instant preparedAt) {
        assertSafeExternalContent(command, Optional.empty(), List.of());
        UUID invocationId = UUID.randomUUID();
        Instant expiresAt = preparedAt.plus(invocationLifetime);
        ExternalAiRequest request = ExternalAiRequest.withoutMemory(
                invocationId, command.prompt(), command.technicalContext(), expiresAt);
        pendingInvocations.put(
                invocationId,
                new PendingAiInvocation(
                        command, normalizedPrompt, promptHash,
                        localResolution.requiredEmbedding(), MatchType.NONE,
                        Optional.empty(), expiresAt));
        recordMetric(() -> metricsRecorder.recordAiInvocationAuthorized(MatchType.NONE));
        return PromptProcessingResult.pending(request);
    }

    private KnowledgeEntry registerReuse(MemoryMatch match, Instant usedAt) {
        try {
            return measure(
                    PromptProcessingStage.MEMORY_PERSISTENCE,
                    () -> memoryRepository.registerReuse(match.knowledge().id(), usedAt)
                            .orElseThrow(() -> new MemoryUnavailableException(
                                    "The selected local knowledge could not be registered as reused")));
        } catch (MemoryUnavailableException exception) {
            throw exception;
        } catch (RuntimeException exception) {
            throw new MemoryUnavailableException(
                    "The selected local knowledge could not be registered as reused", exception);
        }
    }

    private KnowledgeEntry persistGeneratedKnowledge(
            PendingAiInvocation pending, String externalResponse, Instant persistedAt) {
        KnowledgeEntry generatedKnowledge = KnowledgeEntry.create(
                        UUID.randomUUID(), pending.command().prompt(), pending.normalizedPrompt(),
                        pending.promptHash(), externalResponse,
                        pending.command().technicalContext(), persistedAt)
                .withEmbedding(pending.embedding(), persistedAt);
        try {
            return measure(
                    PromptProcessingStage.MEMORY_PERSISTENCE,
                    () -> Objects.requireNonNull(
                            memoryRepository.save(generatedKnowledge),
                            "Memory repository returned no persisted knowledge"));
        } catch (RuntimeException exception) {
            throw new MemoryPersistenceException(
                    "The generated response could not be persisted in local memory", exception);
        }
    }

    private void assertSafeExternalContent(
            ProcessPromptCommand command,
            Optional<String> reusableSolution,
            List<String> requiredAdaptations) {
        List<String> externalContent = new ArrayList<>();
        externalContent.add(command.prompt().value());
        reusableSolution.ifPresent(externalContent::add);
        externalContent.addAll(requiredAdaptations);
        externalContent.addAll(command.technicalContext().technologies());
        externalContent.addAll(command.technicalContext().versions().values());
        command.technicalContext().taskType().ifPresent(externalContent::add);

        boolean sensitive = externalContent.stream()
                .anyMatch(content -> SENSITIVE_PATTERNS.stream()
                        .anyMatch(pattern -> pattern.matcher(content).find()));
        if (sensitive) {
            throw new SensitiveContentException(
                    "Potentially sensitive content was blocked before the external AI call");
        }
        if (externalContent.stream().mapToInt(String::length).sum() > maxExternalInputCharacters) {
            throw new AiInvocationException(
                    "The minimized external AI input exceeds the configured limit");
        }
    }

    private void removeExpiredInvocations(Instant now) {
        pendingInvocations.entrySet().removeIf(entry -> !entry.getValue().expiresAt().isAfter(now));
        completedInvocations.entrySet().removeIf(entry -> !entry.getValue().expiresAt().isAfter(now));
        observedAiCalls.removeIf(invocationId ->
                !pendingInvocations.containsKey(invocationId)
                        && !completedInvocations.containsKey(invocationId));
    }

    private long estimateTokensSaved(ProcessPromptCommand command, String response) {
        long characters = command.prompt().value().length() + response.length();
        characters += command.technicalContext().technologies().stream()
                .mapToLong(String::length)
                .sum();
        characters += command.technicalContext().versions().entrySet().stream()
                .mapToLong(entry -> entry.getKey().length() + entry.getValue().length())
                .sum();
        characters += command.technicalContext().taskType()
                .map(String::length)
                .orElse(0);
        return Math.max(1, (characters + 3) / 4);
    }

    private <T> T measure(PromptProcessingStage stage, Supplier<T> operation) {
        long startedAt = System.nanoTime();
        try {
            return operation.get();
        } finally {
            Duration duration = Duration.ofNanos(Math.max(0, System.nanoTime() - startedAt));
            recordMetric(() -> metricsRecorder.recordStageDuration(stage, duration));
        }
    }

    private void recordMetric(Runnable observation) {
        try {
            observation.run();
        } catch (RuntimeException ignored) {
            // Observability is best-effort and must never change the memory-first outcome.
        }
    }

    private static Duration requirePositive(Duration value, String name) {
        Objects.requireNonNull(value, name + " must not be null");
        if (value.isZero() || value.isNegative()) {
            throw new IllegalArgumentException(name + " must be positive");
        }
        return value;
    }

    private record LocalResolution(
            ResolutionPlan plan,
            Optional<Embedding> queryEmbedding,
            MemoryLookupSource source) {
        private LocalResolution {
            Objects.requireNonNull(plan, "Resolution plan must not be null");
            Objects.requireNonNull(queryEmbedding, "Query embedding must not be null");
            Objects.requireNonNull(source, "Memory lookup source must not be null");
            if (plan.type() != MatchType.FULL && queryEmbedding.isEmpty()) {
                throw new IllegalArgumentException("External resolution requires a query embedding");
            }
            if ((plan.type() == MatchType.NONE) != (source == MemoryLookupSource.NONE)) {
                throw new IllegalArgumentException("Memory lookup source must match the resolution plan");
            }
        }

        private Embedding requiredEmbedding() {
            return queryEmbedding.orElseThrow();
        }
    }

    private record SelectedResolution(ResolutionPlan plan, MemoryLookupSource source) {
        private SelectedResolution {
            Objects.requireNonNull(plan, "Resolution plan must not be null");
            Objects.requireNonNull(source, "Memory lookup source must not be null");
        }

        private static SelectedResolution none() {
            return new SelectedResolution(ResolutionPlan.none(), MemoryLookupSource.NONE);
        }
    }

    private record PendingAiInvocation(
            ProcessPromptCommand command,
            NormalizedPrompt normalizedPrompt,
            PromptHash promptHash,
            Embedding embedding,
            MatchType matchType,
            Optional<Double> similarity,
            Instant expiresAt) {
    }

    private record CompletedAiInvocation(
            String externalResponse,
            AssistantResponse assistantResponse,
            Instant expiresAt) {
    }
}
