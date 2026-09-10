package com.aidevassistant.memory.adapter.out.onnx;

import java.nio.file.Path;
import java.util.Objects;
import java.util.regex.Pattern;

record OnnxEmbeddingModel(
        Path directory,
        String modelFile,
        String tokenizerFile,
        String modelId,
        String modelVersion,
        int dimension,
        int maxTokens,
        String modelSha256,
        String tokenizerSha256,
        String textPrefix) {

    private static final Pattern SHA_256 = Pattern.compile("[0-9a-f]{64}");

    OnnxEmbeddingModel {
        directory = Objects.requireNonNull(directory, "Embedding model directory must not be null")
                .toAbsolutePath()
                .normalize();
        modelFile = requireFileName(modelFile, "ONNX model file");
        tokenizerFile = requireFileName(tokenizerFile, "Tokenizer file");
        modelId = requireText(modelId, "Embedding model id must not be blank");
        modelVersion = requireText(modelVersion, "Embedding model version must not be blank");
        modelSha256 = requireSha256(modelSha256, "ONNX model checksum must be a lowercase SHA-256");
        tokenizerSha256 = requireSha256(
                tokenizerSha256,
                "Tokenizer checksum must be a lowercase SHA-256");
        textPrefix = Objects.requireNonNull(textPrefix, "Embedding text prefix must not be null");
        if (dimension <= 0) {
            throw new IllegalArgumentException("Embedding dimension must be positive");
        }
        if (maxTokens <= 0) {
            throw new IllegalArgumentException("Maximum token count must be positive");
        }
    }

    Path modelPath() {
        return directory.resolve(modelFile);
    }

    Path tokenizerPath() {
        return directory.resolve(tokenizerFile);
    }

    private static String requireFileName(String value, String label) {
        String fileName = requireText(value, label + " must not be blank");
        Path path = Path.of(fileName);
        if (path.isAbsolute() || path.getNameCount() != 1) {
            throw new IllegalArgumentException(label + " must be a file name without directories");
        }
        return fileName;
    }

    private static String requireSha256(String value, String message) {
        String checksum = requireText(value, message);
        if (!SHA_256.matcher(checksum).matches()) {
            throw new IllegalArgumentException(message);
        }
        return checksum;
    }

    private static String requireText(String value, String message) {
        Objects.requireNonNull(value, message);
        if (value.isBlank()) {
            throw new IllegalArgumentException(message);
        }
        return value;
    }
}
