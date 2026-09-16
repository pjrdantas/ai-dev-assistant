import * as vscode from 'vscode';

import { LocalMemoryService } from './localMemoryService.js';
import { stripToolReference } from './toolReferenceUtils.js';

export { stripToolReference } from './toolReferenceUtils.js';

export const SEARCH_MEMORY_TOOL = 'ai-dev-assistant_searchMemory';
export const SAVE_MEMORY_TOOL = 'ai-dev-assistant_saveMemory';

export interface SearchMemoryInput {
  readonly request: string;
}

export interface SaveMemoryInput {
  readonly originalRequest: string;
  readonly solution: string;
}

export function registerMemoryTools(
  context: vscode.ExtensionContext,
  memory: LocalMemoryService,
  beforeSearch?: () => Promise<void>,
): void {
  context.subscriptions.push(
    vscode.lm.registerTool(SEARCH_MEMORY_TOOL, new SearchMemoryTool(memory, beforeSearch)),
    vscode.lm.registerTool(SAVE_MEMORY_TOOL, new SaveMemoryTool(memory)),
  );
}

export class SearchMemoryTool implements vscode.LanguageModelTool<SearchMemoryInput> {
  public constructor(private readonly memory: LocalMemoryService, private readonly beforeSearch?: () => Promise<void>) {}

  public prepareInvocation(): vscode.PreparedToolInvocation {
    return { invocationMessage: 'Consultando a memória local do AI Dev Assistant' };
  }

  public async invoke(
    options: vscode.LanguageModelToolInvocationOptions<SearchMemoryInput>,
  ): Promise<vscode.LanguageModelToolResult> {
    await this.beforeSearch?.();
    const result = await this.memory.search(stripToolReference(options.input.request, SEARCH_MEMORY_TOOL));
    return jsonResult(result);
  }
}

export class SaveMemoryTool implements vscode.LanguageModelTool<SaveMemoryInput> {
  public constructor(private readonly memory: LocalMemoryService) {}

  public prepareInvocation(): vscode.PreparedToolInvocation {
    return {
      invocationMessage: 'Salvando conhecimento reutilizável na memória local',
      confirmationMessages: {
        title: 'Salvar conhecimento local',
        message: new vscode.MarkdownString('Salvar a solução reutilizável no perfil local do VS Code?'),
      },
    };
  }

  public async invoke(
    options: vscode.LanguageModelToolInvocationOptions<SaveMemoryInput>,
  ): Promise<vscode.LanguageModelToolResult> {
    const result = await this.memory.save(stripToolReference(options.input.originalRequest, SAVE_MEMORY_TOOL), options.input.solution);
    return jsonResult(result);
  }
}

function jsonResult(value: object): vscode.LanguageModelToolResult {
  return new vscode.LanguageModelToolResult([vscode.LanguageModelDataPart.json(value)]);
}
