import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AiCompletion,
  AssistantBackend,
  AuthorizedAiRequest,
  CompletedPromptResponse,
  CopilotGateway,
  PendingPromptResponse,
  ProjectContextProvider,
  PromptPreparation,
} from '../src/contracts.js';
import { PromptCoordinator } from '../src/promptCoordinator.js';

const localResponse: CompletedPromptResponse = {
  requestId: '11111111-1111-1111-1111-111111111111',
  status: 'COMPLETED',
  response: 'Local solution',
  source: 'LOCAL_MEMORY',
  matchType: 'FULL',
  similarity: 0.96,
  aiCalled: false,
  externalSearchCalled: false,
  memoryId: '22222222-2222-2222-2222-222222222222',
};

const authorizedRequest: AuthorizedAiRequest = {
  prompt: 'Create an endpoint',
  technicalContext: { technologies: ['java'], versions: { java: '21' } },
  requiredAdaptations: [],
};

const pendingResponse: PendingPromptResponse = {
  requestId: '33333333-3333-3333-3333-333333333333',
  status: 'AI_REQUIRED',
  matchType: 'NONE',
  expiresAt: '2026-09-10T18:05:00Z',
  aiRequest: authorizedRequest,
};

test('returns a FULL response without accessing Copilot', async () => {
  let copilotCalls = 0;
  const backend = backendReturning(localResponse);
  const copilot: CopilotGateway = {
    async complete(): Promise<AiCompletion> {
      copilotCalls += 1;
      throw new Error('must not be called');
    },
  };

  const result = await new PromptCoordinator(backend, copilot).submit('request');

  assert.equal(result, localResponse);
  assert.equal(copilotCalls, 0);
});

test('calls Copilot only between backend preparation and completion', async () => {
  const events: string[] = [];
  const externalResponse: CompletedPromptResponse = {
    ...localResponse,
    response: 'External solution',
    source: 'AI',
    matchType: 'NONE',
    aiCalled: true,
  };
  const completion: AiCompletion = {
    response: externalResponse.response,
    executionMetrics: { inputTokens: 50, outputTokens: 20, durationMs: 800 },
  };
  const backend: AssistantBackend = {
    async prepare(_prompt, projectContext): Promise<PromptPreparation> {
      events.push('prepare');
      assert.deepEqual(projectContext, {
        languages: [{ name: 'JAVA', version: '21' }],
        frameworks: [],
        buildTool: 'MAVEN',
      });
      return pendingResponse;
    },
    async complete(requestId, submitted): Promise<CompletedPromptResponse> {
      events.push('complete');
      assert.equal(requestId, pendingResponse.requestId);
      assert.deepEqual(submitted, completion);
      return externalResponse;
    },
  };
  const copilot: CopilotGateway = {
    async complete(request): Promise<AiCompletion> {
      events.push('copilot');
      assert.equal(request, authorizedRequest);
      return completion;
    },
  };
  const projectContext: ProjectContextProvider = {
    async capture() {
      events.push('context');
      return {
        languages: [{ name: 'JAVA', version: '21' }],
        frameworks: [],
        buildTool: 'MAVEN',
      };
    },
  };

  const result = await new PromptCoordinator(
    backend,
    copilot,
    projectContext,
    () => Date.parse('2026-09-10T18:00:00Z'),
  ).submit('request');

  assert.deepEqual(events, ['context', 'prepare', 'copilot', 'complete']);
  assert.equal(result, externalResponse);
});

test('does not access Copilot when backend preparation fails', async () => {
  let copilotCalls = 0;
  const backend: AssistantBackend = {
    async prepare(): Promise<PromptPreparation> {
      throw new Error('memory unavailable');
    },
    async complete(): Promise<CompletedPromptResponse> {
      throw new Error('must not be called');
    },
  };
  const copilot: CopilotGateway = {
    async complete(): Promise<AiCompletion> {
      copilotCalls += 1;
      throw new Error('must not be called');
    },
  };

  await assert.rejects(() => new PromptCoordinator(backend, copilot).submit('request'));
  assert.equal(copilotCalls, 0);
});

test('does not access Copilot with an expired authorization', async () => {
  let copilotCalls = 0;
  const copilot: CopilotGateway = {
    async complete(): Promise<AiCompletion> {
      copilotCalls += 1;
      throw new Error('must not be called');
    },
  };

  await assert.rejects(
    () => new PromptCoordinator(
      backendReturning(pendingResponse),
      copilot,
      emptyProjectContext(),
      () => Date.parse('2026-09-10T18:06:00Z'),
    ).submit('request'),
    /expirou/,
  );
  assert.equal(copilotCalls, 0);
});

function backendReturning(preparation: PromptPreparation): AssistantBackend {
  return {
    async prepare(): Promise<PromptPreparation> {
      return preparation;
    },
    async complete(): Promise<CompletedPromptResponse> {
      throw new Error('must not be called');
    },
  };
}

function emptyProjectContext(): ProjectContextProvider {
  return {
    async capture() {
      return undefined;
    },
  };
}
