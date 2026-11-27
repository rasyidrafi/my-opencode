import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import agentPolicyData from '../dot_config/opencode/plugins/my-opencode/agent-policy.json' with { type: 'json' };

const repository = fileURLToPath(new URL('../', import.meta.url));
const located = spawnSync('mise', ['which', 'chezmoi'], { encoding: 'utf8' });
const chezmoi = process.env.CHEZMOI_TEST_BINARY || (located.status === 0 ? located.stdout.trim() : 'chezmoi');
const agents = ['build', 'plan', 'general', 'explore', 'reviewer'];
const managedAntigravity = home => ({ package: path.join(home, 'projects', 'opencode-antigrvity') });

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-config-test-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const directory = path.join(home, '.config/opencode');
  fs.mkdirSync(path.join(directory, 'agents'), { recursive: true });
  const env = { ...process.env, HOME: home, RAWROUTE_BASE_URL: 'https://rawroute.example.test/v1', XDG_CONFIG_HOME: path.join(home, '.config'), XDG_DATA_HOME: path.join(home, '.local/share'), XDG_CACHE_HOME: path.join(home, '.cache') };
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
  return { apply, applyAll, put, read, agent, agentBody, directory, home };
}

function expectedAgentFrontmatter(name) {
  const { system, ...frontmatter } = agentPolicyData.agents[name];
  return frontmatter;
}

test('managed OpenChamber delegation skill replaces the old two-file installation', t => {
  const { applyAll, home } = fixture(t);
  const source = path.join(repository, 'dot_agents/skills/openchamber-delegation');
  const target = path.join(home, '.agents/skills/openchamber-delegation');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'model-routing.md'), 'retired');
  applyAll();
  assert.deepEqual(fs.readdirSync(target), ['SKILL.md']);
  const coding = fs.readFileSync(path.join(home, '.config/opencode/skills/coding-workflow/SKILL.md'), 'utf8');
  assert.match(coding, /`openchamber-delegation`/);
  assert.equal(fs.existsSync(path.join(home, '.config/opencode/skills/delegation-rule')), false);
  const skill = fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8');
  assert.equal(skill, fs.readFileSync(path.join(source, 'SKILL.md'), 'utf8'));
  assert.match(skill, /ownWork: true/);
  assert.match(skill, /returnResult: true/);
  assert.match(skill, /not a permission sandbox/);
});

test('applying retires explicit local plugin paths without changing other plugins', t => {
  const { apply, put, read, directory, home } = fixture(t);
  const others = ['another-plugin', { package: 'custom-plugin', options: { keep: true } }];
  put('opencode.json', JSON.stringify({ plugins: [
    others[0],
    path.join(directory, 'plugins/openai-allowlist'),
    path.join(directory, 'plugins/my-opencode'),
    others[1],
  ] }));
  const first = apply();
  assert.deepEqual(JSON.parse(read('opencode.json')).plugins, [...others, '@rasyid_rafi/opencode-muse@0.1.12', '@rasyid_rafi/opencode-antigravity@0.6.6']);
  assert.deepEqual(apply(), first);
});

test('applying replaces older Antigravity packages and paths', t => {
  const { apply, put, read, home } = fixture(t);
  put('opencode.json', JSON.stringify({ plugins: [
    '@rasyid_rafi/opencode-antigravity@1.0.0',
    managedAntigravity(home),
    'another-plugin',
    { package: 'custom-plugin', options: { keep: true } },
  ] }));
  const first = apply();
  assert.deepEqual(JSON.parse(read('opencode.json')).plugins, [
    'another-plugin',
    { package: 'custom-plugin', options: { keep: true } },
    '@rasyid_rafi/opencode-muse@0.1.12', '@rasyid_rafi/opencode-antigravity@0.6.6',
  ]);
  assert.deepEqual(apply(), first);
});

test('applying manages Muse and retires its local checkout duplicates', t => {
  const { apply, put, read, home } = fixture(t);
  const checkout = path.join(home, 'projects', 'opencode-muse');
  fs.mkdirSync(checkout, { recursive: true });
  fs.writeFileSync(path.join(checkout, 'package.json'), JSON.stringify({ name: '@rasyid_rafi/opencode-muse', version: '0.1.4' }));
  const others = ['another-plugin', { package: 'custom-plugin', options: { keep: true } }];
  put('opencode.json', JSON.stringify({ plugins: [checkout, '@rasyid_rafi/opencode-muse@0.1.2', ...others] }));
  const first = apply();
  assert.deepEqual(JSON.parse(read('opencode.json')).plugins, [...others, '@rasyid_rafi/opencode-muse@0.1.12', '@rasyid_rafi/opencode-antigravity@0.6.6']);
  assert.deepEqual(apply(), first);
});

test('applying replaces a missing managed checkout by directory name', t => {
  const { apply, put, read, home } = fixture(t);
  const checkout = path.join(home, 'projects', 'opencode-antigravity');
  const others = ['another-plugin'];
  put('opencode.json', JSON.stringify({ plugins: [checkout, ...others] }));
  const first = apply();
  assert.deepEqual(JSON.parse(read('opencode.json')).plugins, [...others, '@rasyid_rafi/opencode-muse@0.1.12', '@rasyid_rafi/opencode-antigravity@0.6.6']);
  assert.deepEqual(apply(), first);
});

test('applying keeps a local checkout that is not a retired package', t => {
  const { apply, put, read, home } = fixture(t);
  const checkout = path.join(home, 'projects', 'other-plugin');
  fs.mkdirSync(checkout, { recursive: true });
  fs.writeFileSync(path.join(checkout, 'package.json'), JSON.stringify({ name: '@someone/other-plugin', version: '1.0.0' }));
  const others = ['another-plugin'];
  put('opencode.json', JSON.stringify({ plugins: [checkout, ...others] }));
  const first = apply();
  assert.deepEqual(JSON.parse(read('opencode.json')).plugins, [checkout, ...others, '@rasyid_rafi/opencode-muse@0.1.12', '@rasyid_rafi/opencode-antigravity@0.6.6']);
  assert.deepEqual(apply(), first);
});

test('applying replaces object plugin entries for managed local paths', t => {
  const { apply, put, read, home } = fixture(t);
  put('opencode.json', JSON.stringify({ plugins: [
    managedAntigravity(home),
    'another-plugin',
  ] }));
  const first = apply();
  assert.deepEqual(JSON.parse(read('opencode.json')).plugins, [
    'another-plugin',
    '@rasyid_rafi/opencode-muse@0.1.12', '@rasyid_rafi/opencode-antigravity@0.6.6',
  ]);
  assert.deepEqual(apply(), first);
});

test('applying OpenCode configuration preserves configured instructions', t => {
  const { applyAll, put, read } = fixture(t);
  put('opencode.json', JSON.stringify({ instructions: ['~/existing.md'] }));
  applyAll();
  assert.deepEqual(JSON.parse(read('opencode.json')).instructions, ['~/existing.md']);
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

test('fresh installs generate agent policy without OpenAI provider overrides', t => {
  const { apply, read, agent, home } = fixture(t);
  const first = apply();
  assert.deepEqual(apply(), first);
  const config = JSON.parse(read('opencode.json'));
  assert.deepEqual(config.plugins, ['@rasyid_rafi/opencode-muse@0.1.12', '@rasyid_rafi/opencode-antigravity@0.6.6']);
  for (const name of agents) {
    assert.deepEqual(agent(name), expectedAgentFrontmatter(name));
  }
  assert.deepEqual(agent('plan'), expectedAgentFrontmatter('plan'));
  assert.deepEqual(config.agents, { title: { model: 'rawroute/gpt-base' } });
  assert.equal(config.default_agent, 'build');
  assert.ok(!Object.hasOwn(config, 'provider'));
  assert.ok(!Object.hasOwn(config.providers, 'openai'));
});

test('generated agent files expose the repo policy to the UI', t => {
  const { apply, agent, agentBody } = fixture(t);
  apply();
  for (const name of agents) {
    const expected = expectedAgentFrontmatter(name);
    assert.deepEqual(agent(name), expected);
    assert.equal(agent(name).description, agentPolicyData.agents[name].description);
    assert.equal(agentBody(name), agentPolicyData.agents[name].system ?? '');
  }
  assert.deepEqual(agent('plan'), expectedAgentFrontmatter('plan'));
});

test('agent files replace local permission overrides with the managed policy', t => {
  const { apply, put, agent } = fixture(t);
  for (const name of agents) put(`agents/${name}.md`, '---\npermissions:\n  - action: read\n    resource: "*"\n    effect: deny\n---\n');
  const first = apply();
  assert.deepEqual(agent('build').permissions, [
    { action: '*', resource: '*', effect: 'deny' },
    ...['shell', 'edit', 'patch', 'skill', 'external_directory', 'openchamber', 'openchamber_render', 'openchamber_secret', 'read_media']
      .map(action => ({ action, resource: '*', effect: 'allow' })),
  ]);
  for (const name of ['general', 'explore', 'reviewer']) {
    assert.equal(agent(name).mode, 'primary');
    const actions = name === 'general' ? ['shell', 'patch', 'edit', 'skill', 'read_media', 'external_directory'] : ['read_media', 'shell', 'skill', 'external_directory'];
    assert.deepEqual(agent(name).permissions, [
      { action: '*', resource: '*', effect: 'deny' },
      ...actions.map(action => ({ action, resource: '*', effect: 'allow' })),
    ]);
  }
  assert.deepEqual(apply(), first);
});

test('apply removes retired multi-reviewer files', t => {
  const { applyAll, home } = fixture(t);
  const paths = ['agents/multi_reviewer.md', 'plugins/my-opencode/fusion.js', 'plugins/my-opencode/fusion.json', 'plugins/my-opencode/simulated.js'];
  for (const name of paths) {
    const file = path.join(home, '.config/opencode', name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'retired');
  }
  applyAll();
  for (const name of paths) assert.equal(fs.existsSync(path.join(home, '.config/opencode', name)), false);
  assert.equal(Object.hasOwn(agentPolicyData.agents, 'multi_reviewer'), false);
});

test('managed role profiles and disabled plan replace local overrides', t => {
  const { apply, put, read, agent, agentBody } = fixture(t);
  const overrides = { general: { model: 'custom/general' }, explore: { permissions: [] }, reviewer: { disabled: true }, plan: { model: 'custom/plan', disabled: false } };
  put('opencode.json', JSON.stringify({ agents: overrides, agent: overrides }));
  const first = apply();
  for (const name of Object.keys(overrides)) {
    assert.deepEqual(agent(name), expectedAgentFrontmatter(name));
    assert.equal(agentBody(name), agentPolicyData.agents[name].system ?? '');
  }
  const config = JSON.parse(read('opencode.json'));
  assert.deepEqual(config.agents, { title: { model: 'rawroute/gpt-base' } });
  assert.ok(!Object.hasOwn(config, 'agent'));
  assert.deepEqual(apply(), first);
});

test('plan agent remains disabled and rejects local policy overrides', t => {
  const { apply, put, agent } = fixture(t);
  apply();
  assert.equal(agent('plan').disabled, true);
  put('agents/plan.md', '---\ndisabled: false\nmodel: custom/plan\n---\n');
  const first = apply();
  assert.equal(agent('plan').disabled, true);
  assert.ok(!Object.hasOwn(agent('plan'), 'model'));
  assert.deepEqual(apply(), first);
});

test('applying overwrites a local default agent with the managed primary agent', t => {
  const { apply, put, read } = fixture(t);
  put('opencode.json', JSON.stringify({ default_agent: 'general', keepLocal: true }));
  const first = apply();
  const config = JSON.parse(read('opencode.json'));
  assert.equal(config.default_agent, 'build');
  assert.equal(config.keepLocal, true);
  assert.deepEqual(apply(), first);
});

test('title model remains in config for OpenChamber model resolution', t => {
  const { apply, read } = fixture(t);
  const first = apply();
  assert.equal(JSON.parse(read('opencode.json')).agents.title.model, 'rawroute/gpt-base');
  assert.deepEqual(apply(), first);
});

test('RawRoute includes managed models with configured names and limits, without input limits', t => {
  const { apply, read } = fixture(t);
  apply();
  const models = JSON.parse(read('opencode.json')).providers.rawroute.models;
  assert.deepEqual(Object.keys(models).sort(), ['base-alpha', 'base-beta', 'base-charlie', 'gpt-base', 'gpt-core', 'gpt-peak']);
  for (const [id, name, context, output, input] of [
    ['base-alpha', 'Base Alpha', 1000000, 128000, ['text', 'image', 'pdf']],
    ['base-beta', 'Base Beta', 1000000, 128000, ['text', 'image', 'pdf']],
    ['base-charlie', 'Base Charlie', 1000000, 128000, ['text', 'image', 'pdf']],
    ['gpt-base', 'GPT Base', 1000000, 128000, ['text', 'image']],
    ['gpt-core', 'GPT Core', 640000, 128000, ['text', 'image']],
    ['gpt-peak', 'GPT Peak', 400000, 128000, ['text', 'image']],
  ]) {
    assert.equal(models[id].name, name);
    assert.deepEqual(models[id].limit, { context, output });
    assert.ok(!Object.hasOwn(models[id].limit, 'input'));
    assert.deepEqual(models[id].capabilities, {
      tools: true,
      input,
      output: ['text'],
      temperature: true,
      reasoning: { supported: true },
    });
  }
});

test('applying removes retired RawRoute and OAI alias models without removing other local models', t => {
  const { apply, put, read } = fixture(t);
  put('opencode.json', JSON.stringify({
    providers: { rawroute: { models: {
      'step-5-preview': { name: 'Retired local entry', limit: { context: 1000000 } },
      'atria-dawn': { name: 'Retired local Atria Dawn', limit: { context: 512000, output: 65536 } },
      'deepseek-v4.1-flash-1017': { name: 'Retired local DeepSeek', limit: { context: 1000000, output: 262144 } },
      'oai-base': { name: 'Retired OAI Base', limit: { context: 1000000, output: 128000 } },
      'oai-core': { name: 'Retired OAI Core', limit: { context: 640000, output: 128000 } },
      'oai-peak': { name: 'Retired OAI Peak', limit: { context: 400000, output: 128000 } },
      spark: { name: 'Retired model' },
      cipher: { name: 'Retired model' },
      'base-dawn': { name: 'Retired Base Dawn', limit: { context: 512000, output: 65536 } },
      'base-flash': { name: 'Retired Base Flash', limit: { context: 1000000, output: 131072 } },
      'base-cat': { name: 'Retired Base Cat', limit: { context: 1048576, output: 262144 } },
      personal: { name: 'Keep local model', limit: { context: 200000, input: 150000, output: 16000 } },
    } } },
  }));
  const first = apply();
  const models = JSON.parse(read('opencode.json')).providers.rawroute.models;
  assert.ok(!Object.hasOwn(models, 'step-5-preview'));
  assert.ok(!Object.hasOwn(models, 'atria-dawn'));
  assert.ok(!Object.hasOwn(models, 'deepseek-v4.1-flash-1017'));
  assert.ok(!Object.hasOwn(models, 'oai-base'));
  assert.ok(!Object.hasOwn(models, 'oai-core'));
  assert.ok(!Object.hasOwn(models, 'oai-peak'));
  assert.ok(!Object.hasOwn(models, 'spark'));
  assert.ok(!Object.hasOwn(models, 'cipher'));
  assert.ok(!Object.hasOwn(models, 'base-dawn'));
  assert.ok(!Object.hasOwn(models, 'base-flash'));
  assert.ok(!Object.hasOwn(models, 'base-cat'));
  assert.deepEqual(models.personal, { name: 'Keep local model', limit: { context: 200000, output: 16000 } });
  for (const model of Object.values(models)) {
    assert.ok(!Object.hasOwn(model.limit ?? {}, 'input'));
  }
  assert.deepEqual(apply(), first);
});

test('applying migrates retired RawRoute OAI selections without changing unrelated values', t => {
  const { apply, put, read } = fixture(t);
  const local = {
    model: 'rawroute/oai-base#high',
    small_model: 'rawroute/oai-core',
    agents: {
      customRawroute: { model: 'rawroute/oai-peak#low', description: 'rawroute/oai-core is mentioned here' },
      custom: { model: 'custom/provider-model' },
      unrelated: { model: 'custom/rawroute/oai-core' },
    },
    agent: { legacy: { model: 'rawroute/oai-core#medium' } },
    prompt: 'rawroute/oai-base',
    extra: { selection: 'rawroute/oai-peak' },
  };
  put('opencode.json', JSON.stringify(local));

  const first = apply();
  const config = JSON.parse(read('opencode.json'));
  assert.equal(config.model, 'rawroute/gpt-base#high');
  assert.equal(config.small_model, 'rawroute/gpt-core');
  assert.equal(config.agents.customRawroute.model, 'rawroute/gpt-peak#low');
  assert.equal(config.agents.customRawroute.description, local.agents.customRawroute.description);
  assert.equal(config.agents.custom.model, 'custom/provider-model');
  assert.equal(config.agents.unrelated.model, 'custom/rawroute/oai-core');
  assert.equal(config.agent.legacy.model, 'rawroute/gpt-core#medium');
  assert.equal(config.prompt, 'rawroute/oai-base');
  assert.equal(config.extra.selection, 'rawroute/oai-peak');
  assert.deepEqual(apply(), first);
});

test('applying replaces local agent edits with the canonical repo policy', t => {
  const { apply, put, agent, agentBody } = fixture(t);
  for (const name of agents) put(`agents/${name}.md`, `---\r\nmodel: 'custom/${name}#high' # local selection\r\npermissions: []\r\n---\r\nOld instructions\r\n`);
  const first = apply();
  for (const name of agents) {
    assert.deepEqual(agent(name), expectedAgentFrontmatter(name));
    assert.equal(agentBody(name), agentPolicyData.agents[name].system ?? '');
  }
  assert.deepEqual(apply(), first);
  put('agents/general.md', '---\nmodel: custom/another-model#low\npermissions: []\n---\nLocal prompt');
  apply();
  assert.deepEqual(agent('general'), expectedAgentFrontmatter('general'));
  assert.equal(agentBody('general'), agentPolicyData.agents.general.system);
});

test('OpenCode retires OpenAI overrides in both shapes while preserving unrelated settings', t => {
  const { apply, put, read } = fixture(t);
  const selections = { custom: { model: 'custom/custom#high' }, personal: { model: 'custom/personal' } };
  put('opencode.json', JSON.stringify({
    model: 'custom/main', agents: selections, disabled_providers: ['other'],
    providers: { openai: { settings: { baseURL: 'https://old.example', apiKey: 'old-key-reference' }, models: { personal: {} } }, custom: { name: 'Keep' } },
    provider: { custom: { models: { personal: {} } }, openai: {
      options: { baseURL: 'https://old.example', timeout: 1234 },
      models: { 'gpt-6-luna-fast': { name: 'Local name', limit: { context: 1 } }, personal: { limit: { context: 42 } } },
    } },
  }));
  const first = apply();
  const config = JSON.parse(read('opencode.json'));
  assert.equal(config.model, 'custom/main');
  assert.deepEqual(config.agents, { ...selections, title: { model: 'rawroute/gpt-base' } });
  assert.deepEqual(config.disabled_providers, ['other', 'opencode']);
  assert.deepEqual(config.provider.custom, { models: { personal: {} } });
  assert.ok(!Object.hasOwn(config.provider, 'openai'));
  assert.ok(!Object.hasOwn(config.providers, 'openai'));
  assert.deepEqual(config.providers.custom, { name: 'Keep' });
  assert.deepEqual(apply(), first);
});
