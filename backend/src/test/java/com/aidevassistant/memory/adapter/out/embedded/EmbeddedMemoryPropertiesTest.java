package com.aidevassistant.memory.adapter.out.embedded;

import org.junit.jupiter.api.Test;

import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class EmbeddedMemoryPropertiesTest {

    @Test
    void validatesAndNormalizesConfiguration() {
        EmbeddedMemoryProperties properties = new EmbeddedMemoryProperties();
        properties.setDirectory(Path.of("target", "memory-test", "..", "memory-test"));
        properties.setDimension(384);
        properties.setTopK(7);

        assertEquals(Path.of("target", "memory-test").toAbsolutePath().normalize(),
                properties.validatedDirectory());
        assertEquals(384, properties.validatedDimension());
        assertEquals(7, properties.validatedTopK());
    }

    @Test
    void rejectsInvalidVectorConfiguration() {
        EmbeddedMemoryProperties properties = new EmbeddedMemoryProperties();

        properties.setDimension(0);
        assertThrows(IllegalArgumentException.class, properties::validatedDimension);

        properties.setDimension(1025);
        assertThrows(IllegalArgumentException.class, properties::validatedDimension);

        properties.setTopK(0);
        assertThrows(IllegalArgumentException.class, properties::validatedTopK);
    }

    @Test
    void rejectsMissingDirectory() {
        EmbeddedMemoryProperties properties = new EmbeddedMemoryProperties();
        properties.setDirectory(null);

        assertThrows(NullPointerException.class, properties::validatedDirectory);
    }
}
