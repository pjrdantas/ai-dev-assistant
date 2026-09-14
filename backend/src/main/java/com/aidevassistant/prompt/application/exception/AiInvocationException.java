package com.aidevassistant.prompt.application.exception;

import java.util.Objects;

public final class AiInvocationException extends RuntimeException {

    private final Reason reason;

    public AiInvocationException(String message) {
        this(Reason.REJECTED, message);
    }

    public AiInvocationException(Reason reason, String message) {
        super(message);
        this.reason = Objects.requireNonNull(reason, "AI invocation reason must not be null");
    }

    public Reason reason() {
        return reason;
    }

    public enum Reason {
        REJECTED,
        MISMATCH,
        UNKNOWN_OR_EXPIRED
    }
}
