package com.aidevassistant.memory.application.port.out;

import com.aidevassistant.memory.domain.model.KnowledgeEntry;
import com.aidevassistant.prompt.domain.model.PromptHash;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface MemoryRepository {

    List<KnowledgeEntry> findActiveByPromptHash(PromptHash promptHash);

    KnowledgeEntry save(KnowledgeEntry knowledgeEntry);

    Optional<KnowledgeEntry> registerReuse(UUID knowledgeId, Instant usedAt);
}
