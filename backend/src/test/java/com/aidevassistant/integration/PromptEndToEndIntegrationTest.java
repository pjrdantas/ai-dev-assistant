package com.aidevassistant.integration;

import com.aidevassistant.memory.application.port.out.EmbeddingProvider;
import com.aidevassistant.memory.domain.model.Embedding;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.fail;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = "memory.local.dimension=3")
@AutoConfigureMockMvc
@Import(PromptEndToEndIntegrationTest.DeterministicEmbeddingConfiguration.class)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class PromptEndToEndIntegrationTest {

    private static final String PROMPT_REQUEST = """
            {
              "prompt": "Create a deterministic Java 21 endpoint for the phase 11 test",
              "projectContext": {
                "languages": [{"name": "JAVA", "version": "21"}],
                "frameworks": [],
                "buildTool": "MAVEN"
              }
            }
            """;

    @TempDir
    static Path memoryDirectory;

    @DynamicPropertySource
    static void configureLocalMemory(DynamicPropertyRegistry registry) {
        registry.add("memory.local.directory", memoryDirectory::toString);
    }

    private final MockMvc mockMvc;
    private final ObjectMapper objectMapper;

    @Autowired
    PromptEndToEndIntegrationTest(MockMvc mockMvc, ObjectMapper objectMapper) {
        this.mockMvc = mockMvc;
        this.objectMapper = objectMapper;
    }

    @Test
    void completesAnAuthorizedResponseAndReusesItWithoutAnotherAiCall() throws Exception {
        MvcResult preparation = mockMvc.perform(post("/api/v1/prompts")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(PROMPT_REQUEST))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.status").value("AI_REQUIRED"))
                .andExpect(jsonPath("$.matchType").value("NONE"))
                .andReturn();
        String requestId = objectMapper
                .readTree(preparation.getResponse().getContentAsString(StandardCharsets.UTF_8))
                .path("requestId")
                .stringValue();

        mockMvc.perform(post("/api/v1/prompts/{requestId}/ai-response", requestId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "response": "Use a Java 21 record and a focused application service.",
                                  "executionMetrics": {
                                    "inputTokens": 24,
                                    "outputTokens": 12,
                                    "durationMs": 150
                                  }
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("COMPLETED"))
                .andExpect(jsonPath("$.source").value("AI"))
                .andExpect(jsonPath("$.matchType").value("NONE"))
                .andExpect(jsonPath("$.aiCalled").value(true));

        mockMvc.perform(post("/api/v1/prompts")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(PROMPT_REQUEST))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("COMPLETED"))
                .andExpect(jsonPath("$.response")
                        .value("Use a Java 21 record and a focused application service."))
                .andExpect(jsonPath("$.source").value("LOCAL_MEMORY"))
                .andExpect(jsonPath("$.matchType").value("FULL"))
                .andExpect(jsonPath("$.similarity").value(1.0))
                .andExpect(jsonPath("$.aiCalled").value(false));

        assertEquals(2.0, metricCount("ai.dev.assistant.prompts"));
        assertEquals(1.0, metricCount("ai.dev.assistant.ai.calls"));
        assertEquals(1.0, metricCount("ai.dev.assistant.ai.calls.avoided"));
    }

    private double metricCount(String metricName) throws Exception {
        MvcResult result = mockMvc.perform(get("/actuator/metrics/{metricName}", metricName))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode measurements = objectMapper
                .readTree(result.getResponse().getContentAsString(StandardCharsets.UTF_8))
                .path("measurements");
        for (JsonNode measurement : measurements) {
            if ("COUNT".equals(measurement.path("statistic").stringValue())) {
                return measurement.path("value").asDouble();
            }
        }
        fail("Metric does not expose a COUNT measurement: " + metricName);
        return 0;
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class DeterministicEmbeddingConfiguration {

        @Bean
        EmbeddingProvider deterministicEmbeddingProvider() {
            return ignored -> new Embedding(
                    "phase-11-deterministic-embedding",
                    "1",
                    new float[]{1.0f, 0.0f, 0.0f});
        }
    }
}
