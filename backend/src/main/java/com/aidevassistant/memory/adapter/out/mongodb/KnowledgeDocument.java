package com.aidevassistant.memory.adapter.out.mongodb;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;

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
        Instant createdAt,
        Instant updatedAt) {

    static final int CURRENT_SCHEMA_VERSION = 1;
}
