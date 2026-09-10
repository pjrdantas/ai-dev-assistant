package com.aidevassistant.memory.adapter.out.onnx;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertThrows;

class OnnxEmbeddingModelTest {

    private static final String SHA_256 = "a".repeat(64);

    @TempDir
    Path temporaryDirectory;

    @Test
    void rejectsArtifactNamesContainingDirectories() {
        assertThrows(IllegalArgumentException.class,
                () -> model("nested/model.onnx", "tokenizer.json", SHA_256, SHA_256));
    }

    @Test
    void failsBeforeInferenceWhenArtifactsAreMissing() {
        OnnxEmbeddingModel model = model("model.onnx", "tokenizer.json", SHA_256, SHA_256);

        assertThrows(EmbeddingModelException.class, () -> new OnnxEmbeddingProvider(model));
    }

    @Test
    void rejectsAnArtifactWithUnexpectedChecksum() throws Exception {
        Files.writeString(temporaryDirectory.resolve("model.onnx"), "not an ONNX model");
        Files.writeString(temporaryDirectory.resolve("tokenizer.json"), "{}");
        OnnxEmbeddingModel model = model("model.onnx", "tokenizer.json", SHA_256, SHA_256);

        assertThrows(EmbeddingModelException.class, () -> new OnnxEmbeddingProvider(model));
    }

    private OnnxEmbeddingModel model(
            String modelFile,
            String tokenizerFile,
            String modelSha256,
            String tokenizerSha256) {
        return new OnnxEmbeddingModel(
                temporaryDirectory,
                modelFile,
                tokenizerFile,
                "test-model",
                "test-version",
                384,
                512,
                modelSha256,
                tokenizerSha256,
                "query: ");
    }
}
