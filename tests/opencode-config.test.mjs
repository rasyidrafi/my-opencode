import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { agentDescriptions, agentPolicies, agentSystemPrompts } from '../dot_config/opencode/plugins/my-opencode/agents.js';

const repository = fileURLToPath(new URL('../', import.meta.url));
const located = spawnSync('mise', ['which', 'chezmoi'], { encoding: 'utf8' });
const chezmoi = process.env.CHEZMOI_TEST_BINARY || (located.status === 0 ? located.stdout.trim() : 'chezmoi');
const agents = ['build', 'plan', 'general', 'explore', 'reviewer'];

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-config-test-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const directory = path.join(home, '.config/opencode');
  fs.mkdirSync(path.join(directory, 'agents'), { recursive: true });
  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), XDG_DATA_HOME: path.join(home, '.local/share'), XDG_CACHE_HOME: path.join(home, '.cache') };
  const cm = (args, input) => {
    const result = spawnSync(chezmoi, ['--source', repository, '--destination', home,
      '--config', path.join(home, 'chezmoi.toml'), '--persistent-state', path.join(home, 'state.boltdb'),
      '--no-tty', ...args], { env, input, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  const put = (name, content) => fs.writeFileSync(path.join(directory, name), content);
  const read = name => fs.readFileSync(path.join(directory, name), 'utf8');
  const apply = () => {
    cm(['apply', '--force', path.join(directory, 'opencode.json'), ...agents.map(name => path.join(directory, 'agents', `${name}.md`))]);
    return [read('opencode.json'), ...agents.map(name => read(`agents/${name}.md`))];
  };
  const applyAll = () => {
    const result = spawnSync(chezmoi, ['--source', repository, '--destination', home,
      '--config', path.join(home, 'chezmoi.toml'), '--persistent-state', path.join(home, 'state.boltdb'),
      '--no-tty', 'apply'], { env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  const agent = name => {
    const text = read(`agents/${name}.md`);
    const frontmatter = text.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
    assert.ok(frontmatter, 'valid Markdown frontmatter');
    return JSON.parse(cm(['execute-template', '--with-stdin', '{{ .chezmoi.stdin | fromYaml | toJson }}'], frontmatter[1]));
  };
  const agentBody = name => {
    const text = read(`agents/${name}.md`);
    const frontmatter = text.match(/^---\n[\s\S]*?\n---(?:\n|$)/);
    assert.ok(frontmatter, 'valid Markdown frontmatter');
    return text.slice(frontmatter[0].length).trimEnd();
  };
  return { apply, applyAll, put, read, agent, agentBody, directory };
}

function expectedAgentFrontmatter(name) {
  const expected = structuredClone(agentPolicies[name]);
  delete expected.system;
  if (expected.model) {
    const { providerID, id, variant } = expected.model;
    expected.model = `${providerID}/${id}${variant ? `#${variant}` : ''}`;
  }
  return expected;
}

test('applying retires explicit local plugin paths without changing other plugins', t => {
  const { apply, put, read, directory } = fixture(t);
  const others = ['another-plugin', { package: 'custom-plugin', options: { keep: true } }];
  put('opencode.json', JSON.stringify({ plugins: [
    others[0],
    path.join(directory, 'plugins/openai-allowlist'),
    path.join(directory, 'plugins/my-opencode'),
    others[1],
  ] }));
  const first = apply();
  assert.deepEqual(JSON.parse(read('opencode.json')).plugins, others);
  assert.deepEqual(apply(), first);
});

test('chezmoi apply removes the stale renamed plugin file but preserves unrelated files', t => {
  const { applyAll, directory } = fixture(t);
  const legacy = path.join(directory, 'plugins/openai-allowlist');
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, 'index.js'), "export default { id: 'local.openai-allowlist' };\n");
  fs.writeFileSync(path.join(legacy, 'notes.txt'), 'unrelated local file');

  applyAll();

  assert.ok(!fs.existsSync(path.join(legacy, 'index.js')));
  assert.equal(fs.readFileSync(path.join(legacy, 'notes.txt'), 'utf8'), 'unrelated local file');
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(directory, 'plugins/my-opencode/agent-policy.json'), 'utf8')),
    JSON.parse(fs.readFileSync(path.join(repository, 'dot_config/opencode/plugins/my-opencode/agent-policy.json'), 'utf8')),
  );
});

test('fresh installs leave agent policy to the plugin and seed identical Luna limits', t => {
  const { apply, read, agent } = fixture(t);
  const first = apply();
  assert.deepEqual(apply(), first);
  const config = JSON.parse(read('opencode.json'));
  assert.ok(!Object.hasOwn(config, 'plugins'));
  for (const name of ['build', 'general', 'explore', 'reviewer']) {
    assert.deepEqual(agent(name), expectedAgentFrontmatter(name));
  }
  assert.deepEqual(agent('plan'), { disabled: true });
  assert.deepEqual(config.agents, { title: { model: 'openai/gpt-6-luna' } });
  const models = JSON.parse(read('opencode.json')).provider.openai.models;
  assert.deepEqual(models['gpt-6-luna-fast'].limit, models['gpt-6-luna'].limit);
  assert.deepEqual(models['gpt-6-luna-fast'].limit, { context: 680000, input: 552000, output: 128000 });
  assert.deepEqual(models['gpt-6.1-terra'].limit, models['gpt-6.1-sol'].limit);
  assert.deepEqual(models['gpt-6.1-terra'].limit, { context: 500000, input: 372000, output: 128000 });
});

test('generated agent files expose the plugin policy to the UI', t => {
  const { apply, agent, agentBody } = fixture(t);
  apply();
  for (const name of ['build', 'general', 'explore', 'reviewer']) {
    assert.deepEqual(agent(name), expectedAgentFrontmatter(name));
    assert.deepEqual(agent(name).permissions, agentPolicies[name].permissions);
    assert.equal(agent(name).description, agentDescriptions[name]);
    assert.equal(agentBody(name), agentSystemPrompts[name] ?? '');
  }
  assert.deepEqual(agent('plan'), { disabled: true });
});

test('plan agent remains disabled and its stub rejects local policy overrides', t => {
  const { apply, put, agent } = fixture(t);
  apply();
  assert.equal(agent('plan').disabled, true);
  put('agents/plan.md', '---\ndisabled: false\nmodel: custom/plan\n---\n');
  const first = apply();
  assert.equal(agent('plan').disabled, true);
  assert.ok(!Object.hasOwn(agent('plan'), 'model'));
  assert.deepEqual(apply(), first);
});

test('title model remains in config for OpenChamber model resolution', t => {
  const { apply, read } = fixture(t);
  const first = apply();
  assert.equal(JSON.parse(read('opencode.json')).agents.title.model, 'openai/gpt-6-luna');
  assert.deepEqual(apply(), first);
});

test('RawRoute includes Atria Dawn with GLM 5.2 fallback metadata and a 512K context', t => {
  const { apply, read } = fixture(t);
  const first = apply();
  const models = JSON.parse(read('opencode.json')).providers.rawroute.models;
  assert.ok(!Object.hasOwn(models, 'step-5-preview'));
  const model = models['atria-dawn'];
  assert.equal(model.name, 'Atria Dawn');
  assert.equal(model.family, 'glm');
  assert.equal(model.releaseDate, '2026-06-13');
  assert.deepEqual(model.limit, { context: 512000, input: 446464, output: 65536 });
  assert.equal(model.limit.input, model.limit.context - model.limit.output);
  assert.deepEqual(model.capabilities, {
    tools: true,
    input: ['text'],
    output: ['text'],
    temperature: true,
    reasoning: { supported: true, toggle: true, effort: ['high', 'max'] },
  });
  assert.deepEqual(model.compatibility, { reasoningField: 'reasoning_content' });
  assert.deepEqual(model.cost, { input: 1.19516, output: 4.18306, cache: { read: 0.29879, write: 0 } });
  assert.deepEqual(apply(), first);
});

test('RawRoute includes DeepSeek V4.1 Flash 1017 with exact 1M context and image input', t => {
  const { apply, put, read } = fixture(t);
  put('opencode.json', JSON.stringify({ providers: { rawroute: { models: {
    'deepseek-v4.1-flash-1017': {
      limit: { context: 1048576, input: 1048576, output: 65536 },
      capabilities: { input: ['text'] },
    },
  } } } }));
  const first = apply();
  const models = JSON.parse(read('opencode.json')).providers.rawroute.models;
  const model = models['deepseek-v4.1-flash-1017'];
  assert.equal(model.name, 'DeepSeek V4.1 Flash 1017');
  assert.equal(model.family, 'deepseek-flash');
  assert.equal(model.releaseDate, '2026-10-17');
  assert.deepEqual(model.limit, { context: 1000000, input: 737856, output: 262144 });
  assert.equal(model.limit.input, model.limit.context - model.limit.output);
  assert.deepEqual(model.capabilities, {
    tools: true,
    input: ['text', 'image'],
    output: ['text'],
    temperature: true,
    reasoning: { supported: true, toggle: true, effort: ['low', 'high', 'max'] },
  });
  assert.deepEqual(model.compatibility, { reasoningField: 'reasoning_content' });
  assert.deepEqual(model.cost, { input: 0.15, output: 0.6, cache: { read: 0.003 } });
  assert.equal(models['atria-dawn'].limit.context, 512000);
  assert.deepEqual(apply(), first);
});

test('applying removes retired Step 5 Preview without removing other local RawRoute models', t => {
  const { apply, put, read } = fixture(t);
  put('opencode.json', JSON.stringify({
    providers: { rawroute: { models: {
      'step-5-preview': { name: 'Retired local entry', limit: { context: 1000000 } },
      personal: { name: 'Keep local model' },
    } } },
  }));
  const first = apply();
  const models = JSON.parse(read('opencode.json')).providers.rawroute.models;
  assert.ok(!Object.hasOwn(models, 'step-5-preview'));
  assert.equal(models['atria-dawn'].limit.context, 512000);
  assert.deepEqual(models.personal, { name: 'Keep local model' });
  assert.deepEqual(apply(), first);
});

test('applying replaces local agent edits with the canonical plugin policy', t => {
  const { apply, put, agent, agentBody } = fixture(t);
  for (const name of agents) put(`agents/${name}.md`, `---\r\nmodel: 'custom/${name}#high' # local selection\r\npermissions: []\r\n---\r\nOld instructions\r\n`);
  const first = apply();
  for (const name of agents) {
    assert.deepEqual(agent(name), name === 'plan' ? { disabled: true } : expectedAgentFrontmatter(name));
    assert.equal(agentBody(name), agentSystemPrompts[name] ?? '');
  }
  assert.deepEqual(apply(), first);
  put('agents/general.md', '---\nmodel: custom/another-model#low\npermissions: []\n---\nLocal prompt');
  apply();
  assert.deepEqual(agent('general'), expectedAgentFrontmatter('general'));
  assert.equal(agentBody('general'), agentSystemPrompts.general);
});

test('OpenCode merges owned limits and routing while preserving user models and unrelated settings', t => {
  const { apply, put, read } = fixture(t);
  const selections = { general: { model: 'custom/general#high' }, personal: { model: 'custom/personal' } };
  put('opencode.json', JSON.stringify({
    model: 'custom/main', agents: selections, disabled_providers: ['other'],
    provider: { custom: { models: { personal: {} } }, openai: {
      options: { baseURL: 'https://old.example', timeout: 1234 },
      models: { 'gpt-6-luna-fast': { name: 'Local name', limit: { context: 1 } }, personal: { limit: { context: 42 } } },
    } },
  }));
  const first = apply();
  const config = JSON.parse(read('opencode.json'));
  assert.equal(config.model, 'custom/main');
  assert.deepEqual(config.agents, { ...selections, title: { model: 'openai/gpt-6-luna' } });
  assert.deepEqual(config.disabled_providers, ['other', 'opencode']);
  assert.deepEqual(config.provider.custom, { models: { personal: {} } });
  assert.equal(config.provider.openai.options.timeout, 1234);
  assert.equal(config.provider.openai.options.baseURL, 'https://ccs.halotec.my.id/v1');
  assert.equal(config.provider.openai.models['gpt-6-luna-fast'].name, 'Local name');
  assert.equal(config.provider.openai.models['gpt-6-luna-fast'].limit.context, 680000);
  assert.equal(config.provider.openai.models.personal.limit.context, 42);
  assert.deepEqual(apply(), first);
});
