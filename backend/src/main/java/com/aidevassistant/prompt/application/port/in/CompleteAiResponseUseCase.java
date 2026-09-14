package com.aidevassistant.prompt.application.port.in;

import com.aidevassistant.prompt.domain.model.AssistantResponse;

public interface CompleteAiResponseUseCase {

    AssistantResponse complete(CompleteAiResponseCommand command);
}
