package com.aidevassistant.prompt.domain.model;

import com.aidevassistant.memory.domain.model.MatchType;
import com.aidevassistant.memory.domain.model.MemoryMatch;

import java.util.Objects;
import java.util.Optional;

public record ResolutionPlan(MatchType type, Optional<MemoryMatch> memoryMatch) {

    public ResolutionPlan {
        Objects.requireNonNull(type, "Resolution type must not be null");
        Objects.requireNonNull(memoryMatch, "Memory match must not be null");
        if (type == MatchType.NONE && memoryMatch.isPresent()) {
            throw new IllegalArgumentException("None resolution must not contain reusable memory");
        }
        if (type != MatchType.NONE && memoryMatch.isEmpty()) {
            throw new IllegalArgumentException("Local resolution requires a memory match");
        }
        if (memoryMatch.isPresent() && memoryMatch.orElseThrow().type() != type) {
            throw new IllegalArgumentException("Resolution type must match the selected memory classification");
        }
    }

    public static ResolutionPlan from(MemoryMatch memoryMatch) {
        Objects.requireNonNull(memoryMatch, "Memory match must not be null");
        if (memoryMatch.type() == MatchType.NONE) {
            return none();
        }
        return new ResolutionPlan(memoryMatch.type(), Optional.of(memoryMatch));
    }

    public static ResolutionPlan none() {
        return new ResolutionPlan(MatchType.NONE, Optional.empty());
    }
}
