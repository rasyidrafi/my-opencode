import assert from 'node:assert/strict';
import { test } from 'node:test';
import { settings, unit } from './setup.mjs';

test('uses saved guest context without machine-specific defaults', () => {
  assert.deepEqual(settings({ role: 'guest', context: 'other-host', 'ssh-alias': 'other-docker' }), {
    context: 'other-host', ssh_alias: 'other-docker', interval: 10,
  });
  assert.throws(() => settings({ role: 'host' }), /guest/);
  assert.throws(() => settings({ role: 'guest', context: '--host', 'ssh-alias': 'ok' }), /context/);
  assert.throws(() => settings({ role: 'guest', context: 'ok', 'ssh-alias': 'bad\nHost *' }), /ssh-alias/);
});

test('service runs as guest user and adopts existing service assets', () => {
  const value = unit('alice', 'staff', '/home/alice');
  assert.match(value, /User=alice\nGroup=staff/);
  assert.match(value, /Environment="HOME=\/home\/alice"/);
  assert.match(value, /workbox-docker-forward.py --config \/etc\/workbox-docker-forward.json/);
  assert.match(value, /Restart=always/);
  assert.match(value, /WantedBy=multi-user.target/);
  assert.throws(() => unit('alice\nUser=root', 'staff', '/home/alice'));
  assert.throws(() => unit('alice', 'staff', '/home/%u'));
});
