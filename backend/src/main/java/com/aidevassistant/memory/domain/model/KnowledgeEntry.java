package com.aidevassistant.memory.domain.model;

import com.aidevassistant.prompt.domain.model.NormalizedPrompt;
import com.aidevassistant.prompt.domain.model.Prompt;
import com.aidevassistant.prompt.domain.model.PromptHash;
import com.aidevassistant.projectcontext.domain.model.TechnicalContext;

import java.time.Instant;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

public record KnowledgeEntry(
        UUID id,
        Prompt prompt,
        NormalizedPrompt normalizedPrompt,
        PromptHash promptHash,
        String solution,
        KnowledgeStatus status,
        KnowledgeUsage usage,
        TechnicalContext technicalContext,
        Optional<Embedding> embedding,
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
        Objects.requireNonNull(technicalContext, "Technical context must not be null");
        Objects.requireNonNull(embedding, "Embedding must not be null");
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
                TechnicalContext.empty(),
                Optional.empty(),
                createdAt,
                createdAt);
    }

    public static KnowledgeEntry create(
            UUID id,
            Prompt prompt,
            NormalizedPrompt normalizedPrompt,
            PromptHash promptHash,
            String solution,
            TechnicalContext technicalContext,
            Instant createdAt) {
        return new KnowledgeEntry(
                id,
                prompt,
                normalizedPrompt,
                promptHash,
                solution,
                KnowledgeStatus.ACTIVE,
                KnowledgeUsage.unused(),
                technicalContext,
                Optional.empty(),
                createdAt,
                createdAt);
    }

    public KnowledgeEntry withTechnicalContext(TechnicalContext context, Instant changedAt) {
        Objects.requireNonNull(context, "Technical context must not be null");
        Objects.requireNonNull(changedAt, "Technical context change date must not be null");
        if (changedAt.isBefore(updatedAt)) {
            throw new IllegalArgumentException("Technical context change date must not precede the last update");
        }
        return new KnowledgeEntry(
                id,
                prompt,
                normalizedPrompt,
                promptHash,
                solution,
                status,
                usage,
                context,
                embedding,
                createdAt,
                changedAt);
    }

    public KnowledgeEntry withEmbedding(Embedding generatedEmbedding, Instant generatedAt) {
        Objects.requireNonNull(generatedEmbedding, "Generated embedding must not be null");
        Objects.requireNonNull(generatedAt, "Embedding generation date must not be null");
        if (generatedAt.isBefore(updatedAt)) {
            throw new IllegalArgumentException("Embedding generation date must not precede the last update");
        }
        return new KnowledgeEntry(
                id,
                prompt,
                normalizedPrompt,
                promptHash,
                solution,
                status,
                usage,
                technicalContext,
                Optional.of(generatedEmbedding),
                createdAt,
                generatedAt);
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
                technicalContext,
                embedding,
                createdAt,
                usedAt);
    }
}
