package com.aidevassistant.memory.domain.policy;

import com.aidevassistant.memory.domain.model.CompatibilityAssessment;
import com.aidevassistant.memory.domain.model.CompatibilityLevel;
import com.aidevassistant.memory.domain.model.KnowledgeEntry;
import com.aidevassistant.memory.domain.model.MatchType;
import com.aidevassistant.memory.domain.model.MemoryMatch;
import com.aidevassistant.memory.domain.model.SimilarityScore;
import com.aidevassistant.memory.domain.model.SimilarityThresholds;
import com.aidevassistant.projectcontext.domain.model.TechnicalContext;

import java.time.Duration;
import java.time.Instant;
import java.util.Objects;

public final class MemoryMatchClassifier {

    private final SimilarityThresholds thresholds;
    private final Duration maximumFullAge;
    private final KnowledgeCompatibilityPolicy compatibilityPolicy;

    public MemoryMatchClassifier(
            SimilarityThresholds thresholds,
            Duration maximumFullAge,
            KnowledgeCompatibilityPolicy compatibilityPolicy) {
        this.thresholds = Objects.requireNonNull(thresholds, "Similarity thresholds must not be null");
        this.maximumFullAge = Objects.requireNonNull(maximumFullAge, "Maximum full-match age must not be null");
        this.compatibilityPolicy = Objects.requireNonNull(
                compatibilityPolicy,
                "Knowledge compatibility policy must not be null");
        if (maximumFullAge.isZero() || maximumFullAge.isNegative()) {
            throw new IllegalArgumentException("Maximum full-match age must be positive");
        }
    }

    public MemoryMatch classify(
            KnowledgeEntry candidate,
            SimilarityScore similarity,
            TechnicalContext currentContext,
            Instant evaluatedAt) {
        Objects.requireNonNull(candidate, "Knowledge candidate must not be null");
        Objects.requireNonNull(similarity, "Similarity score must not be null");
        Objects.requireNonNull(currentContext, "Current technical context must not be null");
        Objects.requireNonNull(evaluatedAt, "Classification date must not be null");
        CompatibilityAssessment compatibility = compatibilityPolicy.assess(
                currentContext,
                candidate,
                evaluatedAt,
                maximumFullAge);

        MatchType type;
        if (compatibility.level() == CompatibilityLevel.INCOMPATIBLE) {
            type = MatchType.NONE;
        } else if (similarity.isAtLeast(thresholds.full())
                && compatibility.level() == CompatibilityLevel.COMPATIBLE) {
            type = MatchType.FULL;
        } else if (similarity.isAtLeast(thresholds.partial())) {
            type = MatchType.PARTIAL;
        } else {
            type = MatchType.NONE;
        }

        return new MemoryMatch(candidate, similarity, compatibility, type);
    }
}
