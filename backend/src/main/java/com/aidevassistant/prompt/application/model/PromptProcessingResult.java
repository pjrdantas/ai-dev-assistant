package com.aidevassistant.prompt.application.model;

import com.aidevassistant.prompt.domain.model.AssistantResponse;

import java.util.Objects;
import java.util.Optional;

public record PromptProcessingResult(
        Optional<AssistantResponse> completedResponse,
        Optional<ExternalAiRequest> externalAiRequest) {

    public PromptProcessingResult {
        Objects.requireNonNull(completedResponse, "Completed response must not be null");
        Objects.requireNonNull(externalAiRequest, "External AI request must not be null");
        if (completedResponse.isPresent() == externalAiRequest.isPresent()) {
            throw new IllegalArgumentException(
                    "Prompt processing must return either a response or an external AI request");
        }
    }

    public static PromptProcessingResult completed(AssistantResponse response) {
        return new PromptProcessingResult(Optional.of(Objects.requireNonNull(response)), Optional.empty());
    }

    public static PromptProcessingResult pending(ExternalAiRequest request) {
        return new PromptProcessingResult(Optional.empty(), Optional.of(Objects.requireNonNull(request)));
    }
}
