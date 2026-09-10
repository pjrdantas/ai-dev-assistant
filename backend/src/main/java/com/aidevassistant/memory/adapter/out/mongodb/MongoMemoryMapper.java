package com.aidevassistant.memory.adapter.out.mongodb;

import com.aidevassistant.memory.domain.model.KnowledgeEntry;
import com.aidevassistant.memory.domain.model.KnowledgeStatus;
import com.aidevassistant.memory.domain.model.KnowledgeUsage;
import com.aidevassistant.prompt.domain.model.NormalizedPrompt;
import com.aidevassistant.prompt.domain.model.Prompt;
import com.aidevassistant.prompt.domain.model.PromptHash;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

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
                document.createdAt(),
                document.updatedAt());
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
