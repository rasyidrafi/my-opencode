import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { configure, modes, options } from './setup.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const located = spawnSync('mise', ['which', 'chezmoi'], { encoding: 'utf8' });
const chezmoi = process.env.CHEZMOI_TEST_BINARY || (located.status === 0 ? located.stdout.trim() : null);

function fixture(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rawroute-test-'));
  const put = (name, text) => { const p = path.join(home, name); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
  const env = { HOME: home, PATH: process.env.PATH, LANG: 'C.UTF-8', CCS_LOCAL_API_KEY: 'synthetic-test-value', XDG_CONFIG_HOME: path.join(home, '.config'), XDG_CACHE_HOME: path.join(home, '.cache'), XDG_STATE_HOME: path.join(home, '.local/state'), XDG_DATA_HOME: path.join(home, '.local/share') };
  try { fn({ home, put, env, source: repository, chezmoi }); }
  finally { fs.rmSync(home, { recursive: true, force: true }); }
}

function fakeRunner(home, apply) {
  return (_command, args) => {
    const i = args.indexOf('source-path');
    if (i !== -1) {
      const target = args[i + 1];
      const name = target.endsWith('.toml') ? 'dot_codex/modify_config.toml' : 'dot_config/opencode/opencode.json.tmpl';
      return { status: 0, stdout: path.join(repository, name) };
    }
    if (args.includes('apply')) return apply();
    if (args.includes('execute-template')) return { status: 0, stdout: JSON.stringify(modes.local) };
    throw new Error('Unexpected invocation');
  };
}

test('mode and CLI options are explicit', () => {
  assert.deepEqual(options(['local', '--dry-run', '--source', '/repo']), { mode: 'local', dryRun: true, source: '/repo' });
  for (const args of [[], ['other'], ['local', '--force'], ['local', '--source']]) assert.throws(() => options(args));
});

test('missing local credential fails without creating a marker', () => fixture(({ home, ...args }) => {
  assert.throws(() => configure({ ...args, home, mode: 'local', env: {} }), /CCS_LOCAL_API_KEY is missing/);
  assert.equal(fs.existsSync(path.join(home, '.config/rawroute/local-enabled')), false);
}));

test('dry-run validates ownership but writes no configs, marker or lock', () => fixture(args => {
  const result = configure({ ...args, mode: 'local', dryRun: true, execute: fakeRunner(args.home, () => assert.fail('must not apply')) });
  assert.equal(result.dryRun, true);
  assert.deepEqual(fs.readdirSync(args.home), []);
}));

test('partial apply failure restores configs and marker byte-for-byte', () => fixture(({ put, ...args }) => {
  put('.codex/config.toml', 'unrelated = "preserve"\n');
  put('.config/opencode/opencode.json', '{"original":true}\n');
  put('.config/rawroute/local-enabled', 'original-marker\n');
  const execute = fakeRunner(args.home, () => {
    put('.codex/config.toml', 'partial = true\n');
    return { status: 1, stderr: 'sensitive output must not escape' };
  });
  assert.throws(() => configure({ ...args, mode: 'default', env: {}, execute }), error => {
    assert.match(error.message, /previous configs and marker restored/);
    assert.ok(!error.message.includes('sensitive output must not escape'));
    return true;
  });
  assert.equal(fs.readFileSync(path.join(args.home, '.codex/config.toml'), 'utf8'), 'unrelated = "preserve"\n');
  assert.equal(fs.readFileSync(path.join(args.home, '.config/opencode/opencode.json'), 'utf8'), '{"original":true}\n');
  assert.equal(fs.readFileSync(path.join(args.home, '.config/rawroute/local-enabled'), 'utf8'), 'original-marker\n');
  assert.equal(fs.existsSync(path.join(args.home, '.config/rawroute/.switch.lock')), false);
}));

test('failed first opt-in removes newly created files and restores default marker state', () => fixture(({ put, ...args }) => {
  const execute = fakeRunner(args.home, () => { put('.codex/config.toml', 'partial = true\n'); return { status: 1 }; });
  assert.throws(() => configure({ ...args, mode: 'local', execute }), /restored/);
  for (const name of ['.codex/config.toml', '.config/opencode/opencode.json', '.config/rawroute/local-enabled']) assert.equal(fs.existsSync(path.join(args.home, name)), false);
}));

test('symlink targets and concurrent switches are refused', () => fixture(({ put, ...args }) => {
  put('original', 'safe'); fs.mkdirSync(path.join(args.home, '.codex')); fs.symlinkSync(path.join(args.home, 'original'), path.join(args.home, '.codex/config.toml'));
  assert.throws(() => configure({ ...args, mode: 'local' }), /symlink/);
  fs.unlinkSync(path.join(args.home, '.codex/config.toml'));
  put('.config/rawroute/.switch.lock', 'another invocation');
  assert.throws(() => configure({ ...args, mode: 'local', execute: fakeRunner(args.home, () => assert.fail()) }), /Another Rawroute switch/);
  assert.equal(fs.readFileSync(path.join(args.home, 'original'), 'utf8'), 'safe');
}));

test('real chezmoi renders both modes, survives reapply and preserves unrelated Codex values', { skip: !chezmoi && 'Set CHEZMOI_TEST_BINARY to a real chezmoi executable.' }, () => fixture(({ put, ...args }) => {
  put('.codex/config.toml', 'custom_setting = "keep-me"\n[projects."/example"]\ntrust_level = "trusted"\n');
  put('.config/unrelated-file', 'must stay untouched\n');
  let expectedModel = 'gpt-6-luna';
  const readConfigs = mode => {
    const json = JSON.parse(fs.readFileSync(path.join(args.home, '.config/opencode/opencode.json'), 'utf8'));
    assert.equal(json.provider.openai.options.baseURL, modes[mode].baseURL);
    assert.equal(json.provider.openai.options.apiKey, `{env:${modes[mode].envKey}}`);
    const toml = fs.readFileSync(path.join(args.home, '.codex/config.toml'), 'utf8');
    assert.match(toml, new RegExp(`^model = ['"]${expectedModel}['"]$`, 'm'));
    assert.ok(toml.includes(modes[mode].baseURL)); assert.ok(toml.includes(modes[mode].envKey));
    assert.ok(toml.includes('keep-me')); assert.ok(toml.includes('trusted'));
    assert.ok(!toml.includes('synthetic-test-value')); assert.ok(!JSON.stringify(json).includes('synthetic-test-value'));
    return [toml, JSON.stringify(json)];
  };
  configure({ ...args, mode: 'default', env: { ...args.env, CCS_LOCAL_API_KEY: '' } });
  readConfigs('default');
  const codexFile = path.join(args.home, '.codex/config.toml');
  put('.codex/config.toml', fs.readFileSync(codexFile, 'utf8').replace(/^model = .*$/m, 'model = "gpt-6-astra"'));
  expectedModel = 'gpt-6-astra';
  configure({ ...args, mode: 'local' });
  const local = readConfigs('local');
  const r = spawnSync(chezmoi, ['--source', repository, '--destination', args.home, '--no-tty', 'apply', '--force'], { env: args.env, encoding: 'utf8', timeout: 60_000 });
  assert.equal(r.status, 0, 'isolated full chezmoi apply failed (output withheld)');
  assert.deepEqual(readConfigs('local'), local);
  const installed = path.join(args.home, '.config/rawroute/setup.mjs');
  const preview = spawnSync(process.execPath, [installed, 'local', '--dry-run'], { env: args.env, encoding: 'utf8', timeout: 60_000 });
  assert.equal(preview.status, 0, 'installed task should discover its stamped source automatically');
  assert.ok(preview.stdout.includes('Dry run; no changes'));
  assert.deepEqual(readConfigs('local'), local);
  configure({ ...args, mode: 'local' });
  assert.deepEqual(readConfigs('local'), local);
  const reset = spawnSync(process.execPath, [installed, 'default'], { env: args.env, encoding: 'utf8', timeout: 60_000 });
  assert.equal(reset.status, 0, 'installed opt-out task failed (sensitive output withheld)');
  readConfigs('default');
  assert.equal(fs.existsSync(path.join(args.home, '.config/rawroute/local-enabled')), false);
  assert.equal(fs.readFileSync(path.join(args.home, '.config/unrelated-file'), 'utf8'), 'must stay untouched\n');
  const backups = path.join(args.home, '.local/state/rawroute-backups');
  for (const entry of fs.readdirSync(backups)) {
    assert.equal(fs.statSync(path.join(backups, entry)).mode & 0o777, 0o700);
    assert.equal(fs.statSync(path.join(backups, entry, 'manifest.json')).mode & 0o777, 0o600);
  }
}));
