package com.aidevassistant.memory.application.port.out;

import com.aidevassistant.memory.domain.model.Embedding;
import com.aidevassistant.prompt.domain.model.NormalizedPrompt;

public interface EmbeddingProvider {

    Embedding generate(NormalizedPrompt prompt);
}
