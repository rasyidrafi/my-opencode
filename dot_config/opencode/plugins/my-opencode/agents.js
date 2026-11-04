import agentPolicyData from './agent-policy.json' with { type: 'json' };

export { agentPolicyData };

function modelReference(value) {
  const match = /^([^/]+)\/([^#]+)(?:#(.+))?$/.exec(value);
  if (!match) throw new Error(`Invalid agent model reference: ${value}`);
  const [, providerID, id, variant] = match;
  return { providerID, id, ...(variant ? { variant } : {}) };
}

function permissionsFor(agent) {
  if (!agent.permissionOverrides) return undefined;
  const effects = { ...agentPolicyData.commonPermissions, ...agent.permissionOverrides };
  return agentPolicyData.permissionOrder
    .filter(action => Object.hasOwn(effects, action))
    .map(action => ({ action, resource: '*', effect: effects[action] }));
}

export const agentDescriptions = Object.fromEntries(
  Object.entries(agentPolicyData.agents)
    .filter(([, agent]) => agent.description !== undefined)
    .map(([id, agent]) => [id, agent.description]),
);

export const agentSystemPrompts = Object.fromEntries(
  Object.entries(agentPolicyData.agents)
    .filter(([, agent]) => agent.system !== undefined)
    .map(([id, agent]) => [id, agent.system]),
);

export const agentPolicies = Object.fromEntries(
  Object.entries(agentPolicyData.agents)
    .filter(([id]) => id !== 'plan')
    .map(([id, agent]) => {
      const { permissionOverrides, model, ...policy } = agent;
      return [id, {
        ...policy,
        ...(model ? { model: modelReference(model) } : {}),
        ...(permissionOverrides ? { permissions: permissionsFor(agent) } : {}),
      }];
    }),
);

export async function setupAgentTransform(ctx) {
  await ctx.agent.transform(editor => {
    for (const [id, policy] of Object.entries(agentPolicies)) {
      if (!editor.get(id)) continue;
      editor.update(id, agent => {
        if (policy.mode !== undefined) agent.mode = policy.mode;
        if (policy.description !== undefined) agent.description = policy.description;
        if (policy.system !== undefined) agent.system = policy.system;
        if (policy.permissions) agent.permissions = structuredClone(policy.permissions);
        if (policy.model) agent.model = structuredClone(policy.model);
        else delete agent.model;
      });
    }
    if (editor.get(agentPolicyData.defaultAgent)) editor.default(agentPolicyData.defaultAgent);
  });
}
