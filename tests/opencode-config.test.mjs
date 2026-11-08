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

test('fresh installs generate agent policy without OpenAI provider overrides', t => {
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
  assert.ok(!Object.hasOwn(config, 'provider'));
  assert.ok(!Object.hasOwn(config.providers, 'openai'));
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

test('RawRoute includes OAI tier aliases with configured names and limits, without input limits', t => {
  const { apply, read } = fixture(t);
  apply();
  const models = JSON.parse(read('opencode.json')).providers.rawroute.models;
  assert.deepEqual(Object.keys(models).sort(), ['oai-base', 'oai-core', 'oai-peak']);
  for (const [id, name, context] of [
    ['oai-base', 'OAI Base', 1000000],
    ['oai-core', 'OAI Core', 640000],
    ['oai-peak', 'OAI Peak', 400000],
  ]) {
    assert.equal(models[id].name, name);
    assert.deepEqual(models[id].limit, { context, output: 128000 });
    assert.ok(!Object.hasOwn(models[id].limit, 'input'));
    assert.deepEqual(models[id].capabilities, {
      tools: true,
      input: ['text', 'image'],
      output: ['text'],
      temperature: true,
      reasoning: { supported: true },
    });
  }
});

test('applying removes retired RawRoute models without removing other local models', t => {
  const { apply, put, read } = fixture(t);
  put('opencode.json', JSON.stringify({
    providers: { rawroute: { models: {
      'step-5-preview': { name: 'Retired local entry', limit: { context: 1000000 } },
      'atria-dawn': { name: 'Retired local Atria Dawn', limit: { context: 512000, output: 65536 } },
      'deepseek-v4.1-flash-1017': { name: 'Retired local DeepSeek', limit: { context: 1000000, output: 262144 } },
      spark: { name: 'Retired model' },
      cipher: { name: 'Retired model' },
      personal: { name: 'Keep local model', limit: { context: 200000, input: 150000, output: 16000 } },
    } } },
  }));
  const first = apply();
  const models = JSON.parse(read('opencode.json')).providers.rawroute.models;
  assert.ok(!Object.hasOwn(models, 'step-5-preview'));
  assert.ok(!Object.hasOwn(models, 'atria-dawn'));
  assert.ok(!Object.hasOwn(models, 'deepseek-v4.1-flash-1017'));
  assert.ok(!Object.hasOwn(models, 'spark'));
  assert.ok(!Object.hasOwn(models, 'cipher'));
  assert.deepEqual(models.personal, { name: 'Keep local model', limit: { context: 200000, output: 16000 } });
  for (const model of Object.values(models)) {
    assert.ok(!Object.hasOwn(model.limit ?? {}, 'input'));
  }
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

test('OpenCode retires OpenAI overrides in both shapes while preserving unrelated settings', t => {
  const { apply, put, read } = fixture(t);
  const selections = { general: { model: 'custom/general#high' }, personal: { model: 'custom/personal' } };
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
  assert.deepEqual(config.agents, { ...selections, title: { model: 'openai/gpt-6-luna' } });
  assert.deepEqual(config.disabled_providers, ['other', 'opencode']);
  assert.deepEqual(config.provider.custom, { models: { personal: {} } });
  assert.ok(!Object.hasOwn(config.provider, 'openai'));
  assert.ok(!Object.hasOwn(config.providers, 'openai'));
  assert.deepEqual(config.providers.custom, { name: 'Keep' });
  assert.deepEqual(apply(), first);
});
