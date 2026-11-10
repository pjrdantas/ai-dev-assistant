import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { normalizeAud13RuntimeMongoConfiguration, resolveAud13WorkspaceMongoConfiguration } from '../src/mongoHookConfiguration.js';

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
      readonly views?: Record<string, readonly { readonly id: string; readonly name: string }[]>;
      readonly viewsContainers?: { readonly activitybar?: readonly { readonly id: string; readonly title: string; readonly icon: string }[] };
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
  assert.deepEqual(manifest.contributes.viewsContainers?.activitybar, [
    { id: 'aiDevAssistant', title: 'AI Dev Assistant', icon: './media/assistant.svg' },
  ]);
  assert.deepEqual(manifest.contributes.views?.aiDevAssistant, [
    { id: 'aiDevAssistant.view', name: 'Controle' },
  ]);
  assert.equal(manifest.contributes.configuration?.properties?.['aiDevAssistant.mongodb.uri']?.default, 'mongodb://127.0.0.1:27019');
  assert.equal(manifest.contributes.configuration?.properties?.['aiDevAssistant.mongodb.database']?.default, '');

  const agent = (await readFile(join(extensionRoot, agentPath!), 'utf8')).replace(/\r\n/g, '\n');
  assert.match(agent, /^---[\s\S]*name: AI Dev Assistant/m);
  assert.doesNotMatch(agent, /^model:/m);
  assert.doesNotMatch(agent, /^tools:/m);
  assert.doesNotMatch(agent, /^hooks:/m);
  assert.doesNotMatch(agent, /\.copilot[\\/]ai-dev-assistant/);
  assert.doesNotMatch(agent, /decision:\s*block/);
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

  const extension = (await readFile(join(extensionRoot, 'src', 'extension.ts'), 'utf8')).replace(/\r\n/g, '\n');
  assert.match(extension, /registerTreeDataProvider\('aiDevAssistant\.view'/);
  const controlCenter = (await readFile(join(extensionRoot, 'src', 'controlCenter.ts'), 'utf8')).replace(/\r\n/g, '\n');
  assert.match(controlCenter, /workbench\.action\.chat\.open/);
  assert.doesNotMatch(extension, /\.generate\(/);
  assert.match(extension, /const selectedWorkspaceKey = projectContext\.currentSearchWorkspaceKey\(\)/);
  assert.match(extension, /interactions\.statistics\(selectedWorkspaceKey, projectContext\.currentWorkspaceOrigins\(\)\)/);
  assert.doesNotMatch(extension, /workspaceFolders\?\.\[0\]/);
  assert.match(extension, /installAgentScopedHookRunner/);
  assert.match(extension, /removeLegacyGlobalInteractionHook/);
  assert.doesNotMatch(extension, /enableCustomAgentHooksWhenRegistered/);
  assert.doesNotMatch(extension, /chat\.useCustomAgentHooks/);
  assert.match(extension, /uninstallAgentScopedHookRunner/);
  assert.doesNotMatch(extension, /\.copilot', 'hooks'/);
  assert.match(extension, /resolveAud13WorkspaceMongoConfiguration/);
  assert.doesNotMatch(extension, /configurationCoordinator\.reconcile\(/);
  assert.doesNotMatch(extension, /onDidChangeConfiguration/);
  assert.match(packageJson, /"version": "0\.1\.13-aud13-fix"/);

  const hookRunner = await readFile(join(extensionRoot, 'src', 'interactionHookRunner.ts'), 'utf8');
  assert.match(hookRunner, /input\.hook_event_name !== 'UserPromptSubmit'/);
  assert.match(hookRunner, /interactionFromUserPrompt\(input\)/);
  assert.doesNotMatch(hookRunner, /localEmbeddingProvider|onnxruntime-web|vscode\.lm/);
});

test('instrui o agent loop a consultar e salvar memória automaticamente', async () => {
  const agent = (await readFile(join(extensionRoot, 'agents', 'ai-dev-assistant.agent.md'), 'utf8')).replace(/\r\n/g, '\n');
  assert.match(agent, /MUST chamar `searchMemory`[\s\S]*antes de produzir uma nova solução técnica/);
  assert.match(agent, /MUST chamar `saveMemory` antes de[\s\S]*resposta final/);
  assert.match(agent, /copie literalmente a solicitação original real do usuário/);
  assert.match(agent, /NEVER exija que o usuário escreva `#saveMemory` manualmente/);

  const packageJson = await readFile(join(extensionRoot, 'package.json'), 'utf8');
  assert.match(packageJson, /Use esta tool antes de produzir uma nova solução técnica/);
  assert.match(packageJson, /use esta tool antes da resposta final para salvá-la automaticamente/);
});

test('AUD-13 roteia o runtime para 27019 e bloqueia 27017/27018', () => {
  assert.deepEqual(
    normalizeAud13RuntimeMongoConfiguration({ uri: 'mongodb://127.0.0.1:27019', database: 'ai_dev_assistant' }),
    { uri: 'mongodb://127.0.0.1:27019', database: 'ai_dev_assistant' },
  );
  for (const port of [27017, 27018]) {
    assert.throws(
      () => normalizeAud13RuntimeMongoConfiguration({ uri: `mongodb://127.0.0.1:${port}`, database: 'ai_dev_assistant' }),
      /27019|27017 e 27018/,
    );
  }
});

test('AUD-13 roteia somente os dois workspaces autorizados e nunca usa o fallback', () => {
  assert.deepEqual(
    resolveAud13WorkspaceMongoConfiguration(['C:/Projeto/audit/workspace-A-partial-cycle-20261109']),
    { uri: 'mongodb://127.0.0.1:27019', database: 'ai_dev_assistant_aud13_20261109_control' },
  );
  assert.deepEqual(
    resolveAud13WorkspaceMongoConfiguration(['C:/Projeto/audit/workspace-B-partial-cycle-20261109']),
    { uri: 'mongodb://127.0.0.1:27019', database: 'ai_dev_assistant_aud13_20261109_partial' },
  );
  assert.throws(
    () => resolveAud13WorkspaceMongoConfiguration(['C:/Projeto/audit/other-workspace']),
    /não autorizado/,
  );
  assert.throws(
    () => resolveAud13WorkspaceMongoConfiguration([]),
    /não autorizado/,
  );
});
