import assert from 'node:assert/strict';
import { test } from 'node:test';
import plugin, { setupToolTransform } from '../dot_config/opencode/plugins/my-opencode/index.js';

test('my-opencode plugin registers tools and the simulated provider, never transforming agents or models', async () => {
  let agents = 0;
  let tools = 0;
  const providers = [];
  const aisdkHooks = [];
  const sessionHooks = [];
  await plugin.setup({
    agent: { transform: async () => { agents++; } },
    tool: { transform: async () => { tools++; } },
    model: { transform: async () => assert.fail('must not restrict the model catalog') },
    provider: { transform: async callback => callback({ add: definition => providers.push(definition) }) },
    aisdk: { hook: async (name, callback, options) => aisdkHooks.push({ name, options }) },
    session: { hook: async (name, callback, options) => sessionHooks.push({ name, options }) },
  });
  assert.equal(plugin.id, 'local.my-opencode');
  assert.equal(agents, 0, 'plugin must not transform agents');
  assert.equal(tools, 1);
  assert.deepEqual(providers.map(definition => definition.info.id), ['simulated']);
  assert.deepEqual(aisdkHooks, [{ name: 'sdk', options: { providerID: 'simulated' } }]);
  assert.deepEqual(sessionHooks.map(entry => entry.name).sort(), ['compaction', 'model.request', 'retry', 'title']);
});

test('my-opencode plugin removes worktree removal and adds read_media without changing other tools', async () => {
  let transform;
  await setupToolTransform({ tool: { transform: async callback => { transform = callback; } } });
  const tools = new Set(['shell', 'edit', 'opencode_worktree_remove', 'skill']);

  transform({ remove: id => tools.delete(id), add: tool => tools.add(tool.name) });

  assert.deepEqual([...tools], ['shell', 'edit', 'skill', 'read_media']);
});
