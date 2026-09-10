package com.aidevassistant.memory.adapter.out.embedded;

import com.aidevassistant.memory.domain.model.Embedding;
import com.aidevassistant.memory.domain.model.KnowledgeEntry;
import com.aidevassistant.memory.domain.model.KnowledgeStatus;
import com.aidevassistant.memory.domain.model.KnowledgeUsage;
import com.aidevassistant.projectcontext.domain.model.TechnicalContext;
import com.aidevassistant.prompt.domain.model.NormalizedPrompt;
import com.aidevassistant.prompt.domain.model.Prompt;
import com.aidevassistant.prompt.domain.model.PromptHash;
import org.apache.lucene.document.Document;
import org.apache.lucene.document.Field;
import org.apache.lucene.document.KnnFloatVectorField;
import org.apache.lucene.document.StoredField;
import org.apache.lucene.document.StringField;
import org.apache.lucene.index.VectorSimilarityFunction;
import org.apache.lucene.util.BytesRef;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.Arrays;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeMap;

final class LuceneKnowledgeDocumentMapper {

    static final int CURRENT_SCHEMA_VERSION = 1;
    static final String ID = "id";
    static final String DEDUPLICATION_KEY = "deduplicationKey";
    static final String PROMPT_HASH = "promptHash";
    static final String NORMALIZATION_VERSION = "normalizationVersion";
    static final String STATUS = "status";
    static final String EMBEDDING_MODEL = "embeddingModel";
    static final String EMBEDDING_MODEL_VERSION = "embeddingModelVersion";
    static final String EMBEDDING_DIMENSION = "embeddingDimension";
    static final String EMBEDDING_VECTOR = "embeddingVector";

    private static final String SCHEMA_VERSION = "schemaVersion";
    private static final String PROMPT_ORIGINAL = "promptOriginal";
    private static final String PROMPT_NORMALIZED = "promptNormalized";
    private static final String SOLUTION = "solution";
    private static final String REUSE_COUNT = "reuseCount";
    private static final String LAST_USED_AT = "lastUsedAt";
    private static final String TECHNOLOGY = "technology";
    private static final String TECHNOLOGY_VERSION = "technologyVersion";
    private static final String TASK_TYPE = "taskType";
    private static final String EMBEDDING_VALUES = "embeddingValues";
    private static final String CREATED_AT = "createdAt";
    private static final String UPDATED_AT = "updatedAt";
    private static final String VERSION_SEPARATOR = ".";

    Document toDocument(KnowledgeEntry knowledge) {
        Document document = new Document();
        document.add(new StoredField(SCHEMA_VERSION, CURRENT_SCHEMA_VERSION));
        document.add(keyword(ID, knowledge.id().toString()));
        document.add(keyword(DEDUPLICATION_KEY, deduplicationKey(knowledge)));
        document.add(new StoredField(PROMPT_ORIGINAL, knowledge.prompt().value()));
        document.add(new StoredField(PROMPT_NORMALIZED, knowledge.normalizedPrompt().value()));
        document.add(keyword(NORMALIZATION_VERSION,
                Integer.toString(knowledge.normalizedPrompt().normalizationVersion())));
        document.add(keyword(PROMPT_HASH, knowledge.promptHash().value()));
        document.add(new StoredField(SOLUTION, knowledge.solution()));
        document.add(keyword(STATUS, knowledge.status().name()));
        document.add(new StoredField(REUSE_COUNT, knowledge.usage().reuseCount()));
        if (knowledge.usage().lastUsedAt() != null) {
            document.add(new StoredField(LAST_USED_AT, knowledge.usage().lastUsedAt().toString()));
        }
        addTechnicalContext(document, knowledge.technicalContext());
        knowledge.embedding().ifPresent(embedding -> addEmbedding(document, embedding));
        document.add(new StoredField(CREATED_AT, knowledge.createdAt().toString()));
        document.add(new StoredField(UPDATED_AT, knowledge.updatedAt().toString()));
        return document;
    }

    KnowledgeEntry toDomain(Document document) {
        int schemaVersion = requiredNumber(document, SCHEMA_VERSION).intValue();
        if (schemaVersion != CURRENT_SCHEMA_VERSION) {
            throw new LocalMemoryStorageException(
                    "Unsupported local memory document schema version: " + schemaVersion);
        }

        int normalizationVersion = Integer.parseInt(requiredString(document, NORMALIZATION_VERSION));
        Instant lastUsedAt = optionalString(document, LAST_USED_AT).map(Instant::parse).orElse(null);
        return new KnowledgeEntry(
                java.util.UUID.fromString(requiredString(document, ID)),
                new Prompt(requiredString(document, PROMPT_ORIGINAL)),
                new NormalizedPrompt(requiredString(document, PROMPT_NORMALIZED), normalizationVersion),
                new PromptHash(requiredString(document, PROMPT_HASH), normalizationVersion),
                requiredString(document, SOLUTION),
                KnowledgeStatus.valueOf(requiredString(document, STATUS)),
                new KnowledgeUsage(requiredNumber(document, REUSE_COUNT).longValue(), lastUsedAt),
                technicalContext(document),
                embedding(document),
                Instant.parse(requiredString(document, CREATED_AT)),
                Instant.parse(requiredString(document, UPDATED_AT)));
    }

    String deduplicationKey(KnowledgeEntry knowledge) {
        return "v1:" + knowledge.promptHash().value() + ":" + sha256(knowledge.solution());
    }

    private void addTechnicalContext(Document document, TechnicalContext context) {
        context.technologies().stream().sorted()
                .forEach(technology -> document.add(new StoredField(TECHNOLOGY, technology)));
        context.versions().entrySet().stream()
                .sorted(Map.Entry.comparingByKey())
                .map(entry -> encode(entry.getKey()) + VERSION_SEPARATOR + encode(entry.getValue()))
                .forEach(version -> document.add(new StoredField(TECHNOLOGY_VERSION, version)));
        context.taskType().ifPresent(taskType -> document.add(new StoredField(TASK_TYPE, taskType)));
    }

    private TechnicalContext technicalContext(Document document) {
        Set<String> technologies = Set.of(document.getValues(TECHNOLOGY));
        Map<String, String> versions = new TreeMap<>();
        for (String persistedVersion : document.getValues(TECHNOLOGY_VERSION)) {
            String[] parts = persistedVersion.split("\\.", 2);
            if (parts.length != 2) {
                throw new LocalMemoryStorageException("Invalid persisted technology version");
            }
            versions.put(decode(parts[0]), decode(parts[1]));
        }
        return new TechnicalContext(technologies, versions, optionalString(document, TASK_TYPE));
    }

    private void addEmbedding(Document document, Embedding embedding) {
        document.add(keyword(EMBEDDING_MODEL, embedding.model()));
        document.add(keyword(EMBEDDING_MODEL_VERSION, embedding.modelVersion()));
        document.add(keyword(EMBEDDING_DIMENSION, Integer.toString(embedding.dimension())));
        document.add(new StoredField(EMBEDDING_VALUES, encodeVector(embedding.values())));
        document.add(new KnnFloatVectorField(
                EMBEDDING_VECTOR,
                embedding.values(),
                VectorSimilarityFunction.COSINE));
    }

    private Optional<Embedding> embedding(Document document) {
        String model = document.get(EMBEDDING_MODEL);
        if (model == null) {
            return Optional.empty();
        }
        String modelVersion = requiredString(document, EMBEDDING_MODEL_VERSION);
        int dimension = Integer.parseInt(requiredString(document, EMBEDDING_DIMENSION));
        BytesRef binaryValue = requiredBinary(document, EMBEDDING_VALUES);
        byte[] persisted = Arrays.copyOfRange(
                binaryValue.bytes,
                binaryValue.offset,
                binaryValue.offset + binaryValue.length);
        float[] values = decodeVector(persisted);
        if (values.length != dimension) {
            throw new LocalMemoryStorageException("Persisted embedding dimension does not match its vector");
        }
        return Optional.of(new Embedding(model, modelVersion, values));
    }

    private StringField keyword(String name, String value) {
        return new StringField(name, value, Field.Store.YES);
    }

    private String requiredString(Document document, String field) {
        return optionalString(document, field)
                .orElseThrow(() -> new LocalMemoryStorageException("Missing local memory field: " + field));
    }

    private Optional<String> optionalString(Document document, String field) {
        return Optional.ofNullable(document.get(field));
    }

    private Number requiredNumber(Document document, String field) {
        var persistedField = document.getField(field);
        if (persistedField == null || persistedField.numericValue() == null) {
            throw new LocalMemoryStorageException("Missing numeric local memory field: " + field);
        }
        return persistedField.numericValue();
    }

    private BytesRef requiredBinary(Document document, String field) {
        var persistedField = document.getField(field);
        if (persistedField == null || persistedField.binaryValue() == null) {
            throw new LocalMemoryStorageException("Missing binary local memory field: " + field);
        }
        return persistedField.binaryValue();
    }

    private byte[] encodeVector(float[] values) {
        ByteBuffer buffer = ByteBuffer.allocate(values.length * Float.BYTES);
        for (float value : values) {
            buffer.putFloat(value);
        }
        return buffer.array();
    }

    private float[] decodeVector(byte[] persisted) {
        if (persisted.length % Float.BYTES != 0) {
            throw new LocalMemoryStorageException("Persisted embedding vector has an invalid byte length");
        }
        ByteBuffer buffer = ByteBuffer.wrap(persisted);
        float[] values = new float[persisted.length / Float.BYTES];
        for (int index = 0; index < values.length; index++) {
            values[index] = buffer.getFloat();
        }
        return values;
    }

    private String encode(String value) {
        return Base64.getUrlEncoder().withoutPadding()
                .encodeToString(value.getBytes(StandardCharsets.UTF_8));
    }

    private String decode(String value) {
        return new String(Base64.getUrlDecoder().decode(value), StandardCharsets.UTF_8);
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
