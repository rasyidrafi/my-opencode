import assert from 'node:assert/strict';
import { test } from 'node:test';
import { restart } from './restart-openchamber.mjs';

test('schedules an independent user-service restart', () => {
  const calls = [];
  restart({ platform: 'linux', env: {}, execute: (...args) => { calls.push(args); return { status: 0 }; } });
  assert.deepEqual(calls, [[ 'systemd-run', [
    '--user', '--on-active=5s', 'systemctl', '--user', 'restart', 'openchamber.service',
  ], { stdio: 'inherit' } ]]);
});

test('reports scheduling errors and rejects unsupported platforms', () => {
  assert.throws(() => restart({ platform: 'linux', env: {}, execute: () => ({ status: 1 }) }), /Could not schedule/);
  assert.throws(() => restart({ platform: 'linux', env: {}, execute: () => ({ error: new Error('missing') }) }), /Could not schedule/);
  assert.throws(() => restart({ platform: 'win32', env: {}, execute: () => { throw new Error('must not run'); } }), /not supported/);
});
