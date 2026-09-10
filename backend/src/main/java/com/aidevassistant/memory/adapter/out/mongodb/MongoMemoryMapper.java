package com.aidevassistant.memory.adapter.out.mongodb;

import com.aidevassistant.memory.domain.model.Embedding;
import com.aidevassistant.memory.domain.model.KnowledgeEntry;
import com.aidevassistant.memory.domain.model.KnowledgeStatus;
import com.aidevassistant.memory.domain.model.KnowledgeUsage;
import com.aidevassistant.prompt.domain.model.NormalizedPrompt;
import com.aidevassistant.prompt.domain.model.Prompt;
import com.aidevassistant.prompt.domain.model.PromptHash;
import com.aidevassistant.projectcontext.domain.model.TechnicalContext;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Optional;

final class MongoMemoryMapper {

    KnowledgeDocument toDocument(KnowledgeEntry knowledge) {
        return new KnowledgeDocument(
                knowledge.id().toString(),
                KnowledgeDocument.CURRENT_SCHEMA_VERSION,
                knowledge.prompt().value(),
                knowledge.normalizedPrompt().value(),
                knowledge.normalizedPrompt().normalizationVersion(),
                knowledge.promptHash().value(),
                knowledge.solution(),
                deduplicationKey(knowledge),
                knowledge.status().name(),
                knowledge.usage().reuseCount(),
                knowledge.usage().lastUsedAt(),
                toDocument(knowledge.technicalContext()),
                knowledge.embedding().map(this::toDocument).orElse(null),
                knowledge.createdAt(),
                knowledge.updatedAt());
    }

    KnowledgeEntry toDomain(KnowledgeDocument document) {
        return new KnowledgeEntry(
                java.util.UUID.fromString(document.id()),
                new Prompt(document.promptOriginal()),
                new NormalizedPrompt(document.promptNormalized(), document.normalizationVersion()),
                new PromptHash(document.promptHash(), document.normalizationVersion()),
                document.solution(),
                KnowledgeStatus.valueOf(document.status()),
                new KnowledgeUsage(document.reuseCount(), document.lastUsedAt()),
                document.technicalContext() == null
                        ? TechnicalContext.empty()
                        : toDomain(document.technicalContext()),
                Optional.ofNullable(document.embedding()).map(this::toDomain),
                document.createdAt(),
                document.updatedAt());
    }

    TechnicalContextDocument toDocument(TechnicalContext context) {
        return new TechnicalContextDocument(
                context.technologies().stream().sorted().toList(),
                context.versions(),
                context.taskType().orElse(null));
    }

    TechnicalContext toDomain(TechnicalContextDocument document) {
        return new TechnicalContext(
                java.util.Set.copyOf(document.technologies()),
                document.versions(),
                Optional.ofNullable(document.taskType()));
    }

    EmbeddingDocument toDocument(Embedding embedding) {
        float[] values = embedding.values();
        java.util.List<Double> persistedValues = new java.util.ArrayList<>(values.length);
        for (float value : values) {
            persistedValues.add((double) value);
        }
        return new EmbeddingDocument(
                embedding.model(),
                embedding.modelVersion(),
                embedding.dimension(),
                persistedValues);
    }

    Embedding toDomain(EmbeddingDocument document) {
        float[] values = new float[document.values().size()];
        for (int index = 0; index < values.length; index++) {
            values[index] = document.values().get(index).floatValue();
        }
        if (document.dimension() != values.length) {
            throw new IllegalStateException("Persisted embedding dimension does not match its vector");
        }
        return new Embedding(document.model(), document.modelVersion(), values);
    }

    private String deduplicationKey(KnowledgeEntry knowledge) {
        return "v1:" + knowledge.promptHash().value() + ":" + sha256(knowledge.solution());
    }

    private String sha256(String value) {
        try {
            byte[] digest = MessageDigest.getInstance(PromptHash.ALGORITHM)
                    .digest(value.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is not available", exception);
        }
    }
}
