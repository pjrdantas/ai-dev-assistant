package com.aidevassistant.memory.adapter.out.mongodb;

import com.mongodb.client.MongoCollection;
import com.mongodb.client.model.SearchIndexModel;
import com.mongodb.client.model.SearchIndexType;
import org.bson.Document;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.ContextRefreshedEvent;
import org.springframework.context.event.EventListener;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.MongoOperations;
import org.springframework.data.mongodb.core.index.Index;
import org.springframework.data.mongodb.core.index.IndexOperations;

import java.time.Instant;
import java.util.List;

final class MongoMemoryIndexInitializer {

    private static final Logger LOGGER = LoggerFactory.getLogger(MongoMemoryIndexInitializer.class);

    static final String EXACT_LOOKUP_INDEX = "exact_lookup_idx";
    static final String DEDUPLICATION_INDEX = "deduplication_key_uq";
    static final String UPDATED_AT_INDEX = "updated_at_idx";

    private final MongoOperations mongoOperations;
    private final SemanticSearchProperties semanticSearchProperties;

    MongoMemoryIndexInitializer(
            MongoOperations mongoOperations,
            SemanticSearchProperties semanticSearchProperties) {
        this.mongoOperations = mongoOperations;
        this.semanticSearchProperties = semanticSearchProperties;
        this.semanticSearchProperties.validate();
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

        createVectorIndexIfMissing();
        awaitVectorIndexReadiness();
    }

    boolean isVectorIndexReady() {
        return isReady(vectorIndexState());
    }

    private void createVectorIndexIfMissing() {
        if (vectorIndexState() != null) {
            return;
        }

        Document definition = new Document("fields", List.of(
                new Document("type", "vector")
                        .append("path", "embedding.values")
                        .append("numDimensions", semanticSearchProperties.getDimension())
                        .append("similarity", "cosine"),
                new Document("type", "filter").append("path", "status"),
                new Document("type", "filter").append("path", "embedding.model"),
                new Document("type", "filter").append("path", "embedding.modelVersion"),
                new Document("type", "filter").append("path", "embedding.dimension")));
        SearchIndexModel index = new SearchIndexModel(
                semanticSearchProperties.getIndexName(),
                definition,
                SearchIndexType.vectorSearch());

        collection().createSearchIndexes(List.of(index));
        LOGGER.info("Requested creation of MongoDB Vector Search index '{}'",
                semanticSearchProperties.getIndexName());
    }

    private void awaitVectorIndexReadiness() {
        Instant deadline = Instant.now().plus(semanticSearchProperties.getReadinessTimeout());
        Document lastState = null;

        while (Instant.now().isBefore(deadline)) {
            lastState = vectorIndexState();
            if (lastState != null && "FAILED".equals(lastState.getString("status"))) {
                throw new IllegalStateException("MongoDB Vector Search index failed: " + lastState);
            }
            if (isReady(lastState)) {
                validateVectorIndexDefinition(lastState);
                LOGGER.info("MongoDB Vector Search index '{}' is READY",
                        semanticSearchProperties.getIndexName());
                return;
            }
            pauseBeforeNextReadinessCheck();
        }

        throw new IllegalStateException(
                "MongoDB Vector Search index did not become READY before timeout. Last state: " + lastState);
    }

    private Document vectorIndexState() {
        return collection()
                .listSearchIndexes()
                .name(semanticSearchProperties.getIndexName())
                .first();
    }

    private boolean isReady(Document state) {
        return state != null
                && "READY".equals(state.getString("status"))
                && Boolean.TRUE.equals(state.getBoolean("queryable"));
    }

    private void validateVectorIndexDefinition(Document state) {
        if (!"vectorSearch".equals(state.getString("type"))) {
            throw new IllegalStateException("Configured semantic index is not a vectorSearch index");
        }
        Document definition = state.get("latestDefinition", Document.class);
        List<Document> fields = definition == null
                ? List.of()
                : definition.getList("fields", Document.class, List.of());

        boolean expectedVectorField = fields.stream().anyMatch(this::matchesExpectedVectorField);
        List<String> filterPaths = fields.stream()
                .filter(field -> "filter".equals(field.getString("type")))
                .map(field -> field.getString("path"))
                .toList();
        boolean expectedFilters = filterPaths.containsAll(List.of(
                "status",
                "embedding.model",
                "embedding.modelVersion",
                "embedding.dimension"));

        if (!expectedVectorField || !expectedFilters) {
            throw new IllegalStateException(
                    "MongoDB Vector Search index definition does not match the configured semantic search");
        }
    }

    private boolean matchesExpectedVectorField(Document field) {
        Number dimensions = field.get("numDimensions", Number.class);
        return "vector".equals(field.getString("type"))
                && "embedding.values".equals(field.getString("path"))
                && dimensions != null
                && semanticSearchProperties.getDimension() == dimensions.intValue()
                && "cosine".equals(field.getString("similarity"));
    }

    private MongoCollection<Document> collection() {
        return mongoOperations.getCollection(KnowledgeDocument.COLLECTION_NAME);
    }

    private void pauseBeforeNextReadinessCheck() {
        try {
            Thread.sleep(semanticSearchProperties.getReadinessPollInterval().toMillis());
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Interrupted while waiting for the vector index", exception);
        }
    }
}
