package com.aidevassistant.memory.domain.model;

import com.aidevassistant.prompt.domain.model.NormalizedPrompt;
import com.aidevassistant.prompt.domain.model.Prompt;
import com.aidevassistant.prompt.domain.model.PromptHash;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

public record KnowledgeEntry(
        UUID id,
        Prompt prompt,
        NormalizedPrompt normalizedPrompt,
        PromptHash promptHash,
        String solution,
        KnowledgeStatus status,
        KnowledgeUsage usage,
        Instant createdAt,
        Instant updatedAt) {

    public KnowledgeEntry {
        Objects.requireNonNull(id, "Knowledge id must not be null");
        Objects.requireNonNull(prompt, "Prompt must not be null");
        Objects.requireNonNull(normalizedPrompt, "Normalized prompt must not be null");
        Objects.requireNonNull(promptHash, "Prompt hash must not be null");
        Objects.requireNonNull(solution, "Solution must not be null");
        Objects.requireNonNull(status, "Knowledge status must not be null");
        Objects.requireNonNull(usage, "Knowledge usage must not be null");
        Objects.requireNonNull(createdAt, "Creation date must not be null");
        Objects.requireNonNull(updatedAt, "Update date must not be null");

        if (solution.isBlank()) {
            throw new IllegalArgumentException("Solution must not be blank");
        }
        if (normalizedPrompt.normalizationVersion() != promptHash.normalizationVersion()) {
            throw new IllegalArgumentException("Prompt hash must use the normalized prompt version");
        }
        if (updatedAt.isBefore(createdAt)) {
            throw new IllegalArgumentException("Update date must not precede creation date");
        }
        if (usage.lastUsedAt() != null && usage.lastUsedAt().isBefore(createdAt)) {
            throw new IllegalArgumentException("Last usage date must not precede creation date");
        }
    }

    public static KnowledgeEntry create(
            UUID id,
            Prompt prompt,
            NormalizedPrompt normalizedPrompt,
            PromptHash promptHash,
            String solution,
            Instant createdAt) {
        return new KnowledgeEntry(
                id,
                prompt,
                normalizedPrompt,
                promptHash,
                solution,
                KnowledgeStatus.ACTIVE,
                KnowledgeUsage.unused(),
                createdAt,
                createdAt);
    }

    public KnowledgeEntry registerReuse(Instant usedAt) {
        Objects.requireNonNull(usedAt, "Usage date must not be null");
        if (usedAt.isBefore(updatedAt)) {
            throw new IllegalArgumentException("Usage date must not precede the last update");
        }
        return new KnowledgeEntry(
                id,
                prompt,
                normalizedPrompt,
                promptHash,
                solution,
                status,
                usage.registerAt(usedAt),
                createdAt,
                usedAt);
    }
}
