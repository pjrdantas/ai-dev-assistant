package com.aidevassistant.prompt.adapter.in.rest;

import com.aidevassistant.prompt.application.exception.AiInvocationException;
import com.aidevassistant.prompt.application.exception.MemoryPersistenceException;
import com.aidevassistant.prompt.application.exception.MemoryUnavailableException;
import com.aidevassistant.prompt.application.exception.SensitiveContentException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

import java.util.UUID;

@RestControllerAdvice
public final class PromptExceptionHandler {

    @ExceptionHandler({
            MethodArgumentNotValidException.class,
            MethodArgumentTypeMismatchException.class,
            HttpMessageNotReadableException.class,
            IllegalArgumentException.class
    })
    ResponseEntity<ProblemDetail> invalidRequest(Exception ignored) {
        return problem(
                HttpStatus.BAD_REQUEST,
                "Invalid request",
                "The request is missing required data or contains invalid values.",
                "INVALID_PROMPT");
    }

    @ExceptionHandler(SensitiveContentException.class)
    ResponseEntity<ProblemDetail> sensitiveContent(SensitiveContentException ignored) {
        return problem(
                HttpStatus.UNPROCESSABLE_CONTENT,
                "Sensitive context rejected",
                "The request could not be sent externally with the supplied content.",
                "SENSITIVE_CONTEXT_REJECTED");
    }

    @ExceptionHandler(MemoryUnavailableException.class)
    ResponseEntity<ProblemDetail> memoryUnavailable(MemoryUnavailableException ignored) {
        return problem(
                HttpStatus.SERVICE_UNAVAILABLE,
                "Local memory unavailable",
                "The mandatory local memory lookup could not be completed.",
                "MEMORY_UNAVAILABLE");
    }

    @ExceptionHandler(MemoryPersistenceException.class)
    ResponseEntity<ProblemDetail> memoryPersistence(MemoryPersistenceException ignored) {
        return problem(
                HttpStatus.SERVICE_UNAVAILABLE,
                "Local memory persistence failed",
                "The external response could not be persisted safely.",
                "MEMORY_PERSISTENCE_FAILURE");
    }

    @ExceptionHandler(AiInvocationException.class)
    ResponseEntity<ProblemDetail> aiInvocation(AiInvocationException exception) {
        return switch (exception.reason()) {
            case MISMATCH -> problem(
                    HttpStatus.CONFLICT,
                    "AI invocation mismatch",
                    "This invocation was already completed with different content.",
                    "AI_INVOCATION_MISMATCH");
            case UNKNOWN_OR_EXPIRED -> problem(
                    HttpStatus.GONE,
                    "AI invocation expired",
                    "The AI invocation is unknown or no longer valid.",
                    "AI_INVOCATION_EXPIRED");
            case REJECTED -> problem(
                    HttpStatus.UNPROCESSABLE_CONTENT,
                    "AI invocation rejected",
                    "The external AI request could not be authorized safely.",
                    "AI_INVOCATION_REJECTED");
        };
    }

    private ResponseEntity<ProblemDetail> problem(
            HttpStatus status,
            String title,
            String detail,
            String code) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(status, detail);
        problem.setTitle(title);
        problem.setProperty("code", code);
        problem.setProperty("requestId", UUID.randomUUID());
        return ResponseEntity.status(status).body(problem);
    }
}
