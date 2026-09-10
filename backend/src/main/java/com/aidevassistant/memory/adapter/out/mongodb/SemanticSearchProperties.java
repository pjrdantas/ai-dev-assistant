package com.aidevassistant.memory.adapter.out.mongodb;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;
import java.util.Objects;

@ConfigurationProperties("memory.semantic-search")
public final class SemanticSearchProperties {

    private String indexName = "semantic_vector_idx";
    private int dimension = 384;
    private int topK = 5;
    private int numCandidates = 100;
    private Duration readinessTimeout = Duration.ofSeconds(90);
    private Duration readinessPollInterval = Duration.ofMillis(250);

    public String getIndexName() {
        return indexName;
    }

    public void setIndexName(String indexName) {
        this.indexName = indexName;
    }

    public int getDimension() {
        return dimension;
    }

    public void setDimension(int dimension) {
        this.dimension = dimension;
    }

    public int getTopK() {
        return topK;
    }

    public void setTopK(int topK) {
        this.topK = topK;
    }

    public int getNumCandidates() {
        return numCandidates;
    }

    public void setNumCandidates(int numCandidates) {
        this.numCandidates = numCandidates;
    }

    public Duration getReadinessTimeout() {
        return readinessTimeout;
    }

    public void setReadinessTimeout(Duration readinessTimeout) {
        this.readinessTimeout = readinessTimeout;
    }

    public Duration getReadinessPollInterval() {
        return readinessPollInterval;
    }

    public void setReadinessPollInterval(Duration readinessPollInterval) {
        this.readinessPollInterval = readinessPollInterval;
    }

    void validate() {
        Objects.requireNonNull(indexName, "Semantic search index name must not be null");
        Objects.requireNonNull(readinessTimeout, "Index readiness timeout must not be null");
        Objects.requireNonNull(readinessPollInterval, "Index readiness poll interval must not be null");
        if (indexName.isBlank()) {
            throw new IllegalArgumentException("Semantic search index name must not be blank");
        }
        if (dimension <= 0) {
            throw new IllegalArgumentException("Embedding dimension must be positive");
        }
        if (topK <= 0) {
            throw new IllegalArgumentException("Semantic search top-k must be positive");
        }
        if (numCandidates < topK) {
            throw new IllegalArgumentException("Semantic search candidates must be greater than or equal to top-k");
        }
        if (readinessTimeout.isZero() || readinessTimeout.isNegative()) {
            throw new IllegalArgumentException("Index readiness timeout must be positive");
        }
        if (readinessPollInterval.toMillis() < 1) {
            throw new IllegalArgumentException("Index readiness poll interval must be at least one millisecond");
        }
    }
}
