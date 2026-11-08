import * as vscode from 'vscode';

import { LocalMemoryService } from './localMemoryService.js';
import { MANUAL_SAVE_CONFIRMATION_MESSAGE } from './memoryConfirmation.js';
import { runBeforeSearch, SearchPromotionDiagnostic } from './searchPreparation.js';
import { stripToolReference } from './toolReferenceUtils.js';

export { stripToolReference } from './toolReferenceUtils.js';

export const SEARCH_MEMORY_TOOL = 'ai-dev-assistant_searchMemory';
export const SAVE_MEMORY_TOOL = 'ai-dev-assistant_saveMemory';
export { MANUAL_SAVE_CONFIRMATION_MESSAGE } from './memoryConfirmation.js';

export interface SearchMemoryInput {
  readonly request: string;
}

export interface SaveMemoryInput {
  readonly originalRequest: string;
  readonly solution: string;
}

export type { SearchPromotionDiagnostic } from './searchPreparation.js';

export function registerMemoryTools(
  context: vscode.ExtensionContext,
  memory: LocalMemoryService,
  beforeSearch?: () => Promise<void>,
  onBeforeSearchFailure?: (diagnostic: SearchPromotionDiagnostic) => void,
): void {
  context.subscriptions.push(
    vscode.lm.registerTool(SEARCH_MEMORY_TOOL, new SearchMemoryTool(memory, beforeSearch, onBeforeSearchFailure)),
    vscode.lm.registerTool(SAVE_MEMORY_TOOL, new SaveMemoryTool(memory)),
  );
}

export class SearchMemoryTool implements vscode.LanguageModelTool<SearchMemoryInput> {
  public constructor(
    private readonly memory: LocalMemoryService,
    private readonly beforeSearch?: () => Promise<void>,
    private readonly onBeforeSearchFailure?: (diagnostic: SearchPromotionDiagnostic) => void,
  ) {}

  public prepareInvocation(): vscode.PreparedToolInvocation {
    return { invocationMessage: 'Consultando a memória local do AI Dev Assistant' };
  }

  public async invoke(
    options: vscode.LanguageModelToolInvocationOptions<SearchMemoryInput>,
  ): Promise<vscode.LanguageModelToolResult> {
    await runBeforeSearch(this.beforeSearch, this.onBeforeSearchFailure);
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
        message: new vscode.MarkdownString(MANUAL_SAVE_CONFIRMATION_MESSAGE),
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
