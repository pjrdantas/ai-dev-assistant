package com.aidevassistant.memory.adapter.out.mongodb;

import com.aidevassistant.memory.application.port.out.MemoryRepository;
import com.aidevassistant.memory.application.port.out.SemanticMemoryCandidate;
import com.aidevassistant.memory.domain.model.Embedding;
import com.aidevassistant.memory.domain.model.KnowledgeEntry;
import com.aidevassistant.memory.domain.model.KnowledgeStatus;
import com.aidevassistant.prompt.domain.model.PromptHash;
import com.mongodb.client.MongoCollection;
import org.bson.Document;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.FindAndModifyOptions;
import org.springframework.data.mongodb.core.MongoOperations;
import org.springframework.data.mongodb.core.convert.MongoConverter;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;

import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

final class MongoMemoryRepository implements MemoryRepository {

    private final MongoOperations mongoOperations;
    private final MongoMemoryMapper mapper;
    private final SemanticSearchProperties semanticSearchProperties;

    MongoMemoryRepository(
            MongoOperations mongoOperations,
            MongoMemoryMapper mapper,
            SemanticSearchProperties semanticSearchProperties) {
        this.mongoOperations = mongoOperations;
        this.mapper = mapper;
        this.semanticSearchProperties = semanticSearchProperties;
        this.semanticSearchProperties.validate();
    }

    @Override
    public List<KnowledgeEntry> findActiveByPromptHash(PromptHash promptHash) {
        Objects.requireNonNull(promptHash, "Prompt hash must not be null");

        Query query = Query.query(Criteria.where("promptHash").is(promptHash.value())
                        .and("normalizationVersion").is(promptHash.normalizationVersion())
                        .and("status").is(KnowledgeStatus.ACTIVE.name()))
                .with(Sort.by(Sort.Direction.DESC, "updatedAt"));

        return mongoOperations.find(query, KnowledgeDocument.class).stream()
                .map(mapper::toDomain)
                .toList();
    }

    @Override
    public KnowledgeEntry save(KnowledgeEntry knowledgeEntry) {
        Objects.requireNonNull(knowledgeEntry, "Knowledge entry must not be null");
        KnowledgeDocument document = mapper.toDocument(knowledgeEntry);

        Query query = Query.query(Criteria.where("deduplicationKey").is(document.deduplicationKey()));
        Update insert = new Update()
                .setOnInsert("_id", document.id())
                .setOnInsert("schemaVersion", document.schemaVersion())
                .setOnInsert("promptOriginal", document.promptOriginal())
                .setOnInsert("promptNormalized", document.promptNormalized())
                .setOnInsert("normalizationVersion", document.normalizationVersion())
                .setOnInsert("promptHash", document.promptHash())
                .setOnInsert("solution", document.solution())
                .setOnInsert("deduplicationKey", document.deduplicationKey())
                .setOnInsert("status", document.status())
                .setOnInsert("reuseCount", document.reuseCount())
                .setOnInsert("lastUsedAt", document.lastUsedAt())
                .setOnInsert("technicalContext", document.technicalContext())
                .setOnInsert("embedding", document.embedding())
                .setOnInsert("createdAt", document.createdAt())
                .setOnInsert("updatedAt", document.updatedAt());

        KnowledgeDocument persisted;
        try {
            persisted = mongoOperations.findAndModify(
                    query,
                    insert,
                    FindAndModifyOptions.options().upsert(true).returnNew(true),
                    KnowledgeDocument.class);
        } catch (DuplicateKeyException duplicateKeyException) {
            persisted = mongoOperations.findOne(query, KnowledgeDocument.class);
            if (persisted == null) {
                throw duplicateKeyException;
            }
        }

        return mapper.toDomain(Objects.requireNonNull(persisted, "MongoDB did not return persisted knowledge"));
    }

    @Override
    public Optional<KnowledgeEntry> saveEmbedding(UUID knowledgeId, Embedding embedding, Instant generatedAt) {
        Objects.requireNonNull(knowledgeId, "Knowledge id must not be null");
        Objects.requireNonNull(embedding, "Embedding must not be null");
        Objects.requireNonNull(generatedAt, "Embedding generation date must not be null");
        requireConfiguredDimension(embedding);

        Query query = Query.query(Criteria.where("_id").is(knowledgeId.toString())
                .and("status").is(KnowledgeStatus.ACTIVE.name())
                .and("updatedAt").lte(generatedAt));
        Update update = new Update()
                .set("schemaVersion", KnowledgeDocument.CURRENT_SCHEMA_VERSION)
                .set("embedding", mapper.toDocument(embedding))
                .set("updatedAt", generatedAt);

        KnowledgeDocument updated = mongoOperations.findAndModify(
                query,
                update,
                FindAndModifyOptions.options().returnNew(true),
                KnowledgeDocument.class);

        return Optional.ofNullable(updated).map(mapper::toDomain);
    }

    @Override
    public List<SemanticMemoryCandidate> findSimilar(Embedding queryEmbedding) {
        Objects.requireNonNull(queryEmbedding, "Query embedding must not be null");
        requireConfiguredDimension(queryEmbedding);

        Document filter = new Document("$and", List.of(
                new Document("status", new Document("$eq", KnowledgeStatus.ACTIVE.name())),
                new Document("embedding.model", new Document("$eq", queryEmbedding.model())),
                new Document("embedding.modelVersion", new Document("$eq", queryEmbedding.modelVersion())),
                new Document("embedding.dimension", new Document("$eq", queryEmbedding.dimension()))));
        Document vectorSearch = new Document("$vectorSearch", new Document()
                .append("index", semanticSearchProperties.getIndexName())
                .append("path", "embedding.values")
                .append("queryVector", asDoubles(queryEmbedding.values()))
                .append("numCandidates", semanticSearchProperties.getNumCandidates())
                .append("limit", semanticSearchProperties.getTopK())
                .append("filter", filter));
        Document includeScore = new Document("$set",
                new Document("_semanticScore", new Document("$meta", "vectorSearchScore")));

        MongoCollection<Document> collection = mongoOperations.getCollection(KnowledgeDocument.COLLECTION_NAME);
        MongoConverter converter = mongoOperations.getConverter();
        return collection.aggregate(List.of(vectorSearch, includeScore)).into(new java.util.ArrayList<>()).stream()
                .map(result -> {
                    Number score = result.get("_semanticScore", Number.class);
                    result.remove("_semanticScore");
                    KnowledgeDocument document = converter.read(KnowledgeDocument.class, result);
                    return new SemanticMemoryCandidate(mapper.toDomain(document), score.doubleValue());
                })
                .toList();
    }

    @Override
    public Optional<KnowledgeEntry> registerReuse(UUID knowledgeId, Instant usedAt) {
        Objects.requireNonNull(knowledgeId, "Knowledge id must not be null");
        Objects.requireNonNull(usedAt, "Usage date must not be null");

        Query query = Query.query(Criteria.where("_id").is(knowledgeId.toString())
                .and("status").is(KnowledgeStatus.ACTIVE.name())
                .and("updatedAt").lte(usedAt));
        Update update = new Update()
                .inc("reuseCount", 1L)
                .set("lastUsedAt", usedAt)
                .set("updatedAt", usedAt);

        KnowledgeDocument updated = mongoOperations.findAndModify(
                query,
                update,
                FindAndModifyOptions.options().returnNew(true),
                KnowledgeDocument.class);

        return Optional.ofNullable(updated).map(mapper::toDomain);
    }

    private void requireConfiguredDimension(Embedding embedding) {
        if (embedding.dimension() != semanticSearchProperties.getDimension()) {
            throw new IllegalArgumentException(
                    "Embedding dimension must match the configured vector index dimension");
        }
    }

    private List<Double> asDoubles(float[] values) {
        java.util.ArrayList<Double> doubles = new java.util.ArrayList<>(values.length);
        for (float value : values) {
            doubles.add((double) value);
        }
        return doubles;
    }
}
