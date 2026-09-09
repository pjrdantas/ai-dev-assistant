package com.aidevassistant.prompt.domain.model;

import java.util.Objects;

public record Prompt(String value) {

    public Prompt {
        Objects.requireNonNull(value, "Prompt value must not be null");
        if (value.isBlank()) {
            throw new IllegalArgumentException("Prompt value must not be blank");
        }
    }
}
