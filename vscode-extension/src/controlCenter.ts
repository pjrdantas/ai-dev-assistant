export interface ControlCenterAction {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly command: string;
  readonly icon: string;
}

/** Static action model used by the native TreeView adapter and unit tests. */
export const CONTROL_CENTER_ACTIONS: readonly ControlCenterAction[] = [
  { id: 'openCopilotChat', label: 'Abrir Copilot Chat', description: 'Abra o Chat nativo e selecione o agente AI Dev Assistant no seletor do Copilot.', command: 'workbench.action.chat.open', icon: 'comment-discussion' },
  { id: 'mongodbStatus', label: 'Verificar status do MongoDB', description: 'Consulta o MongoDB e verifica os índices.', command: 'aiDevAssistant.mongodbStatus', icon: 'database' },
  { id: 'migrateLegacyMongoIndexes', label: 'Migrar índices legados do MongoDB', description: 'Cria backup verificável e migra o índice legado sem alterar memórias.', command: 'aiDevAssistant.migrateLegacyMongoIndexes', icon: 'sync' },
  { id: 'showStoredMemories', label: 'Consultar memórias armazenadas', description: 'Lista as memórias locais armazenadas.', command: 'aiDevAssistant.showStoredMemories', icon: 'library' },
  { id: 'showMemoryStatistics', label: 'Ver estatísticas de memória', description: 'Mostra a quantidade de memórias ativas e invalidadas.', command: 'aiDevAssistant.showMemoryStatistics', icon: 'graph' },
  { id: 'showInteractionStatistics', label: 'Ver estatísticas de captura', description: 'Mostra o estado das interações capturadas no workspace.', command: 'aiDevAssistant.showInteractionStatistics', icon: 'pulse' },
  { id: 'enableAutomaticInteractionCapture', label: 'Habilitar captura automática', description: 'Requer confirmação e instala os launchers gerenciados.', command: 'aiDevAssistant.enableAutomaticInteractionCapture', icon: 'record' },
  { id: 'disableAutomaticInteractionCapture', label: 'Desabilitar captura automática', description: 'Remove somente artefatos gerenciados após ação explícita.', command: 'aiDevAssistant.disableAutomaticInteractionCapture', icon: 'circle-slash' },
];

export class ControlCenterTreeModel {
  public getChildren(): readonly ControlCenterAction[] {
    return CONTROL_CENTER_ACTIONS;
  }
}
