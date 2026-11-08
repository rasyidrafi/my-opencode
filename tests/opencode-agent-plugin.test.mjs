import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agentDescriptions, agentPolicies, agentPolicyData, agentSystemPrompts, setupAgentTransform } from '../dot_config/opencode/plugins/my-opencode/agents.js';

test('title uses the RawRoute GPT Base model', () => {
  assert.equal(agentPolicyData.titleModel, 'rawroute/gpt-base');
});

test('reviewer uses the RawRoute GPT Peak model without a variant', () => {
  assert.deepEqual(agentPolicies.reviewer.model, { providerID: 'rawroute', id: 'gpt-peak' });
});

test('plugin centrally configures loaded agents without adding or removing agents', async () => {
  const agents = Object.fromEntries(Object.keys(agentPolicies).map(id => [id, {
    id,
    mode: 'primary',
    model: { providerID: 'custom', id: 'local-override' },
    description: 'Local override',
    system: 'Local instructions',
    permissions: [],
    ...(id === 'plan' ? { disabled: true } : {}),
  }]));
  const idsBefore = Object.keys(agents);
  let defaultAgent;
  await setupAgentTransform({ agent: { transform: async callback => callback({
    get: id => agents[id],
    update: (id, update) => update(agents[id]),
    default: id => { defaultAgent = id; },
  }) } });

  assert.deepEqual(Object.keys(agents), idsBefore);
  assert.ok(!Object.hasOwn(agentPolicies, 'plan'), 'Plan is not transformed by the plugin');
  assert.equal(defaultAgent, 'build');
  assert.equal(agents.build.mode, 'primary');
  assert.equal(agents.build.description, 'Local override', 'preserve the built-in Build description');
  assert.equal(agents.build.system, 'Local instructions', 'preserve the built-in Build prompt');
  assert.equal(agents.build.model, undefined, 'build inherits the session model');
  for (const id of ['general', 'explore', 'reviewer']) {
    assert.equal(agents[id].mode, 'subagent');
    assert.deepEqual(agents[id].model, agentPolicies[id].model);
    assert.deepEqual(agents[id].permissions, agentPolicies[id].permissions);
    assert.equal(agents[id].description, agentDescriptions[id]);
    assert.equal(agents[id].system, agentSystemPrompts[id]);
  }
  for (const id of ['build', 'general', 'explore', 'reviewer']) {
    for (const action of ['openchamber', 'openchamber_schedule', 'openchamber_web', 'openchamber_memory', 'openchamber_knowledge', 'openchamber_notify', 'openchamber_usage', 'openchamber_render', 'openchamber_image']) {
      assert.ok(agents[id].permissions.some(rule => rule.action === action && rule.effect === 'deny'), `${id} denies ${action}`);
    }
  }
  for (const id of ['build', 'general', 'explore', 'reviewer']) {
    const effect = id === 'build' ? 'allow' : 'deny';
    assert.ok(agents[id].permissions.some(rule => rule.action === 'openchamber_secret' && rule.effect === effect));
  }
  assert.ok(agents.build.permissions.some(rule => rule.action === 'edit' && rule.effect === 'allow'));
  assert.ok(agents.explore.permissions.some(rule => rule.action === 'edit' && rule.effect === 'deny'));
});

test('subagent prompts specify simplicity and delegation boundaries', () => {
  assert.match(agentSystemPrompts.general, /speculative edge cases/);
  assert.match(agentSystemPrompts.explore, /Do not delegate through tools, CLI, SDK, or API/);
});
