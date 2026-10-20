import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { options, validateRole, guestSettings, sshFragment, dockerKey, authorizeDockerKey, run, migrateMise } from './setup.mjs';

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
  for (const setting of ['Host soy-docker', 'HostName 172.16.0.4', 'User soy', 'StrictHostKeyChecking yes', 'IdentitiesOnly yes', 'BatchMode yes', 'ForwardAgent no', 'ClearAllForwardings no']) assert.ok(text.includes(setting));
  assert.ok(!text.includes('StrictHostKeyChecking no'));
});

test('host authorization keeps Docker transport and allows port forwarding by default', () => {
  assert.equal(dockerKey('ssh-ed25519 AAAA test'), 'command="/usr/bin/docker system dial-stdio" ssh-ed25519 AAAA docker-context\n');
  for (const key of ['restrict ssh-ed25519 AAAA', 'ssh-rsa AAAA', 'ssh-ed25519 AAAA\nssh-ed25519 BBBB', 'ssh-ed25519 invalid!']) assert.throws(() => dockerKey(key));
});

test('installer script is delivered on stdin even when output is inherited', () => {
  assert.throws(() => run('/bin/sh', ['-s'], { input: 'exit 17\n' }), /failed \(17\)/);
  assert.equal(run('/bin/sh', ['-s'], { input: 'exit 0\n' }).status, 0);
});

test('native migration archives active mise installs so reshim cannot recreate Docker shims', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'docker-migration-test-'));
  const dataRoot = path.join(root, '.local/share/mise');
  const tool = path.join(dataRoot, 'installs/docker-cli/29/docker');
  const shim = path.join(dataRoot, 'shims/docker');
  try {
    fs.mkdirSync(path.dirname(tool), { recursive: true }); fs.writeFileSync(tool, 'preserved binary');
    fs.mkdirSync(path.dirname(shim), { recursive: true }); fs.symlinkSync(path.join(root, '.local/bin/mise'), shim);
    const env = { root, dataRoot };
    assert.throws(() => migrateMise(false, true, env), /migrate-mise/);
    migrateMise(true, true, env);
    assert.ok(fs.existsSync(tool)); assert.ok(fs.lstatSync(shim).isSymbolicLink());
    migrateMise(true, false, env);
    assert.equal(fs.existsSync(tool), false); assert.equal(fs.lstatSync(shim, { throwIfNoEntry: false }), undefined);
    const backups = path.join(root, '.local/state/docker-setup-backups');
    const backup = path.join(backups, fs.readdirSync(backups)[0]);
    assert.equal(fs.readFileSync(path.join(backup, 'installs/docker-cli/29/docker'), 'utf8'), 'preserved binary');
    migrateMise(false, false, env);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('authorization upgrades legacy managed keys and preserves other entries', () => {
  const key = 'ssh-ed25519 AAAA test';
  const current = dockerKey(key);
  const other = 'ssh-ed25519 BBBB another-key\n';
  assert.equal(authorizeDockerKey(other + 'restrict,' + current, key), other + current);
  assert.equal(authorizeDockerKey(other + current, key), other + current);
  const imported = current.replace('docker-context', 'soy-wb-docker-soy');
  assert.equal(authorizeDockerKey(other + 'restrict,' + imported, key), other + imported);
  assert.equal(authorizeDockerKey(other + imported, key), other + imported);
  assert.equal(authorizeDockerKey(other.trimEnd(), key), other + current);
  assert.throws(() => authorizeDockerKey('no-port-forwarding ssh-ed25519 AAAA custom\n', key), /different authorization/);
});
