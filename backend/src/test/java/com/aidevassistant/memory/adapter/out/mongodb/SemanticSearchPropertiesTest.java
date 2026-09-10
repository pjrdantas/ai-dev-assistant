package com.aidevassistant.memory.adapter.out.mongodb;

import org.junit.jupiter.api.Test;

import java.time.Duration;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

class SemanticSearchPropertiesTest {

    @Test
    void acceptsSafeDefaults() {
        assertDoesNotThrow(new SemanticSearchProperties()::validate);
    }

    @Test
    void rejectsFewerCandidatesThanRequestedResults() {
        SemanticSearchProperties properties = new SemanticSearchProperties();
        properties.setTopK(10);
        properties.setNumCandidates(9);

        assertThrows(IllegalArgumentException.class, properties::validate);
    }

    @Test
    void rejectsInvalidIndexReadinessInterval() {
        SemanticSearchProperties properties = new SemanticSearchProperties();
        properties.setReadinessPollInterval(Duration.ofNanos(1));

        assertThrows(IllegalArgumentException.class, properties::validate);
    }
}
