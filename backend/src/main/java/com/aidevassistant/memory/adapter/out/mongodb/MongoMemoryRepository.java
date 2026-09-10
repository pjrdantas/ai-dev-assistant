package com.aidevassistant.memory.adapter.out.mongodb;

import com.aidevassistant.memory.application.port.out.MemoryRepository;
import com.aidevassistant.memory.domain.model.KnowledgeEntry;
import com.aidevassistant.memory.domain.model.KnowledgeStatus;
import com.aidevassistant.prompt.domain.model.PromptHash;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.FindAndModifyOptions;
import org.springframework.data.mongodb.core.MongoOperations;
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

    MongoMemoryRepository(MongoOperations mongoOperations, MongoMemoryMapper mapper) {
        this.mongoOperations = mongoOperations;
        this.mapper = mapper;
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
}
