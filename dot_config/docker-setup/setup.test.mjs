import assert from 'node:assert/strict';
import { test } from 'node:test';
import { options, validateRole, guestSettings, sshFragment, restrictedKey, run } from './setup.mjs';

const guest = { role: 'guest', context: 'soy', 'ssh-alias': 'soy-docker', host: '172.16.0.4', user: 'soy', identity: '/home/test/.ssh/docker-key', 'known-hosts': '/home/test/.ssh/docker-known-hosts' };

test('explicit roles prevent accidental engine installation in containers', () => {
  validateRole('host', '');
  validateRole('guest', 'systemd-nspawn');
  for (const virt of ['systemd-nspawn', 'docker', 'lxc']) assert.throws(() => validateRole('host', virt), /Refusing/);
  assert.throws(() => validateRole('guest', ''), /systemd-nspawn/);
  assert.throws(() => validateRole(undefined, ''), /Specify/);
});

test('CLI rejects unknown, incomplete and positional options', () => {
  assert.deepEqual(options(['--role', 'guest', '--dry-run', '--migrate-mise']), { role: 'guest', 'dry-run': true, 'migrate-mise': true });
  for (const args of [['--role'], ['--role', '--dry-run'], ['--force'], ['host']]) assert.throws(() => options(args));
});

test('endpoint validation prevents SSH configuration injection', () => {
  assert.equal(guestSettings(guest).port, '22');
  for (const [field, value] of [['host', 'host\nProxyCommand bad'], ['user', '-root'], ['ssh-alias', '*'], ['port', '65536'], ['port', '0'], ['identity', '~/.ssh/key'], ['identity', '/home/%h/key'], ['known-hosts', '/home/test/"x']]) {
    assert.throws(() => guestSettings({ ...guest, [field]: value }));
  }
});

test('saved settings exclude one-shot flags', () => {
  const result = guestSettings({ ...guest, 'dry-run': true, 'migrate-mise': true });
  assert.equal(result['dry-run'], undefined);
  assert.equal(result['migrate-mise'], undefined);
});

test('SSH fragment keeps pinned trust and dedicated identity, never relaxes trust', () => {
  const text = sshFragment(guestSettings(guest));
  for (const setting of ['Host soy-docker', 'HostName 172.16.0.4', 'User soy', 'StrictHostKeyChecking yes', 'IdentitiesOnly yes', 'BatchMode yes', 'ForwardAgent no']) assert.ok(text.includes(setting));
  assert.ok(!text.includes('StrictHostKeyChecking no'));
});

test('host authorization grants only the restricted Docker transport', () => {
  assert.equal(restrictedKey('ssh-ed25519 AAAA test'), 'restrict,command="/usr/bin/docker system dial-stdio" ssh-ed25519 AAAA docker-context\n');
  for (const key of ['restrict ssh-ed25519 AAAA', 'ssh-rsa AAAA', 'ssh-ed25519 AAAA\nssh-ed25519 BBBB', 'ssh-ed25519 invalid!']) assert.throws(() => restrictedKey(key));
});

test('installer script is delivered on stdin even when output is inherited', () => {
  assert.throws(() => run('/bin/sh', ['-s'], { input: 'exit 17\n' }), /failed \(17\)/);
  assert.equal(run('/bin/sh', ['-s'], { input: 'exit 0\n' }).status, 0);
});
