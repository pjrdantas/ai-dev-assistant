package com.aidevassistant.memory.adapter.out.onnx;

final class EmbeddingModelException extends RuntimeException {

    EmbeddingModelException(String message) {
        super(message);
    }

    EmbeddingModelException(String message, Throwable cause) {
        super(message, cause);
    }
}
