package com.aidevassistant.memory.adapter.out.mongodb;

import org.springframework.context.event.ContextRefreshedEvent;
import org.springframework.context.event.EventListener;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.MongoOperations;
import org.springframework.data.mongodb.core.index.Index;
import org.springframework.data.mongodb.core.index.IndexOperations;

final class MongoMemoryIndexInitializer {

    static final String EXACT_LOOKUP_INDEX = "exact_lookup_idx";
    static final String DEDUPLICATION_INDEX = "deduplication_key_uq";
    static final String UPDATED_AT_INDEX = "updated_at_idx";

    private final MongoOperations mongoOperations;

    MongoMemoryIndexInitializer(MongoOperations mongoOperations) {
        this.mongoOperations = mongoOperations;
    }

    @EventListener(ContextRefreshedEvent.class)
    void createIndexes() {
        IndexOperations indexes = mongoOperations.indexOps(KnowledgeDocument.class);

        indexes.createIndex(new Index()
                .on("promptHash", Sort.Direction.ASC)
                .on("normalizationVersion", Sort.Direction.ASC)
                .on("status", Sort.Direction.ASC)
                .named(EXACT_LOOKUP_INDEX));
        indexes.createIndex(new Index()
                .on("deduplicationKey", Sort.Direction.ASC)
                .unique()
                .named(DEDUPLICATION_INDEX));
        indexes.createIndex(new Index()
                .on("updatedAt", Sort.Direction.DESC)
                .named(UPDATED_AT_INDEX));
    }
}
