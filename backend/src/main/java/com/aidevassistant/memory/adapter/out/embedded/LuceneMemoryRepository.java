package com.aidevassistant.memory.adapter.out.embedded;

import com.aidevassistant.memory.application.port.out.MemoryRepository;
import com.aidevassistant.memory.application.port.out.SemanticMemoryCandidate;
import com.aidevassistant.memory.domain.model.Embedding;
import com.aidevassistant.memory.domain.model.KnowledgeEntry;
import com.aidevassistant.memory.domain.model.KnowledgeStatus;
import com.aidevassistant.prompt.domain.model.PromptHash;
import org.apache.lucene.analysis.Analyzer;
import org.apache.lucene.analysis.core.KeywordAnalyzer;
import org.apache.lucene.document.Document;
import org.apache.lucene.index.DirectoryReader;
import org.apache.lucene.index.IndexWriter;
import org.apache.lucene.index.IndexWriterConfig;
import org.apache.lucene.index.Term;
import org.apache.lucene.search.BooleanClause;
import org.apache.lucene.search.BooleanQuery;
import org.apache.lucene.search.IndexSearcher;
import org.apache.lucene.search.KnnFloatVectorQuery;
import org.apache.lucene.search.Query;
import org.apache.lucene.search.ScoreDoc;
import org.apache.lucene.search.SearcherFactory;
import org.apache.lucene.search.SearcherManager;
import org.apache.lucene.search.TermQuery;
import org.apache.lucene.search.TopDocs;
import org.apache.lucene.store.Directory;
import org.apache.lucene.store.FSDirectory;
import org.apache.lucene.util.IOUtils;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

final class LuceneMemoryRepository implements MemoryRepository, AutoCloseable {

    private static final String INDEX_SCHEMA_KEY = "localMemorySchemaVersion";
    private static final String INDEX_SCHEMA_VERSION = "1";
    private static final String INDEX_DIMENSION_KEY = "embeddingDimension";

    private final Object mutationLock = new Object();
    private final int dimension;
    private final int topK;
    private final Analyzer analyzer;
    private final Directory directory;
    private final IndexWriter writer;
    private final SearcherManager searcherManager;
    private final LuceneKnowledgeDocumentMapper mapper = new LuceneKnowledgeDocumentMapper();
    private boolean closed;

    LuceneMemoryRepository(Path directoryPath, int dimension, int topK) {
        Objects.requireNonNull(directoryPath, "Local memory directory must not be null");
        if (dimension <= 0 || dimension > 1024) {
            throw new IllegalArgumentException("Embedding dimension must be between 1 and 1024");
        }
        if (topK <= 0) {
            throw new IllegalArgumentException("Semantic search top-k must be positive");
        }
        this.dimension = dimension;
        this.topK = topK;

        try {
            Path normalizedDirectory = directoryPath.toAbsolutePath().normalize();
            Files.createDirectories(normalizedDirectory);
            this.directory = FSDirectory.open(normalizedDirectory);
            boolean existingIndex = DirectoryReader.indexExists(directory);
            if (existingIndex) {
                validateIndexSchema(directory, dimension);
            }
            this.analyzer = new KeywordAnalyzer();
            IndexWriterConfig writerConfig = new IndexWriterConfig(analyzer)
                    .setOpenMode(IndexWriterConfig.OpenMode.CREATE_OR_APPEND);
            this.writer = new IndexWriter(directory, writerConfig);
            this.writer.setLiveCommitData(Map.of(
                    INDEX_SCHEMA_KEY, INDEX_SCHEMA_VERSION,
                    INDEX_DIMENSION_KEY, Integer.toString(dimension)).entrySet());
            if (!existingIndex) {
                this.writer.commit();
            }
            this.searcherManager = new SearcherManager(writer, new SearcherFactory());
        } catch (IOException exception) {
            throw new LocalMemoryStorageException("Could not initialize local memory", exception);
        }
    }

    @Override
    public List<KnowledgeEntry> findActiveByPromptHash(PromptHash promptHash) {
        Objects.requireNonNull(promptHash, "Prompt hash must not be null");
        synchronized (mutationLock) {
            Query query = filters(
                    term(LuceneKnowledgeDocumentMapper.PROMPT_HASH, promptHash.value()),
                    term(LuceneKnowledgeDocumentMapper.NORMALIZATION_VERSION,
                            Integer.toString(promptHash.normalizationVersion())),
                    term(LuceneKnowledgeDocumentMapper.STATUS, KnowledgeStatus.ACTIVE.name()));

            List<KnowledgeEntry> candidates = withSearcher(
                    searcher -> findAll(searcher, query),
                    "Could not search local memory by prompt hash");
            return candidates.stream()
                    .sorted(Comparator.comparing(KnowledgeEntry::updatedAt).reversed())
                    .toList();
        }
    }

    @Override
    public KnowledgeEntry save(KnowledgeEntry knowledgeEntry) {
        Objects.requireNonNull(knowledgeEntry, "Knowledge entry must not be null");
        synchronized (mutationLock) {
            requireOpen();
            String deduplicationKey = mapper.deduplicationKey(knowledgeEntry);
            Optional<KnowledgeEntry> existing = findOneByTerm(
                    LuceneKnowledgeDocumentMapper.DEDUPLICATION_KEY,
                    deduplicationKey);
            if (existing.isPresent()) {
                return existing.orElseThrow();
            }
            if (findOneByTerm(LuceneKnowledgeDocumentMapper.ID, knowledgeEntry.id().toString()).isPresent()) {
                throw new IllegalArgumentException("Knowledge id already belongs to another entry");
            }
            try {
                writer.addDocument(mapper.toDocument(knowledgeEntry));
                commitAndRefresh();
                return knowledgeEntry;
            } catch (IOException exception) {
                throw new LocalMemoryStorageException("Could not persist knowledge in local memory", exception);
            }
        }
    }

    @Override
    public Optional<KnowledgeEntry> saveEmbedding(UUID knowledgeId, Embedding embedding, Instant generatedAt) {
        Objects.requireNonNull(knowledgeId, "Knowledge id must not be null");
        Objects.requireNonNull(embedding, "Embedding must not be null");
        Objects.requireNonNull(generatedAt, "Embedding generation date must not be null");
        requireConfiguredDimension(embedding);

        synchronized (mutationLock) {
            requireOpen();
            Optional<KnowledgeEntry> existing = findOneByTerm(
                    LuceneKnowledgeDocumentMapper.ID,
                    knowledgeId.toString());
            if (existing.isEmpty()
                    || existing.orElseThrow().status() != KnowledgeStatus.ACTIVE
                    || generatedAt.isBefore(existing.orElseThrow().updatedAt())) {
                return Optional.empty();
            }
            KnowledgeEntry updated = existing.orElseThrow().withEmbedding(embedding, generatedAt);
            replace(updated, "Could not persist embedding in local memory");
            return Optional.of(updated);
        }
    }

    @Override
    public List<SemanticMemoryCandidate> findSimilar(Embedding queryEmbedding) {
        Objects.requireNonNull(queryEmbedding, "Query embedding must not be null");
        requireConfiguredDimension(queryEmbedding);
        synchronized (mutationLock) {
            Query compatibleVectors = filters(
                    term(LuceneKnowledgeDocumentMapper.STATUS, KnowledgeStatus.ACTIVE.name()),
                    term(LuceneKnowledgeDocumentMapper.EMBEDDING_MODEL, queryEmbedding.model()),
                    term(LuceneKnowledgeDocumentMapper.EMBEDDING_MODEL_VERSION, queryEmbedding.modelVersion()),
                    term(LuceneKnowledgeDocumentMapper.EMBEDDING_DIMENSION,
                            Integer.toString(queryEmbedding.dimension())));
            Query nearestNeighbors = new KnnFloatVectorQuery(
                    LuceneKnowledgeDocumentMapper.EMBEDDING_VECTOR,
                    queryEmbedding.values(),
                    topK,
                    compatibleVectors);

            return withSearcher(searcher -> {
                TopDocs topDocs = searcher.search(nearestNeighbors, topK);
                List<SemanticMemoryCandidate> candidates = new ArrayList<>(topDocs.scoreDocs.length);
                for (ScoreDoc scoreDoc : topDocs.scoreDocs) {
                    Document document = searcher.storedFields().document(scoreDoc.doc);
                    candidates.add(new SemanticMemoryCandidate(mapper.toDomain(document), scoreDoc.score));
                }
                return List.copyOf(candidates);
            }, "Could not execute semantic search in local memory");
        }
    }

    @Override
    public Optional<KnowledgeEntry> registerReuse(UUID knowledgeId, Instant usedAt) {
        Objects.requireNonNull(knowledgeId, "Knowledge id must not be null");
        Objects.requireNonNull(usedAt, "Usage date must not be null");

        synchronized (mutationLock) {
            requireOpen();
            Optional<KnowledgeEntry> existing = findOneByTerm(
                    LuceneKnowledgeDocumentMapper.ID,
                    knowledgeId.toString());
            if (existing.isEmpty()
                    || existing.orElseThrow().status() != KnowledgeStatus.ACTIVE
                    || usedAt.isBefore(existing.orElseThrow().updatedAt())) {
                return Optional.empty();
            }
            KnowledgeEntry updated = existing.orElseThrow().registerReuse(usedAt);
            replace(updated, "Could not register local memory reuse");
            return Optional.of(updated);
        }
    }

    @Override
    public void close() {
        synchronized (mutationLock) {
            if (closed) {
                return;
            }
            closed = true;
            try {
                IOUtils.close(searcherManager, writer, directory, analyzer);
            } catch (IOException exception) {
                throw new LocalMemoryStorageException("Could not close local memory", exception);
            }
        }
    }

    private void replace(KnowledgeEntry knowledgeEntry, String failureMessage) {
        try {
            writer.updateDocument(
                    new Term(LuceneKnowledgeDocumentMapper.ID, knowledgeEntry.id().toString()),
                    mapper.toDocument(knowledgeEntry));
            commitAndRefresh();
        } catch (IOException exception) {
            throw new LocalMemoryStorageException(failureMessage, exception);
        }
    }

    private void commitAndRefresh() throws IOException {
        writer.commit();
        searcherManager.maybeRefreshBlocking();
    }

    private Optional<KnowledgeEntry> findOneByTerm(String field, String value) {
        return withSearcher(searcher -> {
            TopDocs result = searcher.search(term(field, value), 1);
            if (result.scoreDocs.length == 0) {
                return Optional.empty();
            }
            Document document = searcher.storedFields().document(result.scoreDocs[0].doc);
            return Optional.of(mapper.toDomain(document));
        }, "Could not read local memory");
    }

    private List<KnowledgeEntry> findAll(IndexSearcher searcher, Query query) throws IOException {
        int limit = Math.max(1, searcher.getIndexReader().maxDoc());
        TopDocs result = searcher.search(query, limit);
        List<KnowledgeEntry> knowledge = new ArrayList<>(result.scoreDocs.length);
        for (ScoreDoc scoreDoc : result.scoreDocs) {
            knowledge.add(mapper.toDomain(searcher.storedFields().document(scoreDoc.doc)));
        }
        return List.copyOf(knowledge);
    }

    private Query filters(Query... filters) {
        BooleanQuery.Builder query = new BooleanQuery.Builder();
        for (Query filter : filters) {
            query.add(filter, BooleanClause.Occur.FILTER);
        }
        return query.build();
    }

    private Query term(String field, String value) {
        return new TermQuery(new Term(field, value));
    }

    private void requireConfiguredDimension(Embedding embedding) {
        if (embedding.dimension() != dimension) {
            throw new IllegalArgumentException(
                    "Embedding dimension must match the configured local memory dimension");
        }
    }

    private void requireOpen() {
        if (closed) {
            throw new LocalMemoryStorageException("Local memory is already closed");
        }
    }

    private <T> T withSearcher(SearchOperation<T> operation, String failureMessage) {
        requireOpen();
        try {
            IndexSearcher searcher = searcherManager.acquire();
            try {
                return operation.execute(searcher);
            } finally {
                searcherManager.release(searcher);
            }
        } catch (IOException exception) {
            throw new LocalMemoryStorageException(failureMessage, exception);
        }
    }

    private void validateIndexSchema(Directory indexDirectory, int configuredDimension) throws IOException {
        try (DirectoryReader reader = DirectoryReader.open(indexDirectory)) {
            Map<String, String> metadata = reader.getIndexCommit().getUserData();
            String persistedVersion = metadata.get(INDEX_SCHEMA_KEY);
            if (!INDEX_SCHEMA_VERSION.equals(persistedVersion)) {
                throw new LocalMemoryStorageException(
                        "Unsupported local memory index schema version: " + persistedVersion);
            }
            String persistedDimension = metadata.get(INDEX_DIMENSION_KEY);
            if (!Integer.toString(configuredDimension).equals(persistedDimension)) {
                throw new LocalMemoryStorageException(
                        "Configured embedding dimension differs from the local memory index: "
                                + persistedDimension);
            }
        }
    }

    @FunctionalInterface
    private interface SearchOperation<T> {

        T execute(IndexSearcher searcher) throws IOException;
    }
}
