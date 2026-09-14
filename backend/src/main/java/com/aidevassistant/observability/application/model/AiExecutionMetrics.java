package com.aidevassistant.observability.application.model;

import java.time.Duration;
import java.util.Objects;

public record AiExecutionMetrics(
        long inputTokens,
        long outputTokens,
        Duration duration) {

    public AiExecutionMetrics {
        if (inputTokens < 0) {
            throw new IllegalArgumentException("AI input tokens must not be negative");
        }
        if (outputTokens < 0) {
            throw new IllegalArgumentException("AI output tokens must not be negative");
        }
        Objects.requireNonNull(duration, "AI execution duration must not be null");
        if (duration.isNegative()) {
            throw new IllegalArgumentException("AI execution duration must not be negative");
        }
    }
}
