import assert from 'node:assert/strict';
import { test } from 'node:test';
import plugin, { setupToolTransform } from '../dot_config/opencode/plugins/my-opencode/index.js';

test('my-opencode plugin registers tools and never transforms agents or models', async () => {
  let agents = 0;
  let tools = 0;
  await plugin.setup({
    agent: { transform: async () => { agents++; } },
    tool: { transform: async () => { tools++; } },
    model: { transform: async () => assert.fail('must not restrict the model catalog') },
  });
  assert.equal(plugin.id, 'local.my-opencode');
  assert.equal(agents, 0, 'plugin must not transform agents');
  assert.equal(tools, 1);
});

test('my-opencode plugin removes worktree removal and adds read_media without changing other tools', async () => {
  let transform;
  await setupToolTransform({ tool: { transform: async callback => { transform = callback; } } });
  const tools = new Set(['shell', 'edit', 'opencode_worktree_remove', 'skill']);

  transform({ remove: id => tools.delete(id), add: tool => tools.add(tool.name) });

  assert.deepEqual([...tools], ['shell', 'edit', 'skill', 'read_media']);
});
