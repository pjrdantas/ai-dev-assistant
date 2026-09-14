package com.aidevassistant.prompt.adapter.in.rest;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

public record CompleteAiResponseRequest(
        @NotBlank @Size(max = 200_000) String response,
        @Valid AiExecutionMetricsInput executionMetrics) {

    public record AiExecutionMetricsInput(
            @NotNull @PositiveOrZero @Max(10_000_000) Long inputTokens,
            @NotNull @PositiveOrZero @Max(10_000_000) Long outputTokens,
            @NotNull @PositiveOrZero @Max(600_000) Long durationMs) {
    }
}
