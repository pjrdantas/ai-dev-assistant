package com.aidevassistant.prompt.application.exception;

public final class MemoryUnavailableException extends RuntimeException {

    public MemoryUnavailableException(String message) {
        super(message);
    }

    public MemoryUnavailableException(String message, Throwable cause) {
        super(message, cause);
    }
}
