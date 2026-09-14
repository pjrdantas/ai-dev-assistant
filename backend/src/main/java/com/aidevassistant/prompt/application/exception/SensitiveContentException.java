package com.aidevassistant.prompt.application.exception;

public final class SensitiveContentException extends RuntimeException {

    public SensitiveContentException(String message) {
        super(message);
    }
}
