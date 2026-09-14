import assert from 'node:assert/strict';
import test from 'node:test';
import type * as vscode from 'vscode';

import { CopilotLanguageModelGateway } from '../src/copilotLanguageModelGateway.js';
import { AuthorizedAiRequest } from '../src/contracts.js';

type VscodeApi = typeof import('vscode');

const request: AuthorizedAiRequest = {
  prompt: 'Create an endpoint',
  technicalContext: { technologies: ['java'], versions: { java: '21' } },
  requiredAdaptations: [],
};

test('selects only the preferred Copilot model and reports measured execution', async () => {
  const selectors: vscode.LanguageModelChatSelector[] = [];
  const model = fakeModel(['Complete ', 'answer'], 12, 5, 1_000);
  const api = fakeVscode(async (selector) => {
    selectors.push(selector);
    return [model];
  });
  const times = [1_000, 1_080];
  const gateway = new CopilotLanguageModelGateway(
    () => 'gpt-enterprise',
    async () => api,
    () => times.shift() ?? 1_080,
  );

  const completion = await gateway.complete(request);

  assert.deepEqual(selectors, [{ vendor: 'copilot', family: 'gpt-enterprise' }]);
  assert.deepEqual(completion, {
    response: 'Complete answer',
    executionMetrics: { inputTokens: 12, outputTokens: 5, durationMs: 80 },
  });
});

test('falls back only to another model from the Copilot vendor', async () => {
  const selectors: vscode.LanguageModelChatSelector[] = [];
  const model = fakeModel(['Answer'], 4, 2, 100);
  const api = fakeVscode(async (selector) => {
    selectors.push(selector);
    return selectors.length === 1 ? [] : [model];
  });
  const gateway = new CopilotLanguageModelGateway(
    () => 'unavailable-family',
    async () => api,
  );

  await gateway.complete(request);

  assert.deepEqual(selectors, [
    { vendor: 'copilot', family: 'unavailable-family' },
    { vendor: 'copilot' },
  ]);
});

test('fails safely when no authorized Copilot model is available', async () => {
  const gateway = new CopilotLanguageModelGateway(
    () => '',
    async () => fakeVscode(async () => []),
  );

  await assert.rejects(() => gateway.complete(request), /Nenhum modelo Copilot autorizado/);
});

test('blocks requests and responses that exceed the model or backend limits', async () => {
  let modelCalls = 0;
  const inputLimitedModel = fakeModel(['unused'], 100, 0, 100, () => {
    modelCalls += 1;
  });
  const inputGateway = new CopilotLanguageModelGateway(
    () => '',
    async () => fakeVscode(async () => [inputLimitedModel]),
  );

  await assert.rejects(() => inputGateway.complete(request), /excede o limite do modelo/);
  assert.equal(modelCalls, 0);

  const oversizedModel = fakeModel(['x'.repeat(200_001)], 1, 1, 1_000);
  const outputGateway = new CopilotLanguageModelGateway(
    () => '',
    async () => fakeVscode(async () => [oversizedModel]),
  );

  await assert.rejects(() => outputGateway.complete(request), /200\.000 caracteres/);
});

function fakeVscode(
  selectChatModels: (
    selector: vscode.LanguageModelChatSelector,
  ) => Promise<readonly vscode.LanguageModelChat[]>,
): VscodeApi {
  class FakeCancellationTokenSource {
    public readonly token = {} as vscode.CancellationToken;

    public dispose(): void {}
  }

  class FakeLanguageModelError extends Error {}

  return {
    lm: { selectChatModels },
    LanguageModelChatMessage: {
      User: (value: string) => ({ value }) as unknown as vscode.LanguageModelChatMessage,
    },
    CancellationTokenSource: FakeCancellationTokenSource,
    LanguageModelError: FakeLanguageModelError,
  } as unknown as VscodeApi;
}

function fakeModel(
  fragments: readonly string[],
  inputTokens: number,
  outputTokens: number,
  maxInputTokens: number,
  onSend: () => void = () => undefined,
): vscode.LanguageModelChat {
  return {
    maxInputTokens,
    async countTokens(value: string | vscode.LanguageModelChatMessage): Promise<number> {
      return typeof value === 'string' ? outputTokens : inputTokens;
    },
    async sendRequest(): Promise<vscode.LanguageModelChatResponse> {
      onSend();
      return { text: stream(fragments) } as vscode.LanguageModelChatResponse;
    },
  } as unknown as vscode.LanguageModelChat;
}

async function* stream(fragments: readonly string[]): AsyncIterable<string> {
  for (const fragment of fragments) {
    yield fragment;
  }
}
