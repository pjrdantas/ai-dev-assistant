package com.aidevassistant.prompt.application.port.in;

import com.aidevassistant.prompt.application.model.PromptProcessingResult;

public interface ProcessPromptUseCase {

    PromptProcessingResult process(ProcessPromptCommand command);
}
