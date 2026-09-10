package com.aidevassistant.configuration;

import org.junit.jupiter.api.Test;

import java.time.Duration;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

class MemoryClassificationPropertiesTest {

    @Test
    void acceptsInitialCalibratedValues() {
        MemoryClassificationProperties properties = new MemoryClassificationProperties();

        assertDoesNotThrow(properties::validatedThresholds);
        assertDoesNotThrow(properties::validatedMaximumFullAge);
    }

    @Test
    void rejectsPartialThresholdAtOrAboveFullThreshold() {
        MemoryClassificationProperties properties = new MemoryClassificationProperties();
        properties.setFullThreshold(0.80);
        properties.setPartialThreshold(0.80);

        assertThrows(IllegalArgumentException.class, properties::validatedThresholds);
    }

    @Test
    void rejectsNonPositiveMaximumFullAge() {
        MemoryClassificationProperties properties = new MemoryClassificationProperties();
        properties.setMaximumFullAge(Duration.ZERO);

        assertThrows(IllegalArgumentException.class, properties::validatedMaximumFullAge);
    }
}
