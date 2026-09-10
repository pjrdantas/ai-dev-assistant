package com.aidevassistant.memory.adapter.out.embedded;

final class LocalMemoryStorageException extends RuntimeException {

    LocalMemoryStorageException(String message) {
        super(message);
    }

    LocalMemoryStorageException(String message, Throwable cause) {
        super(message, cause);
    }
}
