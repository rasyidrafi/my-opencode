import assert from 'node:assert/strict';
import { test } from 'node:test';
import plugin from '../dot_config/opencode/plugins/my-opencode/index.js';

test('my-opencode adds read_media and removes worktree removal', async () => {
  const removed = [];
  const added = [];
  await plugin.setup({
    agent: { transform: async () => assert.fail('must not transform agents') },
    tool: { transform: async transform => transform({
      add: tool => added.push(tool),
      remove: name => removed.push(name),
    }) },
    model: { transform: async () => assert.fail('must not restrict the model catalog') },
    provider: { transform: async () => assert.fail('must not transform providers') },
    aisdk: { hook: async () => assert.fail('must not register AI SDK hooks') },
    session: { hook: async () => assert.fail('must not register session hooks') },
  });
  assert.equal(plugin.id, 'local.my-opencode');
  assert.deepEqual(removed, ['opencode_worktree_remove']);
  assert.deepEqual(added.map(tool => [tool.name, tool.options.permission]), [['read_media', 'read_media']]);
});
