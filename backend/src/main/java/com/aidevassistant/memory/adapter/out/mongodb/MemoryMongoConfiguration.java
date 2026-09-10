package com.aidevassistant.memory.adapter.out.mongodb;

import com.aidevassistant.memory.application.port.out.MemoryRepository;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.mongodb.core.MongoOperations;

@Configuration(proxyBeanMethods = false)
class MemoryMongoConfiguration {

    @Bean
    MongoMemoryMapper mongoMemoryMapper() {
        return new MongoMemoryMapper();
    }

    @Bean
    MemoryRepository memoryRepository(MongoOperations mongoOperations, MongoMemoryMapper mapper) {
        return new MongoMemoryRepository(mongoOperations, mapper);
    }

    @Bean
    MongoMemoryIndexInitializer mongoMemoryIndexInitializer(MongoOperations mongoOperations) {
        return new MongoMemoryIndexInitializer(mongoOperations);
    }
}
