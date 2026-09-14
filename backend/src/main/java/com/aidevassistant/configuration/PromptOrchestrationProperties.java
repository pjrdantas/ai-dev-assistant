package com.aidevassistant.configuration;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;
import java.util.Objects;

@ConfigurationProperties("prompt.orchestration")
public record PromptOrchestrationProperties(
        Duration invocationLifetime,
        int maxExternalInputCharacters) {

    public PromptOrchestrationProperties {
        Objects.requireNonNull(invocationLifetime, "AI invocation lifetime must not be null");
        if (invocationLifetime.isZero() || invocationLifetime.isNegative()) {
            throw new IllegalArgumentException("AI invocation lifetime must be positive");
        }
        if (maxExternalInputCharacters <= 0) {
            throw new IllegalArgumentException("Maximum external input characters must be positive");
        }
    }
}
