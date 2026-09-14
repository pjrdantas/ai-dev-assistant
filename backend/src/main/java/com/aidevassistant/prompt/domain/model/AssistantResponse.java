package com.aidevassistant.prompt.domain.model;

import com.aidevassistant.memory.domain.model.MatchType;

import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

public record AssistantResponse(
        String response,
        ResponseSource source,
        MatchType matchType,
        Optional<Double> similarity,
        boolean aiCalled,
        boolean externalSearchCalled,
        Optional<UUID> memoryId) {

    public AssistantResponse {
        response = requireText(response, "Assistant response must not be blank");
        Objects.requireNonNull(source, "Response source must not be null");
        Objects.requireNonNull(matchType, "Match type must not be null");
        Objects.requireNonNull(similarity, "Similarity must not be null");
        Objects.requireNonNull(memoryId, "Memory id must not be null");
        similarity.ifPresent(value -> {
            if (!Double.isFinite(value) || value < 0.0 || value > 1.0) {
                throw new IllegalArgumentException("Similarity must be between zero and one");
            }
        });
        validateOrigin(source, matchType, similarity, aiCalled, externalSearchCalled, memoryId);
    }

    public static AssistantResponse fromLocalMemory(String response, double similarity, UUID memoryId) {
        return new AssistantResponse(
                response, ResponseSource.LOCAL_MEMORY, MatchType.FULL,
                Optional.of(similarity), false, false, Optional.of(memoryId));
    }

    public static AssistantResponse fromMemoryAndAi(String response, double similarity, UUID memoryId) {
        return new AssistantResponse(
                response, ResponseSource.LOCAL_MEMORY_AND_AI, MatchType.PARTIAL,
                Optional.of(similarity), true, false, Optional.of(memoryId));
    }

    public static AssistantResponse fromAi(String response, UUID memoryId) {
        return new AssistantResponse(
                response, ResponseSource.AI, MatchType.NONE,
                Optional.empty(), true, false, Optional.of(memoryId));
    }

    private static void validateOrigin(
            ResponseSource source,
            MatchType matchType,
            Optional<Double> similarity,
            boolean aiCalled,
            boolean externalSearchCalled,
            Optional<UUID> memoryId) {
        if (externalSearchCalled) {
            throw new IllegalArgumentException("External search is disabled in the MVP");
        }
        if (memoryId.isEmpty()) {
            throw new IllegalArgumentException("Successful response must identify its memory entry");
        }
        boolean local = source == ResponseSource.LOCAL_MEMORY
                && matchType == MatchType.FULL && !aiCalled && similarity.isPresent();
        boolean partial = source == ResponseSource.LOCAL_MEMORY_AND_AI
                && matchType == MatchType.PARTIAL && aiCalled && similarity.isPresent();
        boolean external = source == ResponseSource.AI
                && matchType == MatchType.NONE && aiCalled && similarity.isEmpty();
        if (!local && !partial && !external) {
            throw new IllegalArgumentException("Response origin metadata is inconsistent");
        }
    }

    private static String requireText(String value, String message) {
        Objects.requireNonNull(value, message);
        if (value.isBlank()) {
            throw new IllegalArgumentException(message);
        }
        return value;
    }
}
