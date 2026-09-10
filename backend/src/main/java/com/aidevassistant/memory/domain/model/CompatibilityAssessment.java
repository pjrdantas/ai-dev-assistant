package com.aidevassistant.memory.domain.model;

import java.util.List;
import java.util.Objects;

public record CompatibilityAssessment(CompatibilityLevel level, List<String> reasons) {

    public CompatibilityAssessment {
        Objects.requireNonNull(level, "Compatibility level must not be null");
        Objects.requireNonNull(reasons, "Compatibility reasons must not be null");
        reasons = List.copyOf(reasons);
        if (level != CompatibilityLevel.COMPATIBLE && reasons.isEmpty()) {
            throw new IllegalArgumentException("Non-compatible assessment must explain its reasons");
        }
    }

    public static CompatibilityAssessment compatible() {
        return new CompatibilityAssessment(CompatibilityLevel.COMPATIBLE, List.of());
    }

    public static CompatibilityAssessment adaptable(List<String> reasons) {
        return new CompatibilityAssessment(CompatibilityLevel.ADAPTABLE, reasons);
    }

    public static CompatibilityAssessment incompatible(List<String> reasons) {
        return new CompatibilityAssessment(CompatibilityLevel.INCOMPATIBLE, reasons);
    }
}
