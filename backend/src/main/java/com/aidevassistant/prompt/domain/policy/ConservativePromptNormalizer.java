package com.aidevassistant.prompt.domain.policy;

import com.aidevassistant.prompt.domain.model.NormalizedPrompt;
import com.aidevassistant.prompt.domain.model.Prompt;

import java.util.Objects;

public final class ConservativePromptNormalizer {

    public static final int VERSION = 1;

    public NormalizedPrompt normalize(Prompt prompt) {
        Objects.requireNonNull(prompt, "Prompt must not be null");

        String normalizedValue = prompt.value()
                .replace("\r\n", "\n")
                .replace('\r', '\n')
                .strip();

        return new NormalizedPrompt(normalizedValue, VERSION);
    }
}
