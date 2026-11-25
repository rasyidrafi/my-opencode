import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { configure, modes, options } from './setup.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const catalog = JSON.parse(fs.readFileSync(path.join(repository, '.chezmoidata/rawroute.json'), 'utf8')).rawroute.models;
const located = spawnSync('mise', ['which', 'chezmoi'], { encoding: 'utf8' });
const chezmoi = process.env.CHEZMOI_TEST_BINARY || (located.status === 0 ? located.stdout.trim() : null);

function fixture(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rawroute-test-'));
  const put = (name, text) => { const p = path.join(home, name); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
  const env = { ...process.env, HOME: home, USERPROFILE: home, PATH: process.env.PATH, LANG: 'C.UTF-8', RAWROUTE_API_KEY: 'synthetic-default-key', RAWROUTE_BASE_URL: 'https://default.example.test/v1', RAWROUTE_LOCAL_API_KEY: 'synthetic-local-key', RAWROUTE_LOCAL_BASE_URL: 'http://local.example.test:8080/v1', XDG_CONFIG_HOME: path.join(home, '.config'), XDG_CACHE_HOME: path.join(home, '.cache'), XDG_STATE_HOME: path.join(home, '.local/state'), XDG_DATA_HOME: path.join(home, '.local/share') };
  try { fn({ home, put, env, source: repository, chezmoi }); }
  finally { fs.rmSync(home, { recursive: true, force: true }); }
}

function fakeRunner(home, apply) {
  return (_command, args) => {
    const i = args.indexOf('source-path');
    if (i !== -1) {
      const target = args[i + 1];
      const name = target.endsWith('.toml') ? 'dot_codex/modify_config.toml' : target.endsWith('models.json') ? 'dot_pi/agent/modify_models.json' : 'dot_config/opencode/modify_opencode.json';
      return { status: 0, stdout: path.join(repository, name) };
    }
    if (args.includes('apply')) return apply();
    throw new Error('Unexpected invocation');
  };
}

test('mode and CLI options are explicit', () => {
  assert.deepEqual(options(['local', '--dry-run', '--source', '/repo']), { mode: 'local', dryRun: true, source: '/repo' });
  for (const args of [[], ['other'], ['local', '--rawroute'], ['local', '--force'], ['local', '--source']]) assert.throws(() => options(args));
});

test('dry-run validates ownership but writes no configs, marker or lock', () => fixture(args => {
  const result = configure({ ...args, mode: 'local', dryRun: true, execute: fakeRunner(args.home, () => assert.fail('must not apply')) });
  assert.equal(result.dryRun, true);
  assert.deepEqual(fs.readdirSync(args.home), []);
}));

test('partial apply failure restores configs and marker byte-for-byte', () => fixture(({ put, ...args }) => {
  put('.codex/config.toml', 'unrelated = "preserve"\n');
  put('.config/opencode/opencode.json', '{"original":true}\n');
  put('.pi/agent/models.json', '{"original":true}\n');
  put('.pi/agent/extensions/rawroute.js', 'original extension\n');
  put('.config/rawroute/local-enabled', 'original-marker\n');
  put('.config/rawroute/rawroute-local-enabled', 'legacy-marker\n');
  const execute = fakeRunner(args.home, () => {
    put('.codex/config.toml', 'partial = true\n');
    put('.config/opencode/opencode.json', '{}\n');
    put('.pi/agent/models.json', '{}\n');
    put('.pi/agent/extensions/rawroute.js', 'partial extension\n');
    return { status: 1, stderr: 'sensitive output must not escape' };
  });
  assert.throws(() => configure({ ...args, mode: 'default', execute }), error => {
    assert.match(error.message, /previous configs and marker restored/);
    assert.ok(!error.message.includes('sensitive output must not escape'));
    return true;
  });
  assert.equal(fs.readFileSync(path.join(args.home, '.codex/config.toml'), 'utf8'), 'unrelated = "preserve"\n');
  assert.equal(fs.readFileSync(path.join(args.home, '.config/opencode/opencode.json'), 'utf8'), '{"original":true}\n');
  assert.equal(fs.readFileSync(path.join(args.home, '.pi/agent/models.json'), 'utf8'), '{"original":true}\n');
  assert.equal(fs.readFileSync(path.join(args.home, '.pi/agent/extensions/rawroute.js'), 'utf8'), 'original extension\n');
  assert.equal(fs.readFileSync(path.join(args.home, '.config/rawroute/local-enabled'), 'utf8'), 'original-marker\n');
  assert.equal(fs.readFileSync(path.join(args.home, '.config/rawroute/rawroute-local-enabled'), 'utf8'), 'legacy-marker\n');
  assert.equal(fs.existsSync(path.join(args.home, '.config/rawroute/.switch.lock')), false);
}));

test('failed first opt-in removes newly created files and restores default marker state', () => fixture(({ put, ...args }) => {
  const execute = fakeRunner(args.home, () => { put('.codex/config.toml', 'partial = true\n'); return { status: 1 }; });
  assert.throws(() => configure({ ...args, mode: 'local', execute }), /restored/);
  for (const name of ['.codex/config.toml', '.config/opencode/opencode.json', '.pi/agent/models.json', '.pi/agent/extensions/rawroute.js', '.config/rawroute/local-enabled']) assert.equal(fs.existsSync(path.join(args.home, name)), false);
}));

test('symlink targets and concurrent switches are refused', () => fixture(({ put, ...args }) => {
  put('original', 'safe'); fs.mkdirSync(path.join(args.home, '.codex'));
  if (process.platform === 'win32') {
    fs.mkdirSync(path.join(args.home, 'linked-directory'));
    fs.symlinkSync(path.join(args.home, 'linked-directory'), path.join(args.home, '.codex/config.toml'), 'junction');
  } else fs.symlinkSync(path.join(args.home, 'original'), path.join(args.home, '.codex/config.toml'));
  assert.throws(() => configure({ ...args, mode: 'local' }), /symlink/);
  fs.unlinkSync(path.join(args.home, '.codex/config.toml'));
  put('.config/rawroute/.switch.lock', 'another invocation');
  assert.throws(() => configure({ ...args, mode: 'local', execute: fakeRunner(args.home, () => assert.fail()) }), /Another Rawroute switch/);
  assert.equal(fs.readFileSync(path.join(args.home, 'original'), 'utf8'), 'safe');
}));

test('real chezmoi renders both modes, survives reapply and preserves local Codex/OpenCode choices', { skip: !chezmoi && 'Set CHEZMOI_TEST_BINARY to a real chezmoi executable.' }, () => fixture(({ put, ...args }) => {
  put('.codex/config.toml', 'custom_setting = "keep-me"\n[projects."/example"]\ntrust_level = "trusted"\n');
  put('.config/opencode/opencode.json', JSON.stringify({ model: 'custom/main', agents: { general: { model: 'custom/general#high' } } }));
  put('.pi/agent/models.json', JSON.stringify({ providers: { other: { baseUrl: 'https://example.test' } }, custom: true }));
  put('.pi/agent/extensions/rawroute.js', 'old extension');
  put('.config/rawroute/rawroute-local-enabled', '1\n');
  put('.config/unrelated-file', 'must stay untouched\n');
  let expectedModel = 'gpt-6-luna';
  const readConfigs = mode => {
    const json = JSON.parse(fs.readFileSync(path.join(args.home, '.config/opencode/opencode.json'), 'utf8'));
    assert.ok(!Object.hasOwn(json.provider ?? {}, 'openai'));
    assert.equal(json.model, 'custom/main');
    assert.equal(json.agents.general.model, 'custom/general#high');
    const toml = fs.readFileSync(path.join(args.home, '.codex/config.toml'), 'utf8');
    assert.match(toml, new RegExp(`^model = ['"]${expectedModel}['"]$`, 'm'));
    assert.match(toml, new RegExp(`^model_reasoning_effort = ['"]${expectedEffort}['"]$`, 'm'));
    const { urlEnv, envKey } = modes[mode];
    const piFile = fs.readFileSync(path.join(args.home, '.pi/agent/models.json'), 'utf8');
    const piData = JSON.parse(piFile);
    const pi = piData.providers.rawroute;
    assert.equal(piData.custom, true);
    assert.equal(piData.providers.other.baseUrl, 'https://example.test');
    assert.equal(fs.existsSync(path.join(args.home, '.pi/agent/extensions/rawroute.js')), false);
    assert.equal(pi.baseUrl, args.env[urlEnv]);
    assert.equal(pi.apiKey, `\${${envKey}}`);
    assert.equal(pi.api, 'openai-completions');
    assert.deepEqual(pi.models.map(model => model.id).sort(), Object.keys(catalog).sort());
    assert.deepEqual(Object.keys(json.providers.rawroute.models).sort(), Object.keys(catalog).sort());
    for (const model of pi.models) {
      const source = catalog[model.id];
      const openCode = json.providers.rawroute.models[model.id];
      assert.equal(model.name, source.name);
      assert.equal(model.contextWindow, source.context);
      assert.equal(model.maxTokens, source.maxOutput);
      assert.equal(model.reasoning, source.reasoning);
      assert.deepEqual(model.input, source.input.filter(type => type === 'text' || type === 'image'));
      assert.equal(openCode.name, source.name);
      assert.deepEqual(openCode.limit, { context: source.context, output: source.maxOutput });
      assert.deepEqual(openCode.capabilities, { input: source.input, output: source.output, tools: source.tools, temperature: source.temperature, reasoning: { supported: source.reasoning } });
    }
    const reference = `{env:${urlEnv}}`;
    assert.ok(toml.includes(args.env[urlEnv]));
    assert.ok(!toml.includes(reference));
    assert.ok(toml.includes(envKey));
    assert.equal(json.providers.rawroute.settings.baseURL, reference);
    assert.deepEqual(json.providers.rawroute.env, [envKey]);
    assert.ok(toml.includes('keep-me')); assert.ok(toml.includes('trusted'));
    for (const { envKey } of Object.values(modes)) {
      assert.ok(!toml.includes(args.env[envKey]));
      assert.ok(!JSON.stringify(json).includes(args.env[envKey]));
      assert.ok(!piFile.includes(args.env[envKey]));
    }
    return [toml, JSON.stringify(json)];
  };
  let expectedEffort = 'xhigh';
  configure({ ...args, mode: 'default', env: { ...args.env, RAWROUTE_LOCAL_API_KEY: '' } });
  readConfigs('default');
  assert.equal(fs.existsSync(path.join(args.home, '.config/rawroute/rawroute-local-enabled')), false);
  const codexFile = path.join(args.home, '.codex/config.toml');
  put('.codex/config.toml', fs.readFileSync(codexFile, 'utf8')
    .replace(/^model = .*$/m, 'model = "gpt-6-astra"')
    .replace(/^model_reasoning_effort = .*$/m, 'model_reasoning_effort = "low"'));
  expectedModel = 'gpt-6-astra';
  expectedEffort = 'low';
  configure({ ...args, mode: 'local' });
  const local = readConfigs('local');
  const r = spawnSync(chezmoi, ['--source', repository, '--destination', args.home, '--no-tty', 'apply', '--force'], { env: args.env, encoding: 'utf8', timeout: 60_000 });
  assert.equal(r.status, 0, 'isolated full chezmoi apply failed (output withheld)');
  assert.equal(readConfigs('local')[0], local[0]);
  const installed = path.join(args.home, '.config/rawroute/setup.mjs');
  const preview = spawnSync(process.execPath, [installed, 'local', '--dry-run'], { env: args.env, encoding: 'utf8', timeout: 60_000 });
  assert.equal(preview.status, 0, 'installed task should discover its stamped source automatically');
  assert.ok(preview.stdout.includes('Dry run; no changes'));
  assert.equal(readConfigs('local')[0], local[0]);
  configure({ ...args, mode: 'local' });
  assert.equal(readConfigs('local')[0], local[0]);
  const reset = spawnSync(process.execPath, [installed, 'default'], { env: args.env, encoding: 'utf8', timeout: 60_000 });
  assert.equal(reset.status, 0, 'installed opt-out task failed (sensitive output withheld)');
  readConfigs('default');
  assert.equal(fs.existsSync(path.join(args.home, '.config/rawroute/local-enabled')), false);
  assert.equal(fs.readFileSync(path.join(args.home, '.config/unrelated-file'), 'utf8'), 'must stay untouched\n');
  const backups = path.join(args.home, '.local/state/rawroute-backups');
  for (const entry of fs.readdirSync(backups)) {
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(path.join(backups, entry)).mode & 0o777, 0o700);
      assert.equal(fs.statSync(path.join(backups, entry, 'manifest.json')).mode & 0o777, 0o600);
    }
  }
}));

test('full apply and switches write references without any Rawroute env', { skip: !chezmoi && 'Set CHEZMOI_TEST_BINARY to a real chezmoi executable.' }, () => fixture(args => {
  const env = { ...args.env };
  for (const mode of Object.values(modes)) {
    delete env[mode.urlEnv];
    delete env[mode.envKey];
  }
  const apply = urlEnv => {
    const result = spawnSync(chezmoi, ['--source', repository, '--destination', args.home,
      '--no-tty', 'apply', '--force'], { env, encoding: 'utf8', timeout: 60_000 });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, new RegExp(`warning: ${urlEnv} is empty or unset`));
  };
  const read = name => fs.readFileSync(path.join(args.home, name), 'utf8');
  const check = ({ urlEnv, envKey }) => {
    const reference = `{env:${urlEnv}}`;
    const codex = read('.codex/config.toml');
    assert.ok(codex.includes(reference));
    assert.ok(codex.includes(envKey));
    const provider = JSON.parse(read('.config/opencode/opencode.json')).providers.rawroute;
    assert.equal(provider.settings.baseURL, reference);
    assert.deepEqual(provider.env, [envKey]);
    const pi = JSON.parse(read('.pi/agent/models.json')).providers.rawroute;
    assert.equal(pi.baseUrl, reference);
    assert.equal(pi.apiKey, `\${${envKey}}`);
  };

  apply(modes.default.urlEnv);
  check(modes.default);
  const installed = path.join(args.home, '.config/rawroute/setup.mjs');
  const local = spawnSync(process.execPath, [installed, 'local'], { env, encoding: 'utf8' });
  assert.equal(local.status, 0, local.stderr);
  assert.match(local.stderr, /Warning: RAWROUTE_LOCAL_BASE_URL is empty or unset/);
  check(modes.local);
  apply(modes.local.urlEnv);
  check(modes.local);
  configure({ ...args, env, mode: 'default' });
  check(modes.default);
}));
