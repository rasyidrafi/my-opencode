import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { setup } from '../dot_config/t3code/setup.mjs';

test('configures and restarts the existing user service without pairing', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 't3-setup-test-'));
  try {
    const unit = path.join(home, '.config/systemd/user/t3code.service');
    fs.mkdirSync(path.dirname(unit), { recursive: true });
    fs.writeFileSync(unit, '[Service]\n');
    const calls = [];
    setup({ env: { HOME: home }, execute: (command, args) => { calls.push([command, ...args]); return { status: 0 }; } });
    assert.deepEqual(calls, [['systemctl', '--user', 'daemon-reload'], ['systemctl', '--user', 'restart', 't3code.service']]);
    assert.match(fs.readFileSync(`${unit}.d/my-opencode.conf`, 'utf8'), /ExecStart=\/bin\/sh %h\/\.config\/t3code\/service\.sh/);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('requires existing service and refuses other platforms', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 't3-setup-test-'));
  try {
    assert.throws(() => setup({ env: { HOME: home } }), /not installed/);
    assert.throws(() => setup({ platform: 'win32', env: { HOME: home } }), /linux/i);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('service wrapper loads current secrets and runs mise-managed T3', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 't3-service-test-'));
  try {
    fs.mkdirSync(path.join(home, '.config/secrets'), { recursive: true });
    fs.mkdirSync(path.join(home, '.local/bin'), { recursive: true });
    fs.writeFileSync(path.join(home, '.config/secrets/load.sh'), "export TEST_SECRET='rotated value'\n");
    fs.writeFileSync(path.join(home, '.local/bin/mise'), '#!/bin/sh\n[ "$TEST_SECRET" = "rotated value" ] && [ "$*" = "exec -- t3 __service-launcher" ]\n', { mode: 0o755 });
    const result = spawnSync('sh', [new URL('../dot_config/t3code/service.sh', import.meta.url).pathname], { env: { HOME: home, PATH: '/usr/bin:/bin' } });
    assert.equal(result.status, 0, result.stderr.toString());
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
