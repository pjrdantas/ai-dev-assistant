package com.aidevassistant.prompt.domain.model;

import java.util.Objects;
import java.util.regex.Pattern;

public record PromptHash(String value, int normalizationVersion) {

    public static final String ALGORITHM = "SHA-256";

    private static final Pattern LOWERCASE_SHA_256 = Pattern.compile("[0-9a-f]{64}");

    public PromptHash {
        Objects.requireNonNull(value, "Prompt hash value must not be null");
        if (!LOWERCASE_SHA_256.matcher(value).matches()) {
            throw new IllegalArgumentException("Prompt hash must be a lowercase SHA-256 value");
        }
        if (normalizationVersion < 1) {
            throw new IllegalArgumentException("Normalization version must be positive");
        }
    }
}
