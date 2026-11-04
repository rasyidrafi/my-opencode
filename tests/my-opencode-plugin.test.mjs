import assert from 'node:assert/strict';
import { test } from 'node:test';
import plugin, { allowedModels, setupToolTransform } from '../dot_config/opencode/plugins/my-opencode/index.js';

test('my-opencode plugin blocks unselected and future OpenAI models on every catalog rebuild', async () => {
  let transform;
  let toolTransform;
  await plugin.setup({
    agent: { transform: async () => {} },
    tool: { transform: async callback => { toolTransform = callback; } },
    model: { transform: async callback => { transform = callback; } },
  });
  assert.equal(plugin.id, 'local.my-opencode');
  assert.equal(typeof toolTransform, 'function');
  const rows = [
    ...[...allowedModels].map(id => ({ providerID: 'openai', id, enabled: true })),
    ...['gpt-5.6-cyber', 'chat-latest', 'gpt-audio-1.5', 'gpt-5-search-api', 'future-model'].map(id => ({ providerID: 'openai', id, enabled: true })),
    { providerID: 'rawroute', id: 'atria-dawn', enabled: true },
  ];
  const editor = {
    list: providerID => rows.filter(row => row.providerID === providerID),
    update: (providerID, id, edit) => edit(rows.find(row => row.providerID === providerID && row.id === id)),
  };
  transform(editor);
  assert.deepEqual(rows.filter(row => row.providerID === 'openai' && row.enabled).map(row => row.id), [...allowedModels]);
  assert.equal(rows.at(-1).enabled, true);
  rows[0].enabled = false;
  rows.push({ providerID: 'openai', id: 'another-new-model', enabled: true });
  transform(editor);
  assert.equal(rows[0].enabled, false, 'must preserve upstream restrictions');
  assert.equal(rows.at(-1).enabled, false);
});

test('my-opencode plugin removes the built-in worktree removal tool without changing other tools', async () => {
  let transform;
  await setupToolTransform({ tool: { transform: async callback => { transform = callback; } } });
  const tools = new Set(['shell', 'edit', 'opencode_worktree_remove', 'skill']);

  transform({ remove: id => tools.delete(id) });

  assert.deepEqual([...tools], ['shell', 'edit', 'skill']);
});
