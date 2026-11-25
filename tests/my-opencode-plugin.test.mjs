import assert from 'node:assert/strict';
import { test } from 'node:test';
import plugin from '../dot_config/opencode/plugins/my-opencode/index.js';

test('my-opencode plugin remains installed without registering transformations or hooks', async () => {
  let agents = 0;
  let tools = 0;
  await plugin.setup({
    agent: { transform: async () => { agents++; } },
    tool: { transform: async () => { tools++; } },
    model: { transform: async () => assert.fail('must not restrict the model catalog') },
    provider: { transform: async () => assert.fail('must not transform providers') },
    aisdk: { hook: async () => assert.fail('must not register AI SDK hooks') },
    session: { hook: async () => assert.fail('must not register session hooks') },
  });
  assert.equal(plugin.id, 'local.my-opencode');
  assert.equal(agents, 0, 'plugin must not transform agents');
  assert.equal(tools, 0);
});
