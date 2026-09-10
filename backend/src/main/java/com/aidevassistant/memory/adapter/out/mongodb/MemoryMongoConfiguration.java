package com.aidevassistant.memory.adapter.out.mongodb;

import com.aidevassistant.memory.application.port.out.MemoryRepository;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.mongodb.core.MongoOperations;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(SemanticSearchProperties.class)
class MemoryMongoConfiguration {

    @Bean
    MongoMemoryMapper mongoMemoryMapper() {
        return new MongoMemoryMapper();
    }

    @Bean
    MemoryRepository memoryRepository(
            MongoOperations mongoOperations,
            MongoMemoryMapper mapper,
            SemanticSearchProperties semanticSearchProperties) {
        return new MongoMemoryRepository(mongoOperations, mapper, semanticSearchProperties);
    }

    @Bean
    MongoMemoryIndexInitializer mongoMemoryIndexInitializer(
            MongoOperations mongoOperations,
            SemanticSearchProperties semanticSearchProperties) {
        return new MongoMemoryIndexInitializer(mongoOperations, semanticSearchProperties);
    }
}
