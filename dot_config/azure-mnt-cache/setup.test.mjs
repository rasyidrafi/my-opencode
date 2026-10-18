import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { install } from './setup.mjs';

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
