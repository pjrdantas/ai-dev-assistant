package com.aidevassistant.memory.adapter.out.onnx;

import com.aidevassistant.memory.application.port.out.EmbeddingProvider;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(LocalOnnxEmbeddingProperties.class)
@ConditionalOnProperty(prefix = "embedding.local", name = "enabled", havingValue = "true")
class LocalOnnxEmbeddingConfiguration {

    @Bean(destroyMethod = "close")
    EmbeddingProvider embeddingProvider(LocalOnnxEmbeddingProperties properties) {
        return new OnnxEmbeddingProvider(properties.toModel());
    }
}
