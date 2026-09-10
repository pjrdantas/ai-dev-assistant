package com.aidevassistant.memory.domain.model;

import java.time.Instant;
import java.util.Objects;

public record KnowledgeUsage(long reuseCount, Instant lastUsedAt) {

    public KnowledgeUsage {
        if (reuseCount < 0) {
            throw new IllegalArgumentException("Reuse count must not be negative");
        }
        if (reuseCount == 0 && lastUsedAt != null) {
            throw new IllegalArgumentException("Unused knowledge must not have a last usage date");
        }
        if (reuseCount > 0 && lastUsedAt == null) {
            throw new IllegalArgumentException("Reused knowledge must have a last usage date");
        }
    }

    public static KnowledgeUsage unused() {
        return new KnowledgeUsage(0, null);
    }

    public KnowledgeUsage registerAt(Instant usedAt) {
        Objects.requireNonNull(usedAt, "Usage date must not be null");
        if (lastUsedAt != null && usedAt.isBefore(lastUsedAt)) {
            throw new IllegalArgumentException("Usage date must not precede the previous usage");
        }
        return new KnowledgeUsage(Math.incrementExact(reuseCount), usedAt);
    }
}
