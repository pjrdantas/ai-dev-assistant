package com.aidevassistant.memory.adapter.out.embedded;

import com.aidevassistant.memory.application.port.out.MemoryRepository;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(EmbeddedMemoryProperties.class)
class EmbeddedMemoryConfiguration {

    @Bean(destroyMethod = "close")
    MemoryRepository memoryRepository(EmbeddedMemoryProperties properties) {
        return new LuceneMemoryRepository(
                properties.validatedDirectory(),
                properties.validatedDimension(),
                properties.validatedTopK());
    }
}
