package com.aidevassistant.configuration;

import com.aidevassistant.memory.domain.policy.KnowledgeCompatibilityPolicy;
import com.aidevassistant.memory.domain.policy.MemoryMatchClassifier;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(MemoryClassificationProperties.class)
class MemoryClassificationConfiguration {

    @Bean
    KnowledgeCompatibilityPolicy knowledgeCompatibilityPolicy() {
        return new KnowledgeCompatibilityPolicy();
    }

    @Bean
    MemoryMatchClassifier memoryMatchClassifier(
            MemoryClassificationProperties properties,
            KnowledgeCompatibilityPolicy compatibilityPolicy) {
        return new MemoryMatchClassifier(
                properties.validatedThresholds(),
                properties.validatedMaximumFullAge(),
                compatibilityPolicy);
    }
}
