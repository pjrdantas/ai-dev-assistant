package com.aidevassistant.prompt.application.model;

import com.aidevassistant.memory.domain.model.MatchType;
import com.aidevassistant.projectcontext.domain.model.TechnicalContext;
import com.aidevassistant.prompt.domain.model.Prompt;

import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

public record ExternalAiRequest(
        UUID invocationId,
        Prompt prompt,
        TechnicalContext technicalContext,
        MatchType matchType,
        Optional<Double> similarity,
        Optional<String> reusableSolution,
        List<String> requiredAdaptations,
        Instant expiresAt) {

    public ExternalAiRequest {
        Objects.requireNonNull(invocationId, "AI invocation id must not be null");
        Objects.requireNonNull(prompt, "Prompt must not be null");
        Objects.requireNonNull(technicalContext, "Technical context must not be null");
        Objects.requireNonNull(matchType, "Match type must not be null");
        Objects.requireNonNull(similarity, "Similarity must not be null");
        Objects.requireNonNull(reusableSolution, "Reusable solution must not be null");
        Objects.requireNonNull(requiredAdaptations, "Required adaptations must not be null");
        Objects.requireNonNull(expiresAt, "AI invocation expiration must not be null");
        requiredAdaptations = List.copyOf(requiredAdaptations);

        boolean partial = matchType == MatchType.PARTIAL
                && similarity.isPresent() && reusableSolution.isPresent();
        boolean none = matchType == MatchType.NONE
                && similarity.isEmpty() && reusableSolution.isEmpty() && requiredAdaptations.isEmpty();
        if (!partial && !none) {
            throw new IllegalArgumentException("External AI request metadata is inconsistent");
        }
        similarity.ifPresent(value -> {
            if (!Double.isFinite(value) || value < 0.0 || value > 1.0) {
                throw new IllegalArgumentException("Similarity must be between zero and one");
            }
        });
        reusableSolution.ifPresent(solution -> requireText(solution, "Reusable solution must not be blank"));
    }

    public static ExternalAiRequest partial(
            UUID invocationId, Prompt prompt, TechnicalContext technicalContext,
            double similarity, String reusableSolution, List<String> requiredAdaptations,
            Instant expiresAt) {
        return new ExternalAiRequest(
                invocationId, prompt, technicalContext, MatchType.PARTIAL,
                Optional.of(similarity), Optional.of(reusableSolution), requiredAdaptations, expiresAt);
    }

    public static ExternalAiRequest withoutMemory(
            UUID invocationId, Prompt prompt, TechnicalContext technicalContext, Instant expiresAt) {
        return new ExternalAiRequest(
                invocationId, prompt, technicalContext, MatchType.NONE,
                Optional.empty(), Optional.empty(), List.of(), expiresAt);
    }

    private static String requireText(String value, String message) {
        Objects.requireNonNull(value, message);
        if (value.isBlank()) {
            throw new IllegalArgumentException(message);
        }
        return value;
    }
}
