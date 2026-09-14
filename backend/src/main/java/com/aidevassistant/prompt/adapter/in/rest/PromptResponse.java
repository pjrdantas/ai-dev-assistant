package com.aidevassistant.prompt.adapter.in.rest;

import com.aidevassistant.memory.domain.model.MatchType;
import com.fasterxml.jackson.annotation.JsonInclude;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record PromptResponse(
        UUID requestId,
        String status,
        String response,
        String source,
        MatchType matchType,
        Double similarity,
        Boolean aiCalled,
        Boolean externalSearchCalled,
        UUID memoryId,
        Instant expiresAt,
        AuthorizedAiRequest aiRequest) {

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record AuthorizedAiRequest(
            String prompt,
            TechnicalContextResponse technicalContext,
            String reusableSolution,
            List<String> requiredAdaptations) {
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record TechnicalContextResponse(
            Set<String> technologies,
            Map<String, String> versions,
            String taskType) {
    }
}
