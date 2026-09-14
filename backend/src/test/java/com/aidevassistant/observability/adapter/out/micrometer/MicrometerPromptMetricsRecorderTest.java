package com.aidevassistant.observability.adapter.out.micrometer;

import com.aidevassistant.memory.domain.model.MatchType;
import com.aidevassistant.observability.application.model.AiExecutionMetrics;
import com.aidevassistant.observability.application.model.MemoryLookupSource;
import com.aidevassistant.observability.application.model.PromptProcessingStage;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class MicrometerPromptMetricsRecorderTest {

    @Test
    void recordsOnlyBoundedOperationalDimensions() {
        SimpleMeterRegistry registry = new SimpleMeterRegistry();
        MicrometerPromptMetricsRecorder recorder =
                new MicrometerPromptMetricsRecorder(registry);

            recorder.recordPrompt();
            recorder.recordMemoryMatch(MemoryLookupSource.SEMANTIC, MatchType.PARTIAL, 0.84);
            recorder.recordLocalResponse(75);
            recorder.recordAiInvocationAuthorized(MatchType.NONE);
            recorder.recordAiCall(
                    MatchType.NONE,
                    Optional.of(new AiExecutionMetrics(120, 45, Duration.ofMillis(900))));
            recorder.recordAiInvocationCompleted(MatchType.NONE);
            recorder.recordStageDuration(
                    PromptProcessingStage.EMBEDDING, Duration.ofMillis(20));

            assertEquals(1.0, registry.get("ai.dev.assistant.prompts").counter().count());
            assertEquals(
                    1.0,
                    registry.get("ai.dev.assistant.memory.matches")
                            .tags("lookup", "semantic", "match", "partial")
                            .counter()
                            .count());
            assertEquals(
                    0.84,
                    registry.get("ai.dev.assistant.memory.similarity")
                            .tags("lookup", "semantic", "match", "partial")
                            .summary()
                            .totalAmount());
            assertEquals(
                    1.0,
                    registry.get("ai.dev.assistant.ai.calls.avoided").counter().count());
            assertEquals(
                    75.0,
                    registry.get("ai.dev.assistant.tokens.saved.estimated")
                            .tag("method", "characters_div_4")
                            .summary()
                            .totalAmount());
            assertEquals(
                    120.0,
                    registry.get("ai.dev.assistant.ai.tokens")
                            .tags("direction", "input", "measurement", "model_counted")
                            .counter()
                            .count());
            assertEquals(
                    45.0,
                    registry.get("ai.dev.assistant.ai.tokens")
                            .tags("direction", "output", "measurement", "model_counted")
                            .counter()
                            .count());
            assertEquals(
                    1,
                    registry.get("ai.dev.assistant.ai.duration")
                            .tag("measurement", "extension_reported")
                            .timer()
                            .count());
        assertEquals(
                1,
                registry.get("ai.dev.assistant.stage.duration")
                        .tag("stage", "embedding")
                        .timer()
                        .count());
    }

    @Test
    void rejectsInvalidAiMeasurements() {
        assertThrows(
                IllegalArgumentException.class,
                () -> new AiExecutionMetrics(-1, 0, Duration.ZERO));
        assertThrows(
                IllegalArgumentException.class,
                () -> new AiExecutionMetrics(0, 0, Duration.ofMillis(-1)));
    }
}
