import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';

import { PromptCoordinator } from './promptCoordinator.js';
import { UserFacingError } from './userFacingError.js';

interface SubmitMessage {
  readonly type: 'submit';
  readonly prompt: string;
}

export class AssistantViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'aiDevAssistant.view';

  private busy = false;

  public constructor(private readonly coordinator: PromptCoordinator) {}

  public resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [],
    };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage(async (message: unknown) => {
      if (this.busy || !isSubmitMessage(message)) {
        return;
      }
      this.busy = true;
      await view.webview.postMessage({ type: 'busy', value: true });
      try {
        const result = await this.coordinator.submit(message.prompt);
        await view.webview.postMessage({
          type: 'result',
          response: result.response,
          source: result.source,
          matchType: result.matchType,
          similarity: result.similarity,
          aiCalled: result.aiCalled,
        });
      } catch (error) {
        const userMessage = error instanceof UserFacingError
          ? error.message
          : 'A solicitação não pôde ser concluída com segurança.';
        await view.webview.postMessage({ type: 'error', message: userMessage });
      } finally {
        this.busy = false;
        await view.webview.postMessage({ type: 'busy', value: false });
      }
    });
  }

  private html(webview: vscode.Webview): string {
    const nonce = randomBytes(16).toString('base64');
    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <title>AI Dev Assistant</title>
  <style nonce="${nonce}">
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 14px;
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    h1 { margin: 0 0 6px; font-size: 1.15rem; }
    .hint { margin: 0 0 12px; color: var(--vscode-descriptionForeground); }
    label { display: block; margin-bottom: 6px; font-weight: 600; }
    textarea {
      width: 100%;
      min-height: 120px;
      resize: vertical;
      padding: 8px;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, transparent);
      font: inherit;
    }
    textarea:focus { outline: 1px solid var(--vscode-focusBorder); }
    button {
      width: 100%;
      margin-top: 8px;
      padding: 8px 12px;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      border: 0;
      cursor: pointer;
      font: inherit;
      font-weight: 600;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button:disabled { opacity: .65; cursor: wait; }
    .status { min-height: 20px; margin: 10px 0; color: var(--vscode-descriptionForeground); }
    .error { color: var(--vscode-errorForeground); }
    .result { display: none; border-top: 1px solid var(--vscode-panel-border); padding-top: 12px; }
    .meta { margin-bottom: 8px; color: var(--vscode-descriptionForeground); }
    pre {
      margin: 0;
      padding: 10px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      color: var(--vscode-editor-foreground);
      background: var(--vscode-textCodeBlock-background);
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
    }
  </style>
</head>
<body>
  <h1>AI Dev Assistant</h1>
  <p class="hint">A memória local será consultada antes de qualquer chamada ao Copilot.</p>
  <form id="prompt-form">
    <label for="prompt">Solicitação</label>
    <textarea id="prompt" maxlength="20000" required aria-describedby="status"></textarea>
    <button id="submit" type="submit">Consultar</button>
  </form>
  <div id="status" class="status" role="status" aria-live="polite"></div>
  <section id="result" class="result" aria-label="Resposta">
    <div id="meta" class="meta"></div>
    <pre id="response"></pre>
  </section>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const form = document.getElementById('prompt-form');
    const prompt = document.getElementById('prompt');
    const submit = document.getElementById('submit');
    const status = document.getElementById('status');
    const result = document.getElementById('result');
    const meta = document.getElementById('meta');
    const response = document.getElementById('response');

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const value = prompt.value.trim();
      if (value.length === 0) {
        status.textContent = 'Digite uma solicitação antes de enviar.';
        status.className = 'status error';
        return;
      }
      result.style.display = 'none';
      status.textContent = 'Consultando a memória local...';
      status.className = 'status';
      vscode.postMessage({ type: 'submit', prompt: value });
    });

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message.type === 'busy') {
        submit.disabled = message.value;
        prompt.disabled = message.value;
        if (!message.value && status.textContent === 'Consultando a memória local...') {
          status.textContent = '';
        }
        return;
      }
      if (message.type === 'error') {
        status.textContent = message.message;
        status.className = 'status error';
        result.style.display = 'none';
        return;
      }
      if (message.type === 'result') {
        const similarity = typeof message.similarity === 'number'
          ? ' · similaridade ' + message.similarity.toFixed(2)
          : '';
        meta.textContent = 'Fonte: ' + message.source
          + ' · classificação ' + message.matchType
          + similarity
          + ' · IA ' + (message.aiCalled ? 'utilizada' : 'não utilizada');
        response.textContent = message.response;
        result.style.display = 'block';
        status.textContent = 'Solicitação concluída.';
        status.className = 'status';
      }
    });
  </script>
</body>
</html>`;
  }
}

function isSubmitMessage(value: unknown): value is SubmitMessage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return candidate.type === 'submit'
    && typeof candidate.prompt === 'string'
    && candidate.prompt.length <= 20_000;
}
