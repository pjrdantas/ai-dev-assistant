package com.aidevassistant.configuration;

import com.aidevassistant.memory.application.port.out.EmbeddingProvider;
import com.aidevassistant.memory.application.port.out.MemoryRepository;
import com.aidevassistant.memory.domain.policy.MemoryMatchClassifier;
import com.aidevassistant.observability.application.port.out.PromptMetricsRecorder;
import com.aidevassistant.prompt.application.exception.MemoryUnavailableException;
import com.aidevassistant.prompt.application.service.PromptOrchestrator;
import com.aidevassistant.prompt.domain.policy.ConservativePromptNormalizer;
import com.aidevassistant.prompt.domain.policy.Sha256PromptHasher;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Clock;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(PromptOrchestrationProperties.class)
class PromptOrchestrationConfiguration {

    @Bean
    PromptOrchestrator promptOrchestrator(
            MemoryRepository memoryRepository,
            ObjectProvider<EmbeddingProvider> embeddingProvider,
            MemoryMatchClassifier matchClassifier,
            PromptMetricsRecorder metricsRecorder,
            PromptOrchestrationProperties properties) {
        EmbeddingProvider requiredLocalEmbedding = embeddingProvider.getIfAvailable(
                () -> prompt -> {
                    throw new MemoryUnavailableException(
                            "The local embedding model is not enabled");
                });
        return new PromptOrchestrator(
                new ConservativePromptNormalizer(),
                new Sha256PromptHasher(),
                memoryRepository,
                requiredLocalEmbedding,
                matchClassifier,
                metricsRecorder,
                Clock.systemUTC(),
                properties.invocationLifetime(),
                properties.maxExternalInputCharacters());
    }
}
