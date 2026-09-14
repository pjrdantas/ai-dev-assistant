package com.aidevassistant.observability.application.model;

public enum PromptProcessingStage {
    PROMPT_PROCESSING,
    NORMALIZATION,
    EXACT_MEMORY_LOOKUP,
    EMBEDDING,
    SEMANTIC_MEMORY_LOOKUP,
    MEMORY_PERSISTENCE,
    AI_COMPLETION
}
