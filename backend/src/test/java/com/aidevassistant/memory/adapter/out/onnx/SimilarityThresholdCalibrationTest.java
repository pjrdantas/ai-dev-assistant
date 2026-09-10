package com.aidevassistant.memory.adapter.out.onnx;

import com.aidevassistant.memory.domain.model.Embedding;
import com.aidevassistant.memory.domain.model.MatchType;
import com.aidevassistant.memory.domain.model.SimilarityScore;
import com.aidevassistant.memory.domain.model.SimilarityThresholds;
import com.aidevassistant.prompt.domain.model.NormalizedPrompt;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.List;
import java.util.Locale;
import java.util.Objects;

import static org.junit.jupiter.api.Assertions.assertTrue;

@EnabledIfSystemProperty(named = "embedding.benchmark.directory", matches = ".+")
class SimilarityThresholdCalibrationTest {

    private static final SimilarityThresholds THRESHOLDS = new SimilarityThresholds(0.90, 0.70);

    @Test
    void calibratesInitialThresholdsWithRepresentativePrompts() throws Exception {
        List<EvaluatedCase> evaluatedCases;
        try (OnnxEmbeddingProvider provider = new OnnxEmbeddingProvider(configuredModel())) {
            evaluatedCases = loadDataset().stream()
                    .map(calibrationCase -> evaluate(provider, calibrationCase))
                    .toList();
        }

        assertTrue(evaluatedCases.stream().noneMatch(evaluated ->
                        evaluated.expected() != MatchType.FULL
                                && evaluated.score().isAtLeast(THRESHOLDS.full())),
                "A non-full example crossed the conservative full threshold");
        assertTrue(evaluatedCases.stream().noneMatch(evaluated ->
                        evaluated.expected() != MatchType.NONE
                                && !evaluated.score().isAtLeast(THRESHOLDS.partial())),
                "A reusable example fell below the partial threshold");
        assertTrue(evaluatedCases.stream().noneMatch(evaluated ->
                        evaluated.expected() == MatchType.NONE
                                && evaluated.score().isAtLeast(THRESHOLDS.partial())),
                "An unrelated example crossed the partial threshold");
    }

    private EvaluatedCase evaluate(OnnxEmbeddingProvider provider, CalibrationCase calibrationCase) {
        Embedding query = provider.generate(prompt(calibrationCase.query()));
        Embedding candidate = provider.generate(prompt(calibrationCase.candidate()));
        SimilarityScore score = normalizedCosine(query, candidate);
        MatchType semanticBand = semanticClassification(score);

        System.out.printf(Locale.ROOT,
                "SIMILARITY_CALIBRATION expected=%s semanticBand=%s score=%.4f query=%s%n",
                calibrationCase.expected(), semanticBand, score.value(), calibrationCase.query());
        return new EvaluatedCase(calibrationCase.expected(), score);
    }

    private MatchType semanticClassification(SimilarityScore score) {
        if (score.isAtLeast(THRESHOLDS.full())) {
            return MatchType.FULL;
        }
        if (score.isAtLeast(THRESHOLDS.partial())) {
            return MatchType.PARTIAL;
        }
        return MatchType.NONE;
    }

    private SimilarityScore normalizedCosine(Embedding left, Embedding right) {
        float[] leftValues = left.values();
        float[] rightValues = right.values();
        double cosine = 0.0;
        for (int index = 0; index < leftValues.length; index++) {
            cosine += leftValues[index] * rightValues[index];
        }
        return new SimilarityScore((1.0 + cosine) / 2.0);
    }

    private List<CalibrationCase> loadDataset() {
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                Objects.requireNonNull(
                        getClass().getResourceAsStream("/similarity-threshold-calibration.csv"),
                        "Similarity calibration dataset is missing"),
                StandardCharsets.UTF_8))) {
            return reader.lines()
                    .skip(1)
                    .filter(line -> !line.isBlank())
                    .map(this::parseCase)
                    .toList();
        } catch (IOException exception) {
            throw new IllegalStateException("Could not load similarity calibration dataset", exception);
        }
    }

    private CalibrationCase parseCase(String line) {
        String[] columns = line.split("\\|", -1);
        return new CalibrationCase(MatchType.valueOf(columns[0]), columns[1], columns[2]);
    }

    private NormalizedPrompt prompt(String value) {
        return new NormalizedPrompt(value, 1);
    }

    private OnnxEmbeddingModel configuredModel() {
        return new OnnxEmbeddingModel(
                Path.of(requiredProperty("embedding.benchmark.directory")),
                property("embedding.benchmark.model-file", "model.onnx"),
                property("embedding.benchmark.tokenizer-file", "tokenizer.json"),
                requiredProperty("embedding.benchmark.model-id"),
                requiredProperty("embedding.benchmark.model-version"),
                Integer.parseInt(property("embedding.benchmark.dimension", "384")),
                Integer.parseInt(property("embedding.benchmark.max-tokens", "128")),
                requiredProperty("embedding.benchmark.model-sha256"),
                requiredProperty("embedding.benchmark.tokenizer-sha256"),
                property("embedding.benchmark.text-prefix", ""));
    }

    private String requiredProperty(String name) {
        String value = System.getProperty(name);
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("Required calibration property is missing: " + name);
        }
        return value;
    }

    private String property(String name, String defaultValue) {
        return System.getProperty(name, defaultValue);
    }

    private record CalibrationCase(MatchType expected, String query, String candidate) {
    }

    private record EvaluatedCase(MatchType expected, SimilarityScore score) {
    }
}
