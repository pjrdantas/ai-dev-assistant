import {
  AssistantBackend,
  CompletedPromptResponse,
  CopilotGateway,
  ProjectContextProvider,
} from './contracts.js';
import { UserFacingError } from './userFacingError.js';

export class PromptCoordinator {
  public constructor(
    private readonly backend: AssistantBackend,
    private readonly copilot: CopilotGateway,
    private readonly projectContext: ProjectContextProvider = EMPTY_PROJECT_CONTEXT,
    private readonly now: () => number = Date.now,
  ) {}

  public async submit(prompt: string): Promise<CompletedPromptResponse> {
    const normalizedInput = prompt.trim();
    if (normalizedInput === '') {
      throw new UserFacingError('Digite uma solicitação antes de enviar.');
    }
    if (normalizedInput.length > 20_000) {
      throw new UserFacingError('A solicitação excede o limite de 20.000 caracteres.');
    }

    const preparation = await this.backend.prepare(
      normalizedInput,
      await this.projectContext.capture(),
    );
    if (preparation.status === 'COMPLETED') {
      return preparation;
    }
    const expiresAt = Date.parse(preparation.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= this.now()) {
      throw new UserFacingError(
        'A autorização para o Copilot expirou. Envie a solicitação novamente.',
      );
    }

    const completion = await this.copilot.complete(preparation.aiRequest);
    return this.backend.complete(preparation.requestId, completion);
  }
}

const EMPTY_PROJECT_CONTEXT: ProjectContextProvider = {
  async capture() {
    return undefined;
  },
};
