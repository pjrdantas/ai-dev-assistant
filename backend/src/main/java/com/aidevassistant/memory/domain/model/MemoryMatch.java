package com.aidevassistant.memory.domain.model;

import java.util.Objects;

public record MemoryMatch(
        KnowledgeEntry knowledge,
        SimilarityScore similarity,
        CompatibilityAssessment compatibility,
        MatchType type) {

    public MemoryMatch {
        Objects.requireNonNull(knowledge, "Knowledge entry must not be null");
        Objects.requireNonNull(similarity, "Similarity score must not be null");
        Objects.requireNonNull(compatibility, "Compatibility assessment must not be null");
        Objects.requireNonNull(type, "Match type must not be null");
        if (type == MatchType.FULL && compatibility.level() != CompatibilityLevel.COMPATIBLE) {
            throw new IllegalArgumentException("Full match requires compatible technical context");
        }
    }
}
