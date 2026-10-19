import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { install, setupDocker } from './setup.mjs';

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

test('Docker setup provisions bind-backed cache and is repeatable', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'azure-docker-test-'));
  const root = path.join(home, 'cache');
  const calls = [];
  let volume = false;
  let builder = false;
  fs.mkdirSync(path.join(home, '.config/azure-mnt-cache'), { recursive: true });
  const run = args => {
    calls.push(args);
    if (args[0] === 'context') return 'unix:///var/run/docker.sock';
    if (args[0] === 'volume' && args[1] === 'ls') return volume ? 'buildx_buildkit_azure-mnt-cache0_state' : '';
    if (args[0] === 'volume' && args[1] === 'create') volume = true;
    if (args[0] === 'volume' && args[1] === 'inspect') return JSON.stringify([{ Driver: 'local', Options: { device: root, o: 'bind', type: 'none' } }]);
    if (args[0] === 'buildx' && args[1] === 'ls') return builder ? JSON.stringify({ Name: 'azure-mnt-cache', Driver: 'docker-container', Nodes: [{ Name: 'azure-mnt-cache0', Endpoint: 'unix:///var/run/docker.sock' }] }) : '';
    if (args[0] === 'buildx' && args[1] === 'create') builder = true;
    return '';
  };
  try {
    setupDocker(home, run, () => true, root);
    setupDocker(home, run, () => true, root);
    assert.equal(calls.filter(args => args[0] === 'volume' && args[1] === 'create').length, 1);
    assert.equal(calls.filter(args => args[0] === 'buildx' && args[1] === 'create').length, 1);
    assert.equal(fs.readFileSync(path.join(home, '.config/azure-mnt-cache/docker-enabled'), 'utf8'), 'azure-mnt-cache\n');
    assert.throws(() => setupDocker(home, run, () => false, root), /must be mounted/);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
