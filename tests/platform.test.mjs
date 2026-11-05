import assert from 'node:assert/strict';
import { test } from 'node:test';
import { currentPlatform, requireTaskPlatform } from '../dot_config/my-opencode/platform.mjs';
import { setup } from '../dot_config/services/setup.mjs';

test('normalizes platform and detects Termux reported as Linux', () => {
  assert.equal(currentPlatform('win32', {}), 'windows');
  assert.equal(currentPlatform('android', {}), 'android');
  assert.equal(currentPlatform('linux', { TERMUX_VERSION: '0.118.3' }), 'android');
  assert.equal(currentPlatform('linux', { PREFIX: '/data/data/com.termux/files/usr' }), 'android');
  assert.equal(currentPlatform('linux', {}), 'linux');
  assert.throws(() => requireTaskPlatform('docker:setup', ['linux'], 'linux', { TERMUX_VERSION: 'test' }), /Android\/Termux/);
});
for (const app of ['codex', 'openchamber']) {
  test(app + ' setup rejects Android before invoking the CLI', () => {
    let calls = 0;
    assert.throws(() => setup(app, { platform: 'android', execute: () => { calls++; } }), /Android\/Termux/);
    assert.equal(calls, 0);
  });
}

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
const catalog = JSON.parse(fs.readFileSync(new URL('../.chezmoidata/mise.json', import.meta.url))).mise;
for (const task of catalog.tasks.filter(task => !task.platforms.includes('android'))) {
  for (const termuxEnv of [
    { TERMUX_VERSION: 'test', PREFIX: '' },
    { TERMUX_VERSION: '', PREFIX: '/data/data/com.termux/files/usr' },
    { TERMUX_VERSION: 'test', PREFIX: '/data/data/com.termux/files/usr' },
  ]) {
    test(task.name + ' rejects a Linux-reported Termux environment ' + JSON.stringify(termuxEnv) + ' before processing arguments', () => {
      const script = new URL('../dot_config/' + task.script, import.meta.url);
      const args = task.args.trim().split(/\s+/).filter(Boolean);
      const runner = task.runner === 'sh' ? 'sh' : process.execPath;
      const result = spawnSync(runner, [script.pathname, ...args], {
        env: { ...process.env, ...termuxEnv },
        encoding: 'utf8',
      });
      assert.equal(result.status, 1, result.stderr);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /not supported on Android\/Termux/);
    });
  }
}
