package com.aidevassistant.memory.application.port.out;

import com.aidevassistant.memory.domain.model.KnowledgeEntry;
import com.aidevassistant.prompt.domain.model.PromptHash;

import java.util.Optional;

public interface MemoryRepository {

    Optional<KnowledgeEntry> findActiveByPromptHash(PromptHash promptHash);

    KnowledgeEntry save(KnowledgeEntry knowledgeEntry);
}
