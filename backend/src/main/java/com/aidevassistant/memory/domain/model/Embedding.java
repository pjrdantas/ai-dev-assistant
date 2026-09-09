package com.aidevassistant.memory.domain.model;

import java.util.Arrays;
import java.util.Objects;

public final class Embedding {

    private final String model;
    private final String modelVersion;
    private final float[] values;

    public Embedding(String model, String modelVersion, float[] values) {
        this.model = requireText(model, "Embedding model must not be blank");
        this.modelVersion = requireText(modelVersion, "Embedding model version must not be blank");
        Objects.requireNonNull(values, "Embedding values must not be null");
        if (values.length == 0) {
            throw new IllegalArgumentException("Embedding values must not be empty");
        }
        for (float value : values) {
            if (!Float.isFinite(value)) {
                throw new IllegalArgumentException("Embedding values must be finite");
            }
        }
        this.values = values.clone();
    }

    public String model() {
        return model;
    }

    public String modelVersion() {
        return modelVersion;
    }

    public int dimension() {
        return values.length;
    }

    public float[] values() {
        return values.clone();
    }

    @Override
    public boolean equals(Object other) {
        if (this == other) {
            return true;
        }
        if (!(other instanceof Embedding embedding)) {
            return false;
        }
        return model.equals(embedding.model)
                && modelVersion.equals(embedding.modelVersion)
                && Arrays.equals(values, embedding.values);
    }

    @Override
    public int hashCode() {
        int result = Objects.hash(model, modelVersion);
        return 31 * result + Arrays.hashCode(values);
    }

    private static String requireText(String value, String message) {
        Objects.requireNonNull(value, message);
        if (value.isBlank()) {
            throw new IllegalArgumentException(message);
        }
        return value;
    }
}
