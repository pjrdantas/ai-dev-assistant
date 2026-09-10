package com.aidevassistant.memory.adapter.out.onnx;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.nio.file.Path;

@ConfigurationProperties("embedding.local")
record LocalOnnxEmbeddingProperties(
        boolean enabled,
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

    OnnxEmbeddingModel toModel() {
        return new OnnxEmbeddingModel(
                directory,
                modelFile,
                tokenizerFile,
                modelId,
                modelVersion,
                dimension,
                maxTokens,
                modelSha256,
                tokenizerSha256,
                textPrefix);
    }
}
