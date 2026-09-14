package com.aidevassistant.prompt.adapter.in.rest;

import com.aidevassistant.observability.application.model.AiExecutionMetrics;
import com.aidevassistant.projectcontext.domain.model.TechnicalContext;
import com.aidevassistant.prompt.application.model.ExternalAiRequest;
import com.aidevassistant.prompt.application.port.in.CompleteAiResponseCommand;
import com.aidevassistant.prompt.application.port.in.ProcessPromptCommand;
import com.aidevassistant.prompt.domain.model.AssistantResponse;
import com.aidevassistant.prompt.domain.model.Prompt;

import java.time.Duration;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

final class PromptRestMapper {

    ProcessPromptCommand toCommand(ProcessPromptRequest request) {
        return new ProcessPromptCommand(
                new Prompt(request.prompt()),
                toTechnicalContext(request.projectContext()));
    }

    CompleteAiResponseCommand toCommand(UUID invocationId, CompleteAiResponseRequest request) {
        Optional<AiExecutionMetrics> metrics = Optional.ofNullable(request.executionMetrics())
                .map(value -> new AiExecutionMetrics(
                        value.inputTokens(),
                        value.outputTokens(),
                        Duration.ofMillis(value.durationMs())));
        return new CompleteAiResponseCommand(invocationId, request.response(), metrics);
    }

    PromptResponse toCompletedResponse(UUID requestId, AssistantResponse response) {
        return new PromptResponse(
                requestId,
                "COMPLETED",
                response.response(),
                response.source().name(),
                response.matchType(),
                response.similarity().orElse(null),
                response.aiCalled(),
                response.externalSearchCalled(),
                response.memoryId().orElse(null),
                null,
                null);
    }

    PromptResponse toPendingResponse(ExternalAiRequest request) {
        TechnicalContext context = request.technicalContext();
        PromptResponse.TechnicalContextResponse contextResponse =
                new PromptResponse.TechnicalContextResponse(
                        context.technologies(),
                        context.versions(),
                        context.taskType().orElse(null));
        PromptResponse.AuthorizedAiRequest authorizedRequest =
                new PromptResponse.AuthorizedAiRequest(
                        request.prompt().value(),
                        contextResponse,
                        request.reusableSolution().orElse(null),
                        request.requiredAdaptations());
        return new PromptResponse(
                request.invocationId(),
                "AI_REQUIRED",
                null,
                null,
                request.matchType(),
                request.similarity().orElse(null),
                null,
                null,
                null,
                request.expiresAt(),
                authorizedRequest);
    }

    private TechnicalContext toTechnicalContext(
            ProcessPromptRequest.ProjectContextInput projectContext) {
        if (projectContext == null) {
            return TechnicalContext.empty();
        }
        Set<String> technologies = new HashSet<>();
        Map<String, String> versions = new HashMap<>();
        addTechnologies(projectContext.languages(), technologies, versions);
        addTechnologies(projectContext.frameworks(), technologies, versions);
        if (projectContext.buildTool() != null && !projectContext.buildTool().isBlank()) {
            technologies.add(projectContext.buildTool());
        }
        return new TechnicalContext(technologies, versions, Optional.empty());
    }

    private void addTechnologies(
            Iterable<ProcessPromptRequest.TechnologyInput> inputs,
            Set<String> technologies,
            Map<String, String> versions) {
        for (ProcessPromptRequest.TechnologyInput input : inputs) {
            technologies.add(input.name());
            if (input.version() != null && !input.version().isBlank()) {
                versions.put(input.name(), input.version());
            }
        }
    }
}
