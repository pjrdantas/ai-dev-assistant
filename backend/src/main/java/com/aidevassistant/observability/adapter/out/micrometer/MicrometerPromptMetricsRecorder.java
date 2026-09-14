package com.aidevassistant.observability.adapter.out.micrometer;

import com.aidevassistant.memory.domain.model.MatchType;
import com.aidevassistant.observability.application.model.AiExecutionMetrics;
import com.aidevassistant.observability.application.model.MemoryLookupSource;
import com.aidevassistant.observability.application.model.PromptProcessingStage;
import com.aidevassistant.observability.application.port.out.PromptMetricsRecorder;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.DistributionSummary;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.Locale;
import java.util.Objects;
import java.util.Optional;

@Component
public final class MicrometerPromptMetricsRecorder implements PromptMetricsRecorder {

    private static final String PREFIX = "ai.dev.assistant.";

    private final MeterRegistry registry;

    public MicrometerPromptMetricsRecorder(MeterRegistry registry) {
        this.registry = Objects.requireNonNull(registry, "Meter registry must not be null");
    }

    @Override
    public void recordPrompt() {
        registry.counter(PREFIX + "prompts").increment();
    }

    @Override
    public void recordMemoryMatch(
            MemoryLookupSource source,
            MatchType matchType,
            double similarity) {
        String lookup = tag(source);
        String match = tag(matchType);
        registry.counter(
                        PREFIX + "memory.matches",
                        "lookup", lookup,
                        "match", match)
                .increment();
        DistributionSummary.builder(PREFIX + "memory.similarity")
                .description("Similarity of the memory match selected by the orchestrator")
                .baseUnit("ratio")
                .tags("lookup", lookup, "match", match)
                .register(registry)
                .record(similarity);
    }

    @Override
    public void recordLocalResponse(long estimatedTokensSaved) {
        registry.counter(PREFIX + "responses", "source", "local").increment();
        registry.counter(PREFIX + "ai.calls.avoided").increment();
        DistributionSummary.builder(PREFIX + "tokens.saved.estimated")
                .description("Estimated input and output tokens saved by local reuse")
                .baseUnit("tokens")
                .tag("method", "characters_div_4")
                .register(registry)
                .record(estimatedTokensSaved);
    }

    @Override
    public void recordAiInvocationAuthorized(MatchType matchType) {
        registry.counter(
                        PREFIX + "ai.invocations",
                        "state", "authorized",
                        "match", tag(matchType))
                .increment();
    }

    @Override
    public void recordAiCall(
            MatchType matchType,
            Optional<AiExecutionMetrics> executionMetrics) {
        registry.counter(PREFIX + "ai.calls", "match", tag(matchType)).increment();
        executionMetrics.ifPresent(this::recordExecutionMetrics);
    }

    @Override
    public void recordAiInvocationCompleted(MatchType matchType) {
        registry.counter(PREFIX + "responses", "source", "external").increment();
        registry.counter(
                        PREFIX + "ai.invocations",
                        "state", "completed",
                        "match", tag(matchType))
                .increment();
    }

    @Override
    public void recordStageDuration(PromptProcessingStage stage, Duration duration) {
        Timer.builder(PREFIX + "stage.duration")
                .description("Duration of a bounded prompt orchestration stage")
                .tag("stage", tag(stage))
                .register(registry)
                .record(duration);
    }

    private void recordExecutionMetrics(AiExecutionMetrics metrics) {
        Counter.builder(PREFIX + "ai.tokens")
                .description("Tokens counted with the selected model tokenizer")
                .baseUnit("tokens")
                .tags("direction", "input", "measurement", "model_counted")
                .register(registry)
                .increment(metrics.inputTokens());
        Counter.builder(PREFIX + "ai.tokens")
                .description("Tokens counted with the selected model tokenizer")
                .baseUnit("tokens")
                .tags("direction", "output", "measurement", "model_counted")
                .register(registry)
                .increment(metrics.outputTokens());
        Timer.builder(PREFIX + "ai.duration")
                .description("AI execution duration measured by the VS Code extension")
                .tag("measurement", "extension_reported")
                .register(registry)
                .record(metrics.duration());
    }

    private static String tag(Enum<?> value) {
        return value.name().toLowerCase(Locale.ROOT);
    }
}
