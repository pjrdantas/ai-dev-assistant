package com.aidevassistant.memory.domain.model;

import com.aidevassistant.prompt.domain.model.NormalizedPrompt;
import com.aidevassistant.prompt.domain.model.Prompt;
import com.aidevassistant.prompt.domain.model.PromptHash;

import java.util.Objects;
import java.util.UUID;

public record KnowledgeEntry(
        UUID id,
        Prompt prompt,
        NormalizedPrompt normalizedPrompt,
        PromptHash promptHash,
        String solution,
        KnowledgeStatus status) {

    public KnowledgeEntry {
        Objects.requireNonNull(id, "Knowledge id must not be null");
        Objects.requireNonNull(prompt, "Prompt must not be null");
        Objects.requireNonNull(normalizedPrompt, "Normalized prompt must not be null");
        Objects.requireNonNull(promptHash, "Prompt hash must not be null");
        Objects.requireNonNull(solution, "Solution must not be null");
        Objects.requireNonNull(status, "Knowledge status must not be null");

        if (solution.isBlank()) {
            throw new IllegalArgumentException("Solution must not be blank");
        }
        if (normalizedPrompt.normalizationVersion() != promptHash.normalizationVersion()) {
            throw new IllegalArgumentException("Prompt hash must use the normalized prompt version");
        }
    }
}
