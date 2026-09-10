package com.aidevassistant.memory.adapter.out.mongodb;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;
import java.util.List;

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
        EmbeddingDocument embedding,
        Instant createdAt,
        Instant updatedAt) {

    static final String COLLECTION_NAME = "ai_memory";
    static final int CURRENT_SCHEMA_VERSION = 2;
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
