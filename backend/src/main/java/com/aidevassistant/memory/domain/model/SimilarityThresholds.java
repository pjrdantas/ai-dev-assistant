package com.aidevassistant.memory.domain.model;

public record SimilarityThresholds(double full, double partial) {

    public SimilarityThresholds {
        if (!Double.isFinite(full) || full <= 0.0 || full > 1.0) {
            throw new IllegalArgumentException("Full similarity threshold must be greater than zero and at most one");
        }
        if (!Double.isFinite(partial) || partial < 0.0 || partial >= full) {
            throw new IllegalArgumentException(
                    "Partial similarity threshold must be non-negative and lower than the full threshold");
        }
    }
}
