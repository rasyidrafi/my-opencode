import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { install, setupDocker, options } from './setup.mjs';
import { migrate, moveStore, checkInventory, systemdFiles, assertBoundMigrationSafe } from './docker-storage.mjs';

test('installation preserves startup files and is idempotent', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'azure-cache-test-'));
  try {
    fs.writeFileSync(path.join(home, '.bashrc'), '# existing');
    fs.writeFileSync(path.join(home, '.bash_profile'), '# login\n');
    install(home);
    const once = fs.readFileSync(path.join(home, '.bashrc'), 'utf8');
    assert.ok(once.startsWith('# existing\n'));
    install(home);
    assert.equal(fs.readFileSync(path.join(home, '.bashrc'), 'utf8'), once);
    assert.match(fs.readFileSync(path.join(home, '.bash_profile'), 'utf8'), /azure-mnt-cache\/cache.sh/);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('missing mount resets stale inherited cache paths', () => {
  const script = fs.readFileSync(new URL('./cache.sh', import.meta.url), 'utf8');
  const result = spawnSync('sh', ['-c', `mountpoint() { return 1; }\n${script}\nprintf '%s\\n' "$XDG_CACHE_HOME" "$UV_CACHE_DIR" "$TMPDIR" "$GOPATH"`], {
    encoding: 'utf8', env: { ...process.env, HOME: '/example', XDG_CACHE_HOME: '/mnt/stale', TMPDIR: '/mnt/stale' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '/example/.cache\n/example/.cache/uv\n/tmp\n/example/go\n');
});

test('mounted writable disk enables caches without touching real /mnt', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'azure-cache-test-'));
  try {
    const script = fs.readFileSync(new URL('./cache.sh', import.meta.url), 'utf8')
      .replace('"/mnt/cache/$(id -un)"', '"$TEST_CACHE_ROOT"');
    const result = spawnSync('sh', ['-c', `mountpoint() { return 0; }\n${script}\nprintf '%s\\n' "$XDG_CACHE_HOME" "$GOMODCACHE" "$TMPDIR"`], {
      encoding: 'utf8', env: { ...process.env, TEST_CACHE_ROOT: root },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `${root}/xdg\n${root}/go-mod\n${root}/tmp\n`);
    assert.equal(fs.statSync(path.join(root, 'tmp')).mode & 0o777, 0o700);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('directory creation failure keeps home defaults', () => {
  const script = fs.readFileSync(new URL('./cache.sh', import.meta.url), 'utf8');
  const result = spawnSync('sh', ['-c', `mountpoint() { return 0; }\nmkdir() { return 1; }\n${script}\nprintf '%s\\n' "$XDG_CACHE_HOME" "$TMPDIR"`], {
    encoding: 'utf8', env: { ...process.env, HOME: '/example' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '/example/.cache\n/tmp\n');
});

test('Fish mounted cache uses the current username', {
  skip: Boolean(spawnSync('fish', ['--version']).error),
}, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'azure-fish-cache-test-'));
  try {
    // Redirect only the disk prefix, keeping the real username substitution.
    const script = fs.readFileSync(new URL('./cache.fish', import.meta.url), 'utf8')
      .replace('/mnt/cache/', `${root}/`);
    const result = spawnSync('fish', ['--no-config', '-c', `
      function mountpoint; return 0; end
      function id; printf '%s' test-user; end
      ${script}
      printf '%s\\n' "$XDG_CACHE_HOME" "$GOMODCACHE" "$TMPDIR"
    `], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout, `${root}/test-user/xdg\n${root}/test-user/go-mod\n${root}/test-user/tmp\n`);
    assert.equal(fs.statSync(path.join(root, 'test-user/tmp')).mode & 0o777, 0o700);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('SSH guests verify the existing daemon without sudo or local migration', () => {
  const calls = [];
  const result = setupDocker('/unused', {
    run: args => { calls.push(args); return args[0] === 'context' ? 'ssh://soy-docker' : 'host-daemon-id'; },
    execute: () => assert.fail('guest must not execute the privileged helper'),
  });
  assert.equal(result.remote, true);
  assert.equal(calls[1][0], 'info');
});

test('local setup invokes a dry-run helper or a locked privileged migration', () => {
  for (const dryRun of [true, false]) {
    setupDocker('/unused', {
      dryRun, run: () => 'unix:///var/run/docker.sock',
      execute: (command, args) => {
        assert.ok([command, ...args].includes(dryRun ? '--dry-run' : '--apply'));
        assert.equal([command, ...args].includes('/usr/bin/flock'), !dryRun);
        return { status: 0 };
      },
    });
  }
  assert.throws(() => setupDocker('/unused', { run: () => 'tcp://other:2375' }), /Only the native/);
  assert.throws(() => options(['--unknown']), /Usage/);
});

function operations({ complete = false, fail } = {}) {
  const calls = [];
  const io = Object.fromEntries(['preflight', 'prepare', 'stop', 'move', 'mount', 'start', 'verify', 'finish', 'verifyMounts', 'ensureCompleteBootGuards'].map(name => [name, () => {
    calls.push(name);
    if (name === fail) throw new Error('simulated ' + name + ' failure');
    if (name === 'preflight') return { complete };
  }]));
  return { calls, io };
}

test('migration stops workloads before moving storage and commits only after verification', async () => {
  const { calls, io } = operations();
  assert.equal((await migrate(io)).complete, true);
  assert.deepEqual(calls, ['preflight', 'prepare', 'stop', 'move', 'mount', 'start', 'verify', 'finish']);
});

test('dry run and a verified repeat only reconcile complete boot guards', async () => {
  const preview = operations();
  await migrate(preview.io, { dryRun: true });
  assert.deepEqual(preview.calls, ['preflight']);
  const repeat = operations({ complete: true });
  await migrate(repeat.io);
  assert.deepEqual(repeat.calls, ['preflight', 'verifyMounts', 'ensureCompleteBootGuards']);
});

test('failed transfer never mounts or restarts incomplete storage; failed verification never commits', async () => {
  for (const fail of ['move', 'verify']) {
    const { calls, io } = operations({ fail });
    await assert.rejects(migrate(io), /not rolled back.*Rerun/);
    assert.ok(!calls.includes('finish'));
    if (fail === 'move') assert.ok(!calls.includes('start') && !calls.includes('mount'));
  }
});

test('inventory verification detects missing volumes, images, containers and stopped workloads', () => {
  const before = { id: 'daemon', containers: ['a', 'b'], running: ['a'], images: ['image'], volumes: ['db'] };
  checkInventory(before, structuredClone(before));
  for (const key of ['containers', 'images', 'volumes', 'running']) {
    assert.throws(() => checkInventory(before, { ...before, [key]: [] }));
  }
  assert.throws(() => checkInventory(before, { ...before, id: 'new-daemon' }));
});

test('boot bind mounts require completed transfer; services additionally require readiness', () => {
  const units = systemdFiles();
  for (const name of ['docker', 'containerd']) {
    const mount = units[`/etc/systemd/system/var-lib-${name}.mount`];
    assert.match(mount, /Requires=mnt.mount/);
    assert.match(mount, /ConditionPathExists=\/mnt\/docker-storage\/\.transfer-complete/);
    assert.ok(mount.includes(`What=/mnt/docker-storage/${name}`));
    const dropin = units[`/etc/systemd/system/${name}.service.d/azure-mnt-storage.conf`];
    assert.ok(dropin.includes(`Requires=var-lib-${name}.mount`));
    assert.match(dropin, /ExecStartPre=\/usr\/bin\/test -f \/mnt\/docker-storage\/\.ready/);
  }
});

test('an already-bound unfinished legacy migration fails closed unless transfer was recorded', () => {
  const docker = { name: 'docker', source: '/var/lib/docker' };
  for (const saved of [
    { status: 'moving' },
    { status: 'moving', phase: 'copying' },
    { status: 'moving', phase: 'transferred' },
  ]) assert.throws(() => assertBoundMigrationSafe(saved, false, docker), /Unexpected bind mount.*unfinished storage transfer/);
  assert.doesNotThrow(() => assertBoundMigrationSafe({ status: 'moving', phase: 'transferred' }, true, docker));
});

test('interrupted transfer cannot bind at mocked boot; retry completes before mount and then stays complete', async () => {
  const mountUnit = systemdFiles()['/etc/systemd/system/var-lib-docker.mount'];
  let transferComplete = false;
  let sourceBound = false;
  let failTransfer = true;
  let complete = false;
  const calls = [];
  const io = {
    preflight() { calls.push('preflight'); return { complete }; },
    prepare() { calls.push('prepare'); },
    stop() { calls.push('stop'); },
    move() {
      calls.push('move');
      if (failTransfer) throw new Error('simulated interrupted rsync');
      transferComplete = true;
    },
    mount() {
      calls.push('mount');
      if (mountUnit.includes('ConditionPathExists=/mnt/docker-storage/.transfer-complete') && !transferComplete) return;
      sourceBound = true;
    },
    start() { calls.push('start'); },
    async verify() { calls.push('verify'); },
    finish() { calls.push('finish'); complete = true; },
    verifyMounts() { calls.push('verifyMounts'); },
  };

  await assert.rejects(migrate(io), /interrupted rsync.*not rolled back/);
  // A boot attempt with the generated ConditionPathExists gate keeps /var/lib visible.
  io.mount();
  assert.equal(sourceBound, false);

  failTransfer = false;
  await migrate(io);
  assert.equal(transferComplete, true);
  assert.equal(sourceBound, true);
  assert.ok(calls.indexOf('move', 3) < calls.lastIndexOf('mount'));

  const beforeRepeat = calls.length;
  await migrate(io);
  assert.deepEqual(calls.slice(beforeRepeat), ['preflight', 'verifyMounts']);
});

test('real transfer preserves content, modes, symlinks and hardlinks with no old files; resume repairs partial copies', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'docker-storage-transfer-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const target = path.join(root, 'target');
  fs.mkdirSync(path.join(source, 'volume'), { recursive: true });
  fs.mkdirSync(path.join(target, 'volume'), { recursive: true });
  fs.writeFileSync(path.join(source, 'volume/db'), 'database-content', { mode: 0o640 });
  fs.linkSync(path.join(source, 'volume/db'), path.join(source, 'hardlink'));
  fs.symlinkSync('volume/db', path.join(source, 'symlink'));
  fs.writeFileSync(path.join(target, 'volume/db'), 'incomplete');
  moveStore({ source, target });
  assert.deepEqual(fs.readdirSync(source), []);
  assert.equal(fs.readFileSync(path.join(target, 'volume/db'), 'utf8'), 'database-content');
  assert.equal(fs.statSync(path.join(target, 'volume/db')).mode & 0o777, 0o640);
  assert.equal(fs.statSync(path.join(target, 'volume/db')).ino, fs.statSync(path.join(target, 'hardlink')).ino);
  assert.equal(fs.readlinkSync(path.join(target, 'symlink')), 'volume/db');
});
