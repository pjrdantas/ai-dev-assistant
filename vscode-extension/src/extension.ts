import * as vscode from 'vscode';
import { homedir } from 'node:os';

import { OnnxLocalEmbeddingProvider } from './localEmbeddingProvider.js';
import { LocalMemoryService } from './localMemoryService.js';
import { registerMemoryTools } from './memoryTools.js';
import { migrateJsonMemory } from './jsonMemoryMigration.js';
import { MongoConnectionManager } from './mongoConnectionManager.js';
import { MongoInteractionStore } from './mongoInteractionStore.js';
import { workspaceKey } from './interactionCapture.js';
import { installAgentScopedHookRunner, removeLegacyGlobalInteractionHook, uninstallAgentScopedHookRunner } from './interactionHookInstallation.js';
import { InteractionPromotionService } from './interactionPromotionService.js';
import { MongoMemoryStore } from './mongoMemoryStore.js';
import { VscodeProjectContextProvider } from './vscodeProjectContextProvider.js';

export function activate(context: vscode.ExtensionContext): void {
  const settings = vscode.workspace.getConfiguration('aiDevAssistant.mongodb');
  const connection = new MongoConnectionManager({
    uri: settings.get<string>('uri', 'mongodb://127.0.0.1:27017'),
    database: settings.get<string>('database', 'ai_dev_assistant'),
  });
  const memory = new MongoMemoryStore(connection);
  const interactions = new MongoInteractionStore(connection);
  const embeddings = new OnnxLocalEmbeddingProvider(
    vscode.Uri.joinPath(context.extensionUri, 'models', 'paraphrase-multilingual-minilm').fsPath,
  );
  const output = vscode.window.createOutputChannel('AI Dev Assistant');
  const service = new LocalMemoryService(
    memory,
    embeddings,
    new VscodeProjectContextProvider(),
    (diagnostic) => {
      const compatible = diagnostic.candidates.filter((candidate) => candidate.contextCompatible).length;
      const bestSimilarity = diagnostic.candidates[0]?.similarity;
      output.appendLine(`Mongo memory search: documentsFetched=${diagnostic.candidates.length} activeCandidates=${diagnostic.candidates.length} contextCompatibleCandidates=${compatible} bestSimilarity=${bestSimilarity ?? 'none'} matchType=${diagnostic.matchType} reason=${diagnostic.reason}`);
    },
  );
  const promotions = new InteractionPromotionService(interactions, service);
  registerMemoryTools(context, service, () => promotions.promotePending());
  context.subscriptions.push(
    output,
    vscode.commands.registerCommand('aiDevAssistant.showMemoryStatistics', async () => {
      try {
        const stats = await memory.statistics();
        await vscode.window.showInformationMessage(`Memória MongoDB: ${stats.active} ativa(s), ${stats.invalidated} invalidada(s), schema ${stats.schemaVersion}.`);
      } catch (error) { await vscode.window.showWarningMessage(`Memória MongoDB indisponível: ${message(error)}`); }
    }),
    vscode.commands.registerCommand('aiDevAssistant.clearLocalMemory', async () => {
      const choice = await vscode.window.showWarningMessage('Apagar toda a memória local do AI Dev Assistant?', { modal: true }, 'Apagar');
      if (choice === 'Apagar') {
        try { await memory.clear(); await vscode.window.showInformationMessage('Memórias MongoDB inativadas. O histórico de interações foi preservado.'); }
        catch (error) { await vscode.window.showWarningMessage(`Memória MongoDB indisponível: ${message(error)}`); }
      }
    }),
    vscode.commands.registerCommand('aiDevAssistant.mongodbStatus', async () => {
      const status = await connection.status();
      if (!status.connected) { await vscode.window.showWarningMessage(`MongoDB desconectado: ${status.uri}, database ${status.database}. ${status.reason ?? ''}`); return; }
      const [memoryStats, interactionCount] = await Promise.all([memory.statistics(), interactions.count()]);
      await vscode.window.showInformationMessage(`MongoDB conectado: ${status.uri}, database ${status.database}, ${memoryStats.active} memória(s) ativa(s), ${memoryStats.invalidated} invalidada(s), ${memoryStats.total} total, ${interactionCount} interação(ões).`);
    }),
    vscode.commands.registerCommand('aiDevAssistant.migrateLocalMemoryToMongoDB', async () => {
      const source = vscode.Uri.joinPath(context.globalStorageUri, 'knowledge-v1.json').fsPath;
      try {
        const result = await migrateJsonMemory(source, memory);
        if (result.status === 'NOTHING_TO_MIGRATE') {
          await vscode.window.showInformationMessage('Nenhuma memória JSON legada foi encontrada. Não há dados para migrar.');
          return;
        }
        await vscode.window.showInformationMessage(`Migração concluída: ${result.migrated}/${result.sourceEntries} memória(s). O JSON histórico foi preservado.`);
      }
      catch (error) { await vscode.window.showWarningMessage(`Migração MongoDB não concluída: ${message(error)}`); }
    }),
    vscode.commands.registerCommand('aiDevAssistant.clearInteractionHistory', async () => {
      const choice = await vscode.window.showWarningMessage('Apagar todo o histórico de interações do AI Dev Assistant?', { modal: true }, 'Apagar histórico');
      if (choice === 'Apagar histórico') {
        try { await interactions.clear(); await vscode.window.showInformationMessage('Histórico de interações apagado.'); }
        catch (error) { await vscode.window.showWarningMessage(`Histórico MongoDB indisponível: ${message(error)}`); }
      }
    }),
    vscode.commands.registerCommand('aiDevAssistant.showInteractionStatistics', async () => {
      try {
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const stats = await interactions.statistics(workspaceKey(cwd));
        await vscode.window.showInformationMessage(`Interações: ${stats.total} total, ${stats.pending} pendente(s), ${stats.completed} concluída(s), ${stats.unavailable} falha(s)/indisponível(is). Última: ${stats.last?.createdAt.toISOString() ?? 'nenhuma'}.`);
      } catch (error) { await vscode.window.showWarningMessage(`Interações MongoDB indisponíveis: ${message(error)}`); }
    }),
    vscode.commands.registerCommand('aiDevAssistant.enableAutomaticInteractionCapture', async () => {
  const choice = await vscode.window.showWarningMessage(
    'Automatic Interaction Capture instala o launcher privado de Agent Hooks do AI Dev Assistant.',
    { modal: true },
    'Habilitar',
  );

  if (choice !== 'Habilitar') return;

  try {
    const runner = vscode.Uri.joinPath(
      context.extensionUri,
      'out',
      'src',
      'interactionHookRunner.js',
    ).fsPath;

    await installAgentScopedHookRunner(
      homedir(),
      process.execPath,
      runner,
    );

    await removeLegacyGlobalInteractionHook(homedir());

    await vscode.window.showInformationMessage(
      'Captura automática habilitada para o AI Dev Assistant.',
    );
  } catch (error) {
    await vscode.window.showWarningMessage(
      `Não foi possível habilitar a captura automática: ${message(error)}`,
    );
  }
}),
    vscode.commands.registerCommand('aiDevAssistant.disableAutomaticInteractionCapture', async () => {
      try {
        const [removed, legacyRemoved] = await Promise.all([uninstallAgentScopedHookRunner(homedir()), removeLegacyGlobalInteractionHook(homedir())]);
        await vscode.window.showInformationMessage(removed || legacyRemoved ? 'Captura automática desabilitada. Somente artefatos do AI Dev Assistant foram removidos.' : 'Não foram encontrados artefatos de captura gerenciados pelo AI Dev Assistant.');
      } catch (error) { await vscode.window.showWarningMessage(`Não foi possível desabilitar a captura automática: ${message(error)}`); }
    }),
    new vscode.Disposable(() => { void connection.close(); }),
  );
}

function message(error: unknown): string { return error instanceof Error ? error.message : 'erro desconhecido'; }
