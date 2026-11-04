import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { configure } from './setup.mjs';

test('migrates versioned helpers, preserves unrelated configuration, and is idempotent', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'github-setup-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const data = path.join(home, "mise data's");
  fs.mkdirSync(path.join(data, 'shims'), { recursive: true });
  fs.writeFileSync(path.join(data, 'shims/gh'), '#!/bin/sh\nprintf "username=test-user\\npassword=test-password\\n"', { mode: 0o755 });
  const env = { ...process.env, HOME: home, MISE_DATA_DIR: data, GIT_CONFIG_GLOBAL: path.join(home, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1' };
  const git = args => {
    const result = spawnSync('git', args, { env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  git(['config', '--global', 'credential.https://other.example.helper', 'custom']);
  for (const host of ['github.com', 'gist.github.com']) {
    git(['config', '--global', '--add', `credential.https://${host}.helper`, '']);
    git(['config', '--global', '--add', `credential.https://${host}.helper`, '!/removed/mise/installs/gh/1/bin/gh auth git-credential']);
  }
  assert.equal(configure({ home, env }).changed, true);
  const before = fs.readFileSync(env.GIT_CONFIG_GLOBAL, 'utf8');
  assert.equal(configure({ home, env }).changed, false);
  assert.equal(fs.readFileSync(env.GIT_CONFIG_GLOBAL, 'utf8'), before);
  assert.equal(git(['config', '--global', 'credential.https://other.example.helper']).trim(), 'custom');
  const helper = git(['config', '--global', '--get-all', 'credential.https://github.com.helper']).trim();
  const result = spawnSync('git', ['-c', 'credential.helper=', '-c', `credential.helper=${helper}`, 'credential', 'fill'], {
    env: { ...env, GIT_TERMINAL_PROMPT: '0' }, input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /username=test-user/);
  assert.match(result.stdout, /password=test-password/);
  git(['config', '--global', '--replace-all', 'credential.https://gist.github.com.helper', 'custom']);
  assert.throws(() => configure({ home, env }), /Custom/);
  fs.unlinkSync(path.join(data, 'shims/gh'));
  assert.throws(() => configure({ home, env }), /shim missing/);
});

test('Windows asks for Git installation before checking shims or changing configuration', () => {
  const calls = [];
  assert.throws(() => configure({ platform: 'win32', execute: (command, args) => {
    calls.push([command, args]);
    return { error: { code: 'ENOENT' }, status: null };
  } }), /Install it from https:\/\/git-scm.com\/download\/win.*reopen your terminal/);
  assert.deepEqual(calls, [['git.exe', ['--version']]]);
});

test('Windows reports a broken Git installation without modifying configuration', () => {
  assert.throws(() => configure({ platform: 'win32', execute: () => ({ status: 1 }) }), /Repair your Git installation/);
});
