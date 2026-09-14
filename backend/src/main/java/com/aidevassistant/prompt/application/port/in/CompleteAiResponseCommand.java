package com.aidevassistant.prompt.application.port.in;

import com.aidevassistant.observability.application.model.AiExecutionMetrics;

import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

public record CompleteAiResponseCommand(
        UUID invocationId,
        String response,
        Optional<AiExecutionMetrics> executionMetrics) {

    public CompleteAiResponseCommand(UUID invocationId, String response) {
        this(invocationId, response, Optional.empty());
    }

    public CompleteAiResponseCommand {
        Objects.requireNonNull(invocationId, "AI invocation id must not be null");
        Objects.requireNonNull(response, "AI response must not be null");
        Objects.requireNonNull(executionMetrics, "AI execution metrics must not be null");
        if (response.isBlank()) {
            throw new IllegalArgumentException("AI response must not be blank");
        }
    }
}
