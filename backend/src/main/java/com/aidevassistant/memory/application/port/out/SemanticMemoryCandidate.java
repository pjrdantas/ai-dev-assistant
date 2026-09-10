package com.aidevassistant.memory.application.port.out;

import com.aidevassistant.memory.domain.model.KnowledgeEntry;

import java.util.Objects;

public record SemanticMemoryCandidate(KnowledgeEntry knowledge, double score) {

    public SemanticMemoryCandidate {
        Objects.requireNonNull(knowledge, "Knowledge entry must not be null");
        if (!Double.isFinite(score)) {
            throw new IllegalArgumentException("Semantic search score must be finite");
        }
    }
}
