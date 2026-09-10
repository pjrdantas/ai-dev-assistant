package com.aidevassistant.memory.domain.model;

public record SimilarityScore(double value) {

    public SimilarityScore {
        if (!Double.isFinite(value) || value < 0.0 || value > 1.0) {
            throw new IllegalArgumentException("Similarity score must be between zero and one");
        }
    }

    public boolean isAtLeast(double threshold) {
        return value >= threshold;
    }
}
