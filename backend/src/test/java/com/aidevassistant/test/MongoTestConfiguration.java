package com.aidevassistant.test;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.testcontainers.mongodb.MongoDBAtlasLocalContainer;

@TestConfiguration(proxyBeanMethods = false)
public class MongoTestConfiguration {

    private static final String IMAGE =
            "mongodb/mongodb-atlas-local:8.3.8-20260904T092811Z";

    @Bean
    @ServiceConnection
    MongoDBAtlasLocalContainer mongoDbContainer() {
        return new MongoDBAtlasLocalContainer(IMAGE);
    }
}
