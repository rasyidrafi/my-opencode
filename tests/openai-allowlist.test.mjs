import assert from 'node:assert/strict';
import { test } from 'node:test';
import plugin, { allowedModels } from '../dot_config/opencode/plugins/openai-allowlist/index.js';

test('OpenAI allowlist blocks unselected and future models on every catalog rebuild', async () => {
  let transform;
  await plugin.setup({ model: { transform: async callback => { transform = callback; } } });
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
