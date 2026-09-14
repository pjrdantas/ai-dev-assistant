import * as vscode from 'vscode';

import { AssistantViewProvider } from './assistantViewProvider.js';
import { CopilotLanguageModelGateway } from './copilotLanguageModelGateway.js';
import { HttpAssistantBackend } from './httpAssistantBackend.js';
import { PromptCoordinator } from './promptCoordinator.js';
import { VscodeProjectContextProvider } from './vscodeProjectContextProvider.js';

export function activate(context: vscode.ExtensionContext): void {
  const backend = new HttpAssistantBackend(() => {
    const configuration = vscode.workspace.getConfiguration('aiDevAssistant');
    return {
      baseUrl: configuration.get<string>('backendUrl', 'http://127.0.0.1:8080'),
      timeoutMs: configuration.get<number>('requestTimeoutMs', 30_000),
    };
  });
  const copilot = new CopilotLanguageModelGateway(() =>
    vscode.workspace
      .getConfiguration('aiDevAssistant')
      .get<string>('copilotModelFamily', ''),
  );
  const provider = new AssistantViewProvider(new PromptCoordinator(
    backend,
    copilot,
    new VscodeProjectContextProvider(),
  ));

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      AssistantViewProvider.viewId,
      provider,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
  );
}
