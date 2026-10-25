import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

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
  const agent = name => {
    const text = read(`agents/${name}.md`);
    const frontmatter = text.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
    assert.ok(frontmatter, 'valid Markdown frontmatter');
    return JSON.parse(cm(['execute-template', '--with-stdin', '{{ .chezmoi.stdin | fromYaml | toJson }}'], frontmatter[1]));
  };
  return { apply, put, read, agent };
}

test('fresh installs seed agent models and identical Luna limits; reapply is stable', t => {
  const { apply, read, agent } = fixture(t);
  const first = apply();
  assert.deepEqual(apply(), first);
  for (const name of ['general', 'explore']) assert.equal(agent(name).model, 'openai/gpt-6-luna-fast#xhigh');
  assert.equal(agent('reviewer').model, 'openai/gpt-6-astra#low');
  for (const name of ['build', 'plan']) assert.ok(!Object.hasOwn(agent(name), 'model'));
  const models = JSON.parse(read('opencode.json')).provider.openai.models;
  assert.deepEqual(models['gpt-6-luna-fast'].limit, models['gpt-6-luna'].limit);
  assert.deepEqual(models['gpt-6-luna-fast'].limit, { context: 680000, input: 552000, output: 128000 });
});

test('title generation uses GPT 6 Luna with the default variant', t => {
  const { apply, read } = fixture(t);
  const first = apply();
  assert.equal(JSON.parse(read('opencode.json')).agents.title.model, 'openai/gpt-6-luna');
  assert.deepEqual(apply(), first);
});

test('RawRoute includes official StepFun Step 5 Preview metadata', t => {
  const { apply, read } = fixture(t);
  const first = apply();
  const model = JSON.parse(read('opencode.json')).providers.rawroute.models['step-5-preview'];
  assert.equal(model.name, 'Step 5 Preview');
  assert.equal(model.releaseDate, '2026-09-16');
  assert.deepEqual(model.limit, { context: 1000000, input: 1000000, output: 65536 });
  assert.deepEqual(model.capabilities, {
    tools: true,
    input: ['text', 'image', 'video'],
    output: ['text'],
    reasoning: { supported: true, effort: ['low', 'medium', 'high'] },
  });
  assert.deepEqual(model.compatibility, { reasoningField: 'reasoning_content' });
  assert.deepEqual(model.cost, { input: 1.04613, output: 2.98895 });
  assert.deepEqual(apply(), first);
});

test('all managed agents preserve custom models while refreshing repo instructions and permissions', t => {
  const { apply, put, read, agent } = fixture(t);
  for (const name of agents) put(`agents/${name}.md`, `---\r\nmodel: 'custom/${name}#high' # local selection\r\npermissions: []\r\n---\r\nOld instructions\r\n`);
  const first = apply();
  for (const name of agents) {
    assert.equal(agent(name).model, `custom/${name}#high`);
    assert.ok(agent(name).permissions.length > 0);
    assert.ok(!read(`agents/${name}.md`).includes('Old instructions'));
  }
  assert.deepEqual(apply(), first);
  put('agents/general.md', read('agents/general.md').replace('custom/general#high', 'openai/gpt-6-luna-fast#xhigh'));
  apply();
  assert.equal(agent('general').model, 'openai/gpt-6-luna-fast#xhigh');
});

test('missing model fields get defaults and structured model selections survive', t => {
  const { apply, put, agent } = fixture(t);
  put('agents/general.md', '---\nmode: subagent\n---\n');
  put('agents/explore.md', 'Old instructions without frontmatter\n');
  put('agents/reviewer.md', '---\nmodel:\n  providerID: custom\n  model: review\n  variant: high\n---\n');
  apply();
  assert.equal(agent('general').model, 'openai/gpt-6-luna-fast#xhigh');
  assert.equal(agent('explore').model, 'openai/gpt-6-luna-fast#xhigh');
  assert.deepEqual(agent('reviewer').model, { providerID: 'custom', model: 'review', variant: 'high' });
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
