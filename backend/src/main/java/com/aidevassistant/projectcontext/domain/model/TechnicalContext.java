package com.aidevassistant.projectcontext.domain.model;

import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;

public record TechnicalContext(
        Set<String> technologies,
        Map<String, String> versions,
        Optional<String> taskType) {

    public TechnicalContext {
        Objects.requireNonNull(technologies, "Technologies must not be null");
        Objects.requireNonNull(versions, "Technology versions must not be null");
        Objects.requireNonNull(taskType, "Task type must not be null");

        TreeSet<String> normalizedTechnologies = new TreeSet<>();
        technologies.forEach(technology -> normalizedTechnologies.add(normalizeIdentifier(technology)));

        TreeMap<String, String> normalizedVersions = new TreeMap<>();
        versions.forEach((technology, version) -> {
            String normalizedTechnology = normalizeIdentifier(technology);
            normalizedVersions.put(normalizedTechnology, requireText(version, "Technology version must not be blank"));
            normalizedTechnologies.add(normalizedTechnology);
        });

        technologies = Set.copyOf(normalizedTechnologies);
        versions = Map.copyOf(normalizedVersions);
        taskType = taskType
                .filter(value -> !value.isBlank())
                .map(TechnicalContext::normalizeIdentifier);
    }

    public static TechnicalContext empty() {
        return new TechnicalContext(Set.of(), Map.of(), Optional.empty());
    }

    public boolean isEmpty() {
        return technologies.isEmpty() && taskType.isEmpty();
    }

    public Optional<String> versionOf(String technology) {
        return Optional.ofNullable(versions.get(normalizeIdentifier(technology)));
    }

    private static String normalizeIdentifier(String value) {
        return requireText(value, "Technical identifier must not be blank")
                .toLowerCase(Locale.ROOT)
                .replaceAll("\\s+", "-");
    }

    private static String requireText(String value, String message) {
        Objects.requireNonNull(value, message);
        String trimmed = value.trim();
        if (trimmed.isEmpty()) {
            throw new IllegalArgumentException(message);
        }
        return trimmed;
    }
}
