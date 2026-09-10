package com.aidevassistant.memory.adapter.out.onnx;

import com.aidevassistant.memory.domain.model.Embedding;
import com.aidevassistant.prompt.domain.model.NormalizedPrompt;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;

import java.lang.management.ManagementFactory;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

@EnabledIfSystemProperty(named = "embedding.benchmark.directory", matches = ".+")
class OnnxEmbeddingBenchmarkTest {

    private static final int NORMALIZATION_VERSION = 1;
    private static final int MEASUREMENT_ITERATIONS = 5;

    private static final List<String> CANDIDATES = List.of(
            "Como escrever um teste de controller Spring Boot com MockMvc",
            "How to configure an AWS S3 bucket with Terraform",
            "NullPointerException when calling a Java repository",
            "Como criar um cenário Cucumber para login",
            "Kafka consumer is not receiving messages",
            "How to mock a dependency with Mockito",
            "Erro de compilação em componente Angular TypeScript",
            "Create a Docker Compose service for MongoDB",
            "JUnit exception assertion: assertThrows(IllegalArgumentException.class, action)");

    private static final List<BenchmarkCase> CASES = List.of(
            new BenchmarkCase("Qual a melhor forma de testar um controller Spring usando MockMvc?", 0),
            new BenchmarkCase("Provision an S3 bucket using Terraform on AWS", 1),
            new BenchmarkCase("Meu serviço Java lança NullPointerException ao chamar o repositório", 2),
            new BenchmarkCase("Escreva um teste BDD de autenticação usando Cucumber", 3),
            new BenchmarkCase("Por que meu consumidor Kafka não recebe eventos?", 4),
            new BenchmarkCase("Mock a Java collaborator in a unit test", 5),
            new BenchmarkCase("Meu componente Angular apresenta erro no TypeScript", 6),
            new BenchmarkCase("Subir MongoDB localmente usando Docker Compose", 7),
            new BenchmarkCase("assertThrows(IllegalArgumentException.class, () -> service.execute());", 8));

    @Test
    void measuresLocalModel() throws Exception {
        OnnxEmbeddingModel model = configuredModel();
        forceGarbageCollection();
        long heapBefore = usedHeap();
        long virtualMemoryBefore = committedVirtualMemory();

        try (OnnxEmbeddingProvider provider = new OnnxEmbeddingProvider(model)) {
            NormalizedPrompt warmupPrompt = prompt(CASES.getFirst().query());
            Embedding warmup = provider.generate(warmupPrompt);
            assertArrayEquals(warmup.values(), provider.generate(warmupPrompt).values(), 0.000001f);
            List<Embedding> candidates = CANDIDATES.stream()
                    .map(text -> provider.generate(prompt(text)))
                    .toList();
            List<Double> latencies = new ArrayList<>();
            int correct = 0;

            for (int iteration = 0; iteration < MEASUREMENT_ITERATIONS; iteration++) {
                for (BenchmarkCase benchmarkCase : CASES) {
                    long startedAt = System.nanoTime();
                    Embedding query = provider.generate(prompt(benchmarkCase.query()));
                    latencies.add((System.nanoTime() - startedAt) / 1_000_000.0);
                    int nearest = nearestCandidate(query, candidates);
                    if (nearest == benchmarkCase.expectedCandidate()) {
                        correct++;
                    }
                    assertEquals(model.dimension(), query.dimension());
                    assertEquals(1.0, norm(query.values()), 0.0001);
                }
            }

            forceGarbageCollection();
            double recallAtOne = correct / (double) (CASES.size() * MEASUREMENT_ITERATIONS);
            double meanLatency = latencies.stream().mapToDouble(Double::doubleValue).average().orElseThrow();
            double p95Latency = percentile95(latencies);
            double heapDeltaMb = bytesToMegabytes(Math.max(0, usedHeap() - heapBefore));
            double virtualMemoryDeltaMb = bytesToMegabytes(
                    Math.max(0, committedVirtualMemory() - virtualMemoryBefore));

            System.out.printf(Locale.ROOT,
                    "EMBEDDING_BENCHMARK model=%s version=%s dimension=%d recallAtOne=%.4f "
                            + "meanLatencyMs=%.2f p95LatencyMs=%.2f heapDeltaMb=%.2f "
                            + "virtualMemoryDeltaMb=%.2f artifactMb=%.2f%n",
                    model.modelId(),
                    model.modelVersion(),
                    model.dimension(),
                    recallAtOne,
                    meanLatency,
                    p95Latency,
                    heapDeltaMb,
                    virtualMemoryDeltaMb,
                    bytesToMegabytes(Files.size(model.modelPath()) + Files.size(model.tokenizerPath())));

            assertTrue(recallAtOne >= 0.5, "Model must retrieve at least half of the small evaluation set");
        }
    }

    private OnnxEmbeddingModel configuredModel() {
        return new OnnxEmbeddingModel(
                Path.of(requiredProperty("embedding.benchmark.directory")),
                property("embedding.benchmark.model-file", "model.onnx"),
                property("embedding.benchmark.tokenizer-file", "tokenizer.json"),
                requiredProperty("embedding.benchmark.model-id"),
                requiredProperty("embedding.benchmark.model-version"),
                Integer.parseInt(property("embedding.benchmark.dimension", "384")),
                Integer.parseInt(property("embedding.benchmark.max-tokens", "512")),
                requiredProperty("embedding.benchmark.model-sha256"),
                requiredProperty("embedding.benchmark.tokenizer-sha256"),
                property("embedding.benchmark.text-prefix", ""));
    }

    private int nearestCandidate(Embedding query, List<Embedding> candidates) {
        int nearest = -1;
        double highestSimilarity = -Double.MAX_VALUE;
        for (int index = 0; index < candidates.size(); index++) {
            double similarity = cosine(query.values(), candidates.get(index).values());
            if (similarity > highestSimilarity) {
                highestSimilarity = similarity;
                nearest = index;
            }
        }
        return nearest;
    }

    private double cosine(float[] left, float[] right) {
        double product = 0;
        for (int index = 0; index < left.length; index++) {
            product += left[index] * right[index];
        }
        return product;
    }

    private double norm(float[] values) {
        double squared = 0;
        for (float value : values) {
            squared += value * value;
        }
        return Math.sqrt(squared);
    }

    private double percentile95(List<Double> latencies) {
        List<Double> ordered = latencies.stream().sorted(Comparator.naturalOrder()).toList();
        int index = (int) Math.ceil(ordered.size() * 0.95) - 1;
        return ordered.get(Math.max(index, 0));
    }

    private NormalizedPrompt prompt(String text) {
        return new NormalizedPrompt(text, NORMALIZATION_VERSION);
    }

    private String requiredProperty(String name) {
        String value = System.getProperty(name);
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("Required benchmark property is missing: " + name);
        }
        return value;
    }

    private String property(String name, String defaultValue) {
        return System.getProperty(name, defaultValue);
    }

    private void forceGarbageCollection() throws InterruptedException {
        System.gc();
        Thread.sleep(100);
    }

    private long usedHeap() {
        Runtime runtime = Runtime.getRuntime();
        return runtime.totalMemory() - runtime.freeMemory();
    }

    private long committedVirtualMemory() {
        java.lang.management.OperatingSystemMXBean operatingSystem =
                ManagementFactory.getOperatingSystemMXBean();
        if (operatingSystem instanceof com.sun.management.OperatingSystemMXBean extended) {
            return extended.getCommittedVirtualMemorySize();
        }
        return 0;
    }

    private double bytesToMegabytes(long bytes) {
        return bytes / 1024.0 / 1024.0;
    }

    private record BenchmarkCase(String query, int expectedCandidate) {
    }
}
