package com.aidevassistant.memory.domain.policy;

import com.aidevassistant.memory.domain.model.CompatibilityAssessment;
import com.aidevassistant.memory.domain.model.KnowledgeEntry;
import com.aidevassistant.memory.domain.model.KnowledgeStatus;
import com.aidevassistant.projectcontext.domain.model.TechnicalContext;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.OptionalInt;
import java.util.Set;

public final class KnowledgeCompatibilityPolicy {

    public CompatibilityAssessment assess(
            TechnicalContext currentContext,
            KnowledgeEntry candidate,
            Instant evaluatedAt,
            Duration maximumFullAge) {
        Objects.requireNonNull(currentContext, "Current technical context must not be null");
        Objects.requireNonNull(candidate, "Knowledge candidate must not be null");
        Objects.requireNonNull(evaluatedAt, "Compatibility evaluation date must not be null");
        Objects.requireNonNull(maximumFullAge, "Maximum full-match age must not be null");
        if (maximumFullAge.isZero() || maximumFullAge.isNegative()) {
            throw new IllegalArgumentException("Maximum full-match age must be positive");
        }
        if (evaluatedAt.isBefore(candidate.updatedAt())) {
            throw new IllegalArgumentException("Compatibility evaluation date must not precede knowledge update");
        }

        List<String> incompatibleReasons = new ArrayList<>();
        List<String> adaptableReasons = new ArrayList<>();

        if (candidate.status() != KnowledgeStatus.ACTIVE) {
            incompatibleReasons.add("Knowledge status is " + candidate.status());
        }
        if (Duration.between(candidate.updatedAt(), evaluatedAt).compareTo(maximumFullAge) > 0) {
            adaptableReasons.add("Knowledge exceeds the configured age for a full match");
        }

        compareTechnicalContexts(
                currentContext,
                candidate.technicalContext(),
                incompatibleReasons,
                adaptableReasons);

        if (!incompatibleReasons.isEmpty()) {
            return CompatibilityAssessment.incompatible(incompatibleReasons);
        }
        if (!adaptableReasons.isEmpty()) {
            return CompatibilityAssessment.adaptable(adaptableReasons);
        }
        return CompatibilityAssessment.compatible();
    }

    private void compareTechnicalContexts(
            TechnicalContext current,
            TechnicalContext stored,
            List<String> incompatibleReasons,
            List<String> adaptableReasons) {
        if (current.isEmpty() || stored.isEmpty()) {
            adaptableReasons.add("Technical context is missing from the request or stored knowledge");
            return;
        }

        if (current.taskType().isPresent() && stored.taskType().isPresent()
                && !current.taskType().equals(stored.taskType())) {
            incompatibleReasons.add("Task type differs between request and stored knowledge");
        } else if (current.taskType().isEmpty() != stored.taskType().isEmpty()) {
            adaptableReasons.add("Task type is missing from the request or stored knowledge");
        }

        Set<String> sharedTechnologies = new HashSet<>(current.technologies());
        sharedTechnologies.retainAll(stored.technologies());
        if (!current.technologies().isEmpty()
                && !stored.technologies().isEmpty()
                && sharedTechnologies.isEmpty()) {
            incompatibleReasons.add("Request and stored knowledge have no technology in common");
        }

        for (String technology : sharedTechnologies) {
            compareVersion(technology, current, stored, incompatibleReasons, adaptableReasons);
        }

        if (!current.technologies().equals(stored.technologies())) {
            adaptableReasons.add("Technology information differs between request and stored knowledge");
        }
    }

    private void compareVersion(
            String technology,
            TechnicalContext current,
            TechnicalContext stored,
            List<String> incompatibleReasons,
            List<String> adaptableReasons) {
        var currentVersion = current.versionOf(technology);
        var storedVersion = stored.versionOf(technology);
        if (currentVersion.isEmpty() || storedVersion.isEmpty()) {
            if (currentVersion.isPresent() != storedVersion.isPresent()) {
                adaptableReasons.add("Version is missing for technology " + technology);
            }
            return;
        }
        if (currentVersion.equals(storedVersion)) {
            return;
        }

        OptionalInt currentMajor = majorVersion(currentVersion.orElseThrow());
        OptionalInt storedMajor = majorVersion(storedVersion.orElseThrow());
        if (currentMajor.isPresent() && storedMajor.isPresent()
                && currentMajor.getAsInt() != storedMajor.getAsInt()) {
            incompatibleReasons.add("Major version conflict for technology " + technology);
            return;
        }
        adaptableReasons.add("Version differs for technology " + technology);
    }

    private OptionalInt majorVersion(String version) {
        StringBuilder digits = new StringBuilder();
        boolean started = false;
        for (char character : version.toCharArray()) {
            if (Character.isDigit(character)) {
                digits.append(character);
                started = true;
            } else if (started) {
                break;
            }
        }
        if (digits.isEmpty()) {
            return OptionalInt.empty();
        }
        try {
            return OptionalInt.of(Integer.parseInt(digits.toString()));
        } catch (NumberFormatException exception) {
            return OptionalInt.empty();
        }
    }
}
