package com.aidevassistant.observability.application.port.out;

import com.aidevassistant.memory.domain.model.MatchType;
import com.aidevassistant.observability.application.model.AiExecutionMetrics;
import com.aidevassistant.observability.application.model.MemoryLookupSource;
import com.aidevassistant.observability.application.model.PromptProcessingStage;

import java.time.Duration;
import java.util.Optional;

public interface PromptMetricsRecorder {

    void recordPrompt();

    void recordMemoryMatch(MemoryLookupSource source, MatchType matchType, double similarity);

    void recordLocalResponse(long estimatedTokensSaved);

    void recordAiInvocationAuthorized(MatchType matchType);

    void recordAiCall(
            MatchType matchType,
            Optional<AiExecutionMetrics> executionMetrics);

    void recordAiInvocationCompleted(MatchType matchType);

    void recordStageDuration(PromptProcessingStage stage, Duration duration);
}
