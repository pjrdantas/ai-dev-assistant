package com.aidevassistant.memory.adapter.out.embedded;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.nio.file.Path;
import java.util.Objects;

@ConfigurationProperties("memory.local")
public final class EmbeddedMemoryProperties {

    private Path directory = Path.of(System.getProperty("user.home"), ".ai-dev-assistant", "memory");
    private int dimension = 384;
    private int topK = 5;

    public Path getDirectory() {
        return directory;
    }

    public void setDirectory(Path directory) {
        this.directory = directory;
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

    Path validatedDirectory() {
        Objects.requireNonNull(directory, "Local memory directory must not be null");
        return directory.toAbsolutePath().normalize();
    }

    int validatedDimension() {
        if (dimension <= 0 || dimension > 1024) {
            throw new IllegalArgumentException("Embedding dimension must be between 1 and 1024");
        }
        return dimension;
    }

    int validatedTopK() {
        if (topK <= 0) {
            throw new IllegalArgumentException("Semantic search top-k must be positive");
        }
        return topK;
    }
}
