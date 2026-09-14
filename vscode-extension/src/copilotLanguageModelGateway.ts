import type * as vscode from 'vscode';

import { AiCompletion, AuthorizedAiRequest, CopilotGateway } from './contracts.js';
import { buildAuthorizedPrompt } from './authorizedPrompt.js';
import { UserFacingError } from './userFacingError.js';

type VscodeApi = typeof import('vscode');
type VscodeLoader = () => Promise<VscodeApi>;

const MAX_EXTERNAL_RESPONSE_CHARACTERS = 200_000;

export class CopilotLanguageModelGateway implements CopilotGateway {
  public constructor(
    private readonly preferredFamily: () => string,
    private readonly vscodeLoader: VscodeLoader = () => import('vscode'),
    private readonly now: () => number = Date.now,
  ) {}

  public async complete(request: AuthorizedAiRequest): Promise<AiCompletion> {
    const vscodeApi = await this.vscodeLoader();
    const model = await this.selectModel(vscodeApi);
    const message = vscodeApi.LanguageModelChatMessage.User(buildAuthorizedPrompt(request));
    const cancellation = new vscodeApi.CancellationTokenSource();
    try {
      const inputTokens = await model.countTokens(message, cancellation.token);
      if (inputTokens >= model.maxInputTokens) {
        throw new UserFacingError(
          'O contexto autorizado excede o limite do modelo Copilot disponível.',
        );
      }

      const startedAt = this.now();
      const modelResponse = await model.sendRequest([message], {}, cancellation.token);
      let response = '';
      for await (const fragment of modelResponse.text) {
        if (response.length + fragment.length > MAX_EXTERNAL_RESPONSE_CHARACTERS) {
          throw new UserFacingError(
            'A resposta do Copilot excedeu o limite de 200.000 caracteres.',
          );
        }
        response += fragment;
      }
      if (response.trim() === '') {
        throw new UserFacingError('O Copilot não retornou conteúdo para a solicitação.');
      }
      const outputTokens = await model.countTokens(response, cancellation.token);
      return {
        response,
        executionMetrics: {
          inputTokens,
          outputTokens,
          durationMs: Math.max(0, this.now() - startedAt),
        },
      };
    } catch (error) {
      if (error instanceof UserFacingError) {
        throw error;
      }
      if (error instanceof vscodeApi.LanguageModelError) {
        throw new UserFacingError(
          'O Copilot não está disponível. Verifique consentimento, licença, quota e políticas da organização.',
        );
      }
      throw new UserFacingError('Não foi possível concluir a solicitação com o Copilot.');
    } finally {
      cancellation.dispose();
    }
  }

  private async selectModel(vscodeApi: VscodeApi): Promise<vscode.LanguageModelChat> {
    const preferredFamily = this.preferredFamily().trim();
    if (preferredFamily !== '') {
      const preferred = await this.select(vscodeApi, {
        vendor: 'copilot',
        family: preferredFamily,
      });
      if (preferred !== undefined) {
        return preferred;
      }
    }
    const available = await this.select(vscodeApi, { vendor: 'copilot' });
    if (available === undefined) {
      throw new UserFacingError(
        'Nenhum modelo Copilot autorizado está disponível neste VS Code.',
      );
    }
    return available;
  }

  private async select(
    vscodeApi: VscodeApi,
    selector: vscode.LanguageModelChatSelector,
  ): Promise<vscode.LanguageModelChat | undefined> {
    try {
      const models = await vscodeApi.lm.selectChatModels(selector);
      return models[0];
    } catch {
      throw new UserFacingError(
        'Não foi possível obter consentimento ou acessar os modelos Copilot permitidos.',
      );
    }
  }
}
