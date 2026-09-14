import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAuthorizedPrompt } from '../src/authorizedPrompt.js';

test('uses only the context authorized by the backend', () => {
  const prompt = buildAuthorizedPrompt({
    prompt: 'Create an endpoint',
    technicalContext: {
      technologies: ['java', 'spring-boot'],
      versions: { java: '21' },
      taskType: 'code',
    },
    reusableSolution: 'Existing controller pattern',
    requiredAdaptations: ['Update the framework version'],
  });

  assert.match(prompt, /Create an endpoint/);
  assert.match(prompt, /Existing controller pattern/);
  assert.match(prompt, /Update the framework version/);
  assert.match(prompt, /spring-boot/);
  assert.doesNotMatch(prompt, /workspace|arquivo inteiro|caminho absoluto/i);
});
