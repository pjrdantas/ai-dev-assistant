import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const extensionRoot = process.cwd();

test('contribui o Custom Agent e as tools de memória sem restringir ferramentas nativas ou modelo', async () => {
  const manifest = JSON.parse(await readFile(join(extensionRoot, 'package.json'), 'utf8')) as {
    readonly contributes: {
      readonly chatAgents?: readonly { readonly path: string }[];
      readonly languageModelTools?: readonly {
        readonly name: string;
        readonly canBeReferencedInPrompt?: boolean;
        readonly toolReferenceName?: string;
        readonly inputSchema?: { readonly required?: readonly string[] };
      }[];
      readonly views?: unknown;
      readonly viewsContainers?: unknown;
      readonly configuration?: { readonly properties?: Record<string, { readonly default?: string }> };
    };
  };
  const agentPath = manifest.contributes.chatAgents?.[0]?.path;
  assert.equal(agentPath, './agents/ai-dev-assistant.agent.md');
  const tools = manifest.contributes.languageModelTools;
  assert.deepEqual(tools?.map((tool) => tool.name), [
    'ai-dev-assistant_searchMemory', 'ai-dev-assistant_saveMemory',
  ]);
  assert.ok(tools?.every((tool) => /^[\w-]+$/.test(tool.name) && !tool.name.includes('.')));
  assert.deepEqual(tools?.map((tool) => tool.toolReferenceName), ['searchMemory', 'saveMemory']);
  assert.ok(tools?.every((tool) => tool.canBeReferencedInPrompt === true));
  assert.deepEqual(tools?.[1]?.inputSchema?.required, ['originalRequest', 'solution']);
  assert.equal(manifest.contributes.views, undefined);
  assert.equal(manifest.contributes.viewsContainers, undefined);
  assert.equal(manifest.contributes.configuration?.properties?.['aiDevAssistant.mongodb.uri']?.default, 'mongodb://127.0.0.1:27017');
  assert.equal(manifest.contributes.configuration?.properties?.['aiDevAssistant.mongodb.database']?.default, 'ai_dev_assistant');

  const agent = await readFile(join(extensionRoot, agentPath!), 'utf8');
  assert.match(agent, /^---[\s\S]*name: AI Dev Assistant/m);
  assert.doesNotMatch(agent, /^model:/m);
  assert.doesNotMatch(agent, /^tools:/m);
  assert.match(agent, /^hooks:\n  UserPromptSubmit:/m);
  assert.match(agent, /^  Stop:\n    - type: command/m);
  assert.doesNotMatch(agent, /decision:\s*block/);
  assert.match(agent, /windows: 'powershell -NoProfile/);
  assert.match(agent, /linux: 'sh /);
  assert.match(agent, /osx: 'sh /);
  assert.doesNotMatch(agent, /\.copilot\/hooks/);
  assert.match(agent, /#tool:searchMemory/);
  assert.match(agent, /#tool:saveMemory/);
  assert.doesNotMatch(agent, /#tool:aiDevAssistant\./);

  const memoryTools = await readFile(join(extensionRoot, 'src', 'memoryTools.ts'), 'utf8');
  const toolReferenceUtils = await readFile(join(extensionRoot, 'src', 'toolReferenceUtils.ts'), 'utf8');
  assert.match(memoryTools, /SEARCH_MEMORY_TOOL = 'ai-dev-assistant_searchMemory'/);
  assert.match(memoryTools, /SAVE_MEMORY_TOOL = 'ai-dev-assistant_saveMemory'/);
  assert.match(memoryTools, /registerTool\(SEARCH_MEMORY_TOOL,/);
  assert.match(memoryTools, /registerTool\(SAVE_MEMORY_TOOL,/);
  assert.match(memoryTools, /from '\.\/toolReferenceUtils\.js'/);
  assert.match(toolReferenceUtils, /export function stripToolReference/);
  assert.doesNotMatch(toolReferenceUtils, /from 'vscode'|import \* as vscode/);
  assert.match(memoryTools, /readonly originalRequest: string/);
  const saveTool = memoryTools.slice(memoryTools.indexOf('export class SaveMemoryTool'));
  assert.match(saveTool, /options\.input\.originalRequest/);
  assert.doesNotMatch(saveTool, /options\.input\.request/);

  const packageJson = await readFile(join(extensionRoot, 'package.json'), 'utf8');
  assert.doesNotMatch(packageJson, /Groq(?: AI)?/i);

  const embeddingProvider = await readFile(join(extensionRoot, 'src', 'localEmbeddingProvider.ts'), 'utf8');
  assert.match(embeddingProvider, /import type \* as ort from 'onnxruntime-web'/);
  assert.match(embeddingProvider, /await import\('onnxruntime-web'\)/);
  assert.doesNotMatch(embeddingProvider, /import \* as ort from 'onnxruntime-web'/);

  const extension = await readFile(join(extensionRoot, 'src', 'extension.ts'), 'utf8');
  assert.doesNotMatch(extension, /\.generate\(/);
  assert.match(extension, /installAgentScopedHookRunner/);
  assert.match(extension, /removeLegacyGlobalInteractionHook/);
  assert.doesNotMatch(extension, /enableCustomAgentHooksWhenRegistered/);
  assert.doesNotMatch(extension, /chat\.useCustomAgentHooks/);
  assert.match(extension, /uninstallAgentScopedHookRunner/);
  assert.doesNotMatch(extension, /\.copilot', 'hooks'/);

  const hookRunner = await readFile(join(extensionRoot, 'src', 'interactionHookRunner.ts'), 'utf8');
  assert.match(hookRunner, /input\.hook_event_name !== 'UserPromptSubmit'/);
  assert.match(hookRunner, /interactionFromUserPrompt\(input\)/);
  assert.doesNotMatch(hookRunner, /localEmbeddingProvider|onnxruntime-web|vscode\.lm/);
});

test('instrui o agent loop a consultar e salvar memória automaticamente', async () => {
  const agent = await readFile(join(extensionRoot, 'agents', 'ai-dev-assistant.agent.md'), 'utf8');
  assert.match(agent, /MUST chamar `searchMemory`[\s\S]*antes de produzir uma nova solução técnica/);
  assert.match(agent, /MUST chamar `saveMemory` antes de[\s\S]*resposta final/);
  assert.match(agent, /copie literalmente a solicitação original real do usuário/);
  assert.match(agent, /NEVER exija que o usuário escreva `#saveMemory` manualmente/);

  const packageJson = await readFile(join(extensionRoot, 'package.json'), 'utf8');
  assert.match(packageJson, /Use esta tool antes de produzir uma nova solução técnica/);
  assert.match(packageJson, /use esta tool antes da resposta final para salvá-la automaticamente/);
});
