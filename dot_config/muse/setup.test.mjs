import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { setup } from './setup.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'muse-setup-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, home: path.join(root, 'home'), installDir: path.join(root, 'home', '.local', 'bin') };
}

function mockExecute(platform, installDir, { launcherExists = true } = {}) {
  const calls = [];
  const execute = (command, args, options = {}) => {
    calls.push({ command, args, options });
    if (command === 'curl') return { status: 0 };
    if (command === 'bash' || command === 'powershell.exe') {
      if (launcherExists) {
        fs.mkdirSync(installDir, { recursive: true });
        fs.writeFileSync(path.join(installDir, platform === 'windows' ? 'muse.cmd' : 'muse'), '@echo off\n');
      }
      return { status: 0 };
    }
    if (command === 'bwrap') return { status: 0 };
    if (platform === 'windows' && command === 'cmd.exe') return { status: 0, stdout: 'Muse Code 1.4.15\n' };
    if (platform !== 'windows' && command === path.join(installDir, 'muse')) return { status: 0, stdout: 'Muse Code 1.4.15\n' };
    throw new Error(`unexpected command: ${command}`);
  };
  return { calls, execute };
}

test('Linux installs through the official installer without editing shell profiles', async t => {
  const f = fixture(t);
  const { calls, execute } = mockExecute('linux', f.installDir);
  const messages = [];
  setup({ env: { HOME: f.home }, platform: 'linux', execute, log: m => messages.push(m), warn: () => {} });
  const installer = calls.find(call => call.command === 'bash');
  assert.equal(installer.args[0].endsWith('install.sh'), true);
  assert.equal(installer.options.env.MUSE_NO_MODIFY_PATH, '1');
  assert.equal(installer.options.env.MUSE_INSTALL_DIR, f.installDir);
  assert.ok(calls.some(call => call.command === path.join(f.installDir, 'muse') && call.args[0] === '--version'));
  assert.match(messages[0], /Muse Code is installed/);
});

test('Windows runs the PowerShell installer and verifies muse.cmd', async t => {
  const f = fixture(t);
  const { calls, execute } = mockExecute('windows', f.installDir);
  setup({ env: { USERPROFILE: f.home }, platform: 'windows', execute, log: () => {}, warn: () => {} });
  const installer = calls.find(call => call.command === 'powershell.exe');
  assert.equal(installer.args.includes('-File'), true);
  assert.equal(installer.options.env.MUSE_NO_MODIFY_PATH, '1');
  assert.equal(installer.options.env.MUSE_INSTALL_DIR, f.installDir);
  assert.ok(calls.some(call => call.command === 'cmd.exe'));
});

test('Android/Termux is rejected before downloading', async t => {
  const f = fixture(t);
  let calls = 0;
  assert.throws(() => setup({
    env: { HOME: f.home, TERMUX_VERSION: 'test' }, platform: 'linux',
    execute: () => { calls++; }, log: () => {}, warn: () => {},
  }), /not supported on Android\/Termux/);
  assert.equal(calls, 0);
});

test('missing launcher after install fails', async t => {
  const f = fixture(t);
  const { execute } = mockExecute('linux', f.installDir, { launcherExists: false });
  assert.throws(() => setup({ env: { HOME: f.home }, platform: 'linux', execute, log: () => {}, warn: () => {} }), /did not create/);
});

test('missing bwrap warns but does not fail', async t => {
  const f = fixture(t);
  const { execute } = mockExecute('linux', f.installDir);
  const warnings = [];
  setup({
    env: { HOME: f.home }, platform: 'linux',
    execute: (command, args, options) => command === 'bwrap' ? { status: 1 } : execute(command, args, options),
    log: () => {}, warn: m => warnings.push(m),
  });
  assert.match(warnings.join('\n'), /bwrap/);
});
