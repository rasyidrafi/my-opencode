import assert from 'node:assert/strict';
import { test } from 'node:test';
import { settings, unit, activateAssets } from './setup.mjs';

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

function activationFixture({ assets = [], pending = null, active = true, failRestart = false } = {}) {
  const installed = new Map(assets);
  const events = [];
  const io = {
    matches(target, content) { return installed.get(target) === content; },
    readPending() { return pending; },
    writePending(revision) { events.push('pending'); pending = revision; },
    install(target, content) { events.push(`install:${target}`); installed.set(target, content); },
    daemonReload() { events.push('daemon-reload'); },
    enable() { events.push('enable'); },
    restart() { events.push('restart'); if (failRestart) throw new Error('simulated restart failure'); },
    start() { events.push('start'); active = true; },
    isActive() { events.push('is-active'); return active; },
    clearPending() { events.push('clear-pending'); pending = null; },
  };
  return { io, installed, events, pending: () => pending, setFailRestart(value) { failRestart = value; } };
}

test('failed activation remains pending and an unchanged retry reloads, restarts, verifies, then clears it', () => {
  const desired = [['/etc/service.conf', 'new config'], ['/usr/local/bin/forward.py', 'new code']];
  const fixture = activationFixture({ assets: [['/etc/service.conf', 'old config']] , failRestart: true });
  assert.throws(() => activateAssets(desired, fixture.io), /simulated restart failure/);
  assert.notEqual(fixture.pending(), null);
  const firstInstall = fixture.events.findIndex(event => event.startsWith('install:'));
  assert.ok(fixture.events.indexOf('pending') >= 0 && fixture.events.indexOf('pending') < firstInstall);
  assert.ok(!fixture.events.includes('clear-pending'));

  fixture.setFailRestart(false);
  fixture.events.length = 0;
  const result = activateAssets(desired, fixture.io);
  assert.deepEqual(result.changed, []);
  assert.equal(result.restarted, true);
  assert.deepEqual(fixture.events, ['daemon-reload', 'enable', 'restart', 'is-active', 'clear-pending']);
  assert.equal(fixture.pending(), null);
});

test('unchanged healthy assets are enabled and checked without a restart', () => {
  const desired = [['/etc/service.conf', 'same']];
  const fixture = activationFixture({ assets: desired, active: true });
  assert.deepEqual(activateAssets(desired, fixture.io), { changed: [], restarted: false });
  assert.deepEqual(fixture.events, ['enable', 'is-active']);
});

test('unchanged inactive service is started, not restarted', () => {
  const desired = [['/etc/service.conf', 'same']];
  const fixture = activationFixture({ assets: desired, active: false });
  assert.deepEqual(activateAssets(desired, fixture.io), { changed: [], restarted: false });
  assert.deepEqual(fixture.events, ['enable', 'is-active', 'start', 'is-active']);
});
