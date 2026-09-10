package com.aidevassistant.configuration;

import com.aidevassistant.memory.domain.model.SimilarityThresholds;
import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;
import java.util.Objects;

@ConfigurationProperties("memory.classification")
public final class MemoryClassificationProperties {

    private double fullThreshold = 0.90;
    private double partialThreshold = 0.70;
    private Duration maximumFullAge = Duration.ofDays(180);

    public double getFullThreshold() {
        return fullThreshold;
    }

    public void setFullThreshold(double fullThreshold) {
        this.fullThreshold = fullThreshold;
    }

    public double getPartialThreshold() {
        return partialThreshold;
    }

    public void setPartialThreshold(double partialThreshold) {
        this.partialThreshold = partialThreshold;
    }

    public Duration getMaximumFullAge() {
        return maximumFullAge;
    }

    public void setMaximumFullAge(Duration maximumFullAge) {
        this.maximumFullAge = maximumFullAge;
    }

    SimilarityThresholds validatedThresholds() {
        return new SimilarityThresholds(fullThreshold, partialThreshold);
    }

    Duration validatedMaximumFullAge() {
        Objects.requireNonNull(maximumFullAge, "Maximum full-match age must not be null");
        if (maximumFullAge.isZero() || maximumFullAge.isNegative()) {
            throw new IllegalArgumentException("Maximum full-match age must be positive");
        }
        return maximumFullAge;
    }
}
