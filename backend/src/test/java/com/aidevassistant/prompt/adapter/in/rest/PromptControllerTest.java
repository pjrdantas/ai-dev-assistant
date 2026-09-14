package com.aidevassistant.prompt.adapter.in.rest;

import com.aidevassistant.memory.domain.model.MatchType;
import com.aidevassistant.projectcontext.domain.model.TechnicalContext;
import com.aidevassistant.prompt.application.exception.AiInvocationException;
import com.aidevassistant.prompt.application.exception.MemoryUnavailableException;
import com.aidevassistant.prompt.application.model.ExternalAiRequest;
import com.aidevassistant.prompt.application.model.PromptProcessingResult;
import com.aidevassistant.prompt.application.port.in.CompleteAiResponseCommand;
import com.aidevassistant.prompt.application.port.in.CompleteAiResponseUseCase;
import com.aidevassistant.prompt.application.port.in.ProcessPromptCommand;
import com.aidevassistant.prompt.application.port.in.ProcessPromptUseCase;
import com.aidevassistant.prompt.domain.model.AssistantResponse;
import com.aidevassistant.prompt.domain.model.Prompt;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class PromptControllerTest {

    private ProcessPromptUseCase processPrompt;
    private CompleteAiResponseUseCase completeAiResponse;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        processPrompt = mock(ProcessPromptUseCase.class);
        completeAiResponse = mock(CompleteAiResponseUseCase.class);
        mockMvc = MockMvcBuilders
                .standaloneSetup(new PromptController(processPrompt, completeAiResponse))
                .setControllerAdvice(new PromptExceptionHandler())
                .build();
    }

    @Test
    void returnsACompletedLocalResponseAndMapsOnlyStructuredContext() throws Exception {
        UUID memoryId = UUID.randomUUID();
        when(processPrompt.process(any())).thenReturn(PromptProcessingResult.completed(
                AssistantResponse.fromLocalMemory("Local solution", 0.96, memoryId)));

        mockMvc.perform(post("/api/v1/prompts")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "prompt": "Create an endpoint",
                                  "projectContext": {
                                    "projectId": "ignored-fingerprint",
                                    "languages": [{"name": "JAVA", "version": "21"}],
                                    "frameworks": [{"name": "SPRING_BOOT", "version": "4"}],
                                    "buildTool": "MAVEN"
                                  }
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("COMPLETED"))
                .andExpect(jsonPath("$.source").value("LOCAL_MEMORY"))
                .andExpect(jsonPath("$.matchType").value("FULL"))
                .andExpect(jsonPath("$.aiCalled").value(false))
                .andExpect(jsonPath("$.memoryId").value(memoryId.toString()));

        ArgumentCaptor<ProcessPromptCommand> command =
                ArgumentCaptor.forClass(ProcessPromptCommand.class);
        verify(processPrompt).process(command.capture());
        assertEquals(Set.of("java", "spring_boot", "maven"),
                command.getValue().technicalContext().technologies());
        assertEquals("21", command.getValue().technicalContext().versions().get("java"));
    }

    @Test
    void returnsOnlyTheBackendAuthorizedExternalRequest() throws Exception {
        UUID invocationId = UUID.randomUUID();
        ExternalAiRequest request = ExternalAiRequest.partial(
                invocationId,
                new Prompt("Create an endpoint"),
                new TechnicalContext(
                        Set.of("java"), Map.of("java", "21"), Optional.of("code")),
                0.82,
                "Reusable solution",
                List.of("framework version differs"),
                Instant.parse("2026-09-10T18:00:00Z"));
        when(processPrompt.process(any())).thenReturn(PromptProcessingResult.pending(request));

        mockMvc.perform(post("/api/v1/prompts")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"prompt\":\"Create an endpoint\"}"))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.requestId").value(invocationId.toString()))
                .andExpect(jsonPath("$.status").value("AI_REQUIRED"))
                .andExpect(jsonPath("$.aiRequest.prompt").value("Create an endpoint"))
                .andExpect(jsonPath("$.aiRequest.reusableSolution").value("Reusable solution"))
                .andExpect(jsonPath("$.aiRequest.requiredAdaptations[0]")
                        .value("framework version differs"));
    }

    @Test
    void acceptsModelCountedMetricsWhenCompletingAnAuthorizedInvocation() throws Exception {
        UUID invocationId = UUID.randomUUID();
        UUID memoryId = UUID.randomUUID();
        when(completeAiResponse.complete(any()))
                .thenReturn(AssistantResponse.fromAi("External solution", memoryId));

        mockMvc.perform(post("/api/v1/prompts/{requestId}/ai-response", invocationId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "response": "External solution",
                                  "executionMetrics": {
                                    "inputTokens": 120,
                                    "outputTokens": 45,
                                    "durationMs": 900
                                  }
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.requestId").value(invocationId.toString()))
                .andExpect(jsonPath("$.source").value("AI"))
                .andExpect(jsonPath("$.aiCalled").value(true));

        ArgumentCaptor<CompleteAiResponseCommand> command =
                ArgumentCaptor.forClass(CompleteAiResponseCommand.class);
        verify(completeAiResponse).complete(command.capture());
        assertEquals(120, command.getValue().executionMetrics().orElseThrow().inputTokens());
        assertEquals(900, command.getValue().executionMetrics().orElseThrow().duration().toMillis());
    }

    @Test
    void returnsSafeErrorsWithoutApplicationContent() throws Exception {
        when(processPrompt.process(any()))
                .thenThrow(new MemoryUnavailableException("internal path and prompt"));

        mockMvc.perform(post("/api/v1/prompts")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"prompt\":\"private content\"}"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("MEMORY_UNAVAILABLE"))
                .andExpect(jsonPath("$.detail")
                        .value("The mandatory local memory lookup could not be completed."))
                .andExpect(jsonPath("$.detail").value(org.hamcrest.Matchers.not(
                        org.hamcrest.Matchers.containsString("private content"))));
    }

    @Test
    void mapsUnknownOrExpiredInvocationsToGone() throws Exception {
        when(completeAiResponse.complete(any())).thenThrow(new AiInvocationException(
                AiInvocationException.Reason.UNKNOWN_OR_EXPIRED,
                "unknown internal invocation"));

        mockMvc.perform(post(
                        "/api/v1/prompts/{requestId}/ai-response", UUID.randomUUID())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"response\":\"External solution\"}"))
                .andExpect(status().isGone())
                .andExpect(jsonPath("$.code").value("AI_INVOCATION_EXPIRED"));
    }

    @Test
    void rejectsBlankPromptsBeforeCallingTheUseCase() throws Exception {
        mockMvc.perform(post("/api/v1/prompts")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"prompt\":\"   \"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_PROMPT"));

        assertTrue(org.mockito.Mockito.mockingDetails(processPrompt)
                .getInvocations().isEmpty());
    }
}
