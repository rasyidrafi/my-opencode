import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requireSystemPython } from '../dot_config/my-opencode/prerequisites.mjs';
import { manage } from '../dot_config/cloudflared/service.mjs';
import { main } from '../dot_config/tools-cleanup/setup.mjs';

for (const code of ['ENOENT', 'EACCES', 'ETIMEDOUT', 'BROKEN']) {
  test('Python prerequisite explains installation when interpreter fails: ' + code, () => {
    assert.throws(() => requireSystemPython('docker:forward:setup', () => { throw Object.assign(new Error('failure'), { code }); }), /docker:forward:setup requires.*\/usr\/bin\/python3.*sudo apt install python3/);
  });
}
test('Python prerequisite probes the system interpreter without elevation', () => {
  requireSystemPython('task', (command, args, options) => {
    assert.equal(command, '/usr/bin/python3');
    assert.deepEqual(args, ['--version']);
    assert.equal(options.timeout, 10_000);
  });
});
for (const operation of ['setup', 'restart']) {
  test('cloudflared:' + operation + ' stops before mise/sudo when Python is missing', () => {
    const calls = [];
    assert.throws(() => manage(operation, { platform: 'linux', args: [], run: command => {
      calls.push(command);
      return { error: Object.assign(new Error('missing'), { code: 'ENOENT' }), status: null };
    } }), /requires a working system Python 3/);
    assert.deepEqual(calls, ['/usr/bin/python3']);
  });
}
test('Linux cleanup stops before inspection or uninstall when Python is missing', () => {
  const calls = [];
  assert.throws(() => main({ platform: 'linux', args: ['--apply'], execute: command => {
    calls.push(command);
    throw Object.assign(new Error('missing'), { code: 'ENOENT' });
  } }), /tools:cleanup requires a working system Python 3/);
  assert.deepEqual(calls, ['/usr/bin/python3']);
});
