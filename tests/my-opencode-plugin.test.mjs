import assert from 'node:assert/strict';
import { test } from 'node:test';
import plugin, { setupToolTransform } from '../dot_config/opencode/plugins/my-opencode/index.js';

test('my-opencode plugin configures agents and tools without transforming models', async () => {
  let agents = 0;
  let tools = 0;
  await plugin.setup({
    agent: { transform: async () => { agents++; } },
    tool: { transform: async () => { tools++; } },
    model: { transform: async () => assert.fail('must not restrict the model catalog') },
  });
  assert.equal(plugin.id, 'local.my-opencode');
  assert.equal(agents, 1);
  assert.equal(tools, 1);
});

test('my-opencode plugin removes the built-in worktree removal tool without changing other tools', async () => {
  let transform;
  await setupToolTransform({ tool: { transform: async callback => { transform = callback; } } });
  const tools = new Set(['shell', 'edit', 'opencode_worktree_remove', 'skill']);

  transform({ remove: id => tools.delete(id) });

  assert.deepEqual([...tools], ['shell', 'edit', 'skill']);
});
