package com.aidevassistant.memory.adapter.out.mongodb;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;
import java.util.List;
import java.util.Map;

@Document(collection = "ai_memory")
record KnowledgeDocument(
        @Id String id,
        int schemaVersion,
        String promptOriginal,
        String promptNormalized,
        int normalizationVersion,
        String promptHash,
        String solution,
        String deduplicationKey,
        String status,
        long reuseCount,
        Instant lastUsedAt,
        TechnicalContextDocument technicalContext,
        EmbeddingDocument embedding,
        Instant createdAt,
        Instant updatedAt) {

    static final String COLLECTION_NAME = "ai_memory";
    static final int CURRENT_SCHEMA_VERSION = 3;
}

record TechnicalContextDocument(
        List<String> technologies,
        Map<String, String> versions,
        String taskType) {

    TechnicalContextDocument {
        technologies = List.copyOf(technologies);
        versions = Map.copyOf(versions);
    }
}

record EmbeddingDocument(
        String model,
        String modelVersion,
        int dimension,
        List<Double> values) {

    EmbeddingDocument {
        values = List.copyOf(values);
    }
}
