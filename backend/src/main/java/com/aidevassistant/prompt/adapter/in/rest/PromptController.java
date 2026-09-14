package com.aidevassistant.prompt.adapter.in.rest;

import com.aidevassistant.prompt.application.model.PromptProcessingResult;
import com.aidevassistant.prompt.application.port.in.CompleteAiResponseUseCase;
import com.aidevassistant.prompt.application.port.in.ProcessPromptUseCase;
import com.aidevassistant.prompt.domain.model.AssistantResponse;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/prompts")
public final class PromptController {

    private final ProcessPromptUseCase processPrompt;
    private final CompleteAiResponseUseCase completeAiResponse;
    private final PromptRestMapper mapper = new PromptRestMapper();

    public PromptController(
            ProcessPromptUseCase processPrompt,
            CompleteAiResponseUseCase completeAiResponse) {
        this.processPrompt = processPrompt;
        this.completeAiResponse = completeAiResponse;
    }

    @PostMapping
    public ResponseEntity<PromptResponse> process(
            @Valid @RequestBody ProcessPromptRequest request) {
        PromptProcessingResult result = processPrompt.process(mapper.toCommand(request));
        if (result.completedResponse().isPresent()) {
            return ResponseEntity.ok(mapper.toCompletedResponse(
                    UUID.randomUUID(), result.completedResponse().orElseThrow()));
        }
        PromptResponse response = mapper.toPendingResponse(result.externalAiRequest().orElseThrow());
        return ResponseEntity.accepted()
                .location(URI.create("/api/v1/prompts/" + response.requestId()))
                .body(response);
    }

    @PostMapping("/{requestId}/ai-response")
    public ResponseEntity<PromptResponse> complete(
            @PathVariable UUID requestId,
            @Valid @RequestBody CompleteAiResponseRequest request) {
        AssistantResponse response = completeAiResponse.complete(mapper.toCommand(requestId, request));
        return ResponseEntity.ok(mapper.toCompletedResponse(requestId, response));
    }
}
