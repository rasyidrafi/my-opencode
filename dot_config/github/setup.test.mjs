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
  fs.writeFileSync(path.join(data, 'shims/gh'), '#!/bin/sh\nprintf stable-helper', { mode: 0o755 });
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
  const result = spawnSync('sh', ['-c', helper.slice(1) + ' get'], { env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'stable-helper');
  git(['config', '--global', '--replace-all', 'credential.https://gist.github.com.helper', 'custom']);
  assert.throws(() => configure({ home, env }), /Custom/);
  fs.unlinkSync(path.join(data, 'shims/gh'));
  assert.throws(() => configure({ home, env }), /shim missing/);
});
