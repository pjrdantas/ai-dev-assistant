package com.aidevassistant.prompt.domain.model;

import java.util.Objects;

public record NormalizedPrompt(String value, int normalizationVersion) {

    public NormalizedPrompt {
        Objects.requireNonNull(value, "Normalized prompt value must not be null");
        if (value.isBlank()) {
            throw new IllegalArgumentException("Normalized prompt value must not be blank");
        }
        if (value.indexOf('\r') >= 0) {
            throw new IllegalArgumentException("Normalized prompt must use LF line endings");
        }
        if (normalizationVersion < 1) {
            throw new IllegalArgumentException("Normalization version must be positive");
        }
    }
}
