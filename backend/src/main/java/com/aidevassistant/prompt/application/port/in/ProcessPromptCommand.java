package com.aidevassistant.prompt.application.port.in;

import com.aidevassistant.projectcontext.domain.model.TechnicalContext;
import com.aidevassistant.prompt.domain.model.Prompt;

import java.util.Objects;

public record ProcessPromptCommand(Prompt prompt, TechnicalContext technicalContext) {

    public ProcessPromptCommand {
        Objects.requireNonNull(prompt, "Prompt must not be null");
        Objects.requireNonNull(technicalContext, "Technical context must not be null");
    }
}
