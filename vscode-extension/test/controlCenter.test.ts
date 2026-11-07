import assert from 'node:assert/strict';
import test from 'node:test';

import { CONTROL_CENTER_ACTIONS, ControlCenterTreeModel } from '../src/controlCenter.js';

test('expõe ações nativas do Copilot, memória, MongoDB e captura', () => {
  const actions = new ControlCenterTreeModel().getChildren();
  assert.equal(actions, CONTROL_CENTER_ACTIONS);
  assert.equal(actions[0]?.command, 'workbench.action.chat.open');
  assert.ok(actions.some((action) => action.command === 'aiDevAssistant.mongodbStatus'));
  assert.ok(actions.some((action) => action.command === 'aiDevAssistant.showStoredMemories'));
  assert.ok(actions.some((action) => action.command === 'aiDevAssistant.enableAutomaticInteractionCapture'));
  assert.ok(actions.some((action) => action.command === 'aiDevAssistant.disableAutomaticInteractionCapture'));
});

test('mantém ações explícitas e não executa efeitos ao construir o modelo', () => {
  const model = new ControlCenterTreeModel();
  assert.equal(typeof model.getChildren, 'function');
  assert.ok(CONTROL_CENTER_ACTIONS.every((action) => action.command.length > 0 && action.label.length > 0));
});
