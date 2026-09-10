package com.aidevassistant.projectcontext.domain;

import com.aidevassistant.projectcontext.domain.model.TechnicalContext;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TechnicalContextTest {

    @Test
    void normalizesTechnologyNamesAndTaskType() {
        TechnicalContext context = new TechnicalContext(
                Set.of(" Java "),
                Map.of("Spring Boot", " 3.5.0 "),
                Optional.of(" CODE REVIEW "));

        assertEquals(Set.of("java", "spring-boot"), context.technologies());
        assertEquals("3.5.0", context.versionOf("SPRING BOOT").orElseThrow());
        assertEquals("code-review", context.taskType().orElseThrow());
    }

    @Test
    void protectsCollectionsFromExternalMutation() {
        Set<String> technologies = new HashSet<>(Set.of("java"));
        Map<String, String> versions = new HashMap<>(Map.of("java", "21"));
        TechnicalContext context = new TechnicalContext(technologies, versions, Optional.empty());

        technologies.add("angular");
        versions.put("java", "17");

        assertEquals(Set.of("java"), context.technologies());
        assertEquals("21", context.versionOf("java").orElseThrow());
    }

    @Test
    void emptyContextIsExplicit() {
        assertTrue(TechnicalContext.empty().isEmpty());
    }

    @Test
    void rejectsBlankTechnicalIdentifiers() {
        assertThrows(IllegalArgumentException.class,
                () -> new TechnicalContext(Set.of(" "), Map.of(), Optional.empty()));
    }
}
