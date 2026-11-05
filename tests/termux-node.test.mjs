import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('native Node installer reports missing libraries before extraction or download', { skip: process.platform === 'win32' }, () => {
  const shell = existsSync('/data/data/com.termux/files/usr/bin/sh') ? '/data/data/com.termux/files/usr/bin/sh' : '/bin/sh';
  const directory = mkdtempSync(join(tmpdir(), 'node-prerequisite-'));
  try {
    writeFileSync(join(directory, 'dpkg-query'), '#!' + shell + '\nexit 1\n', { mode: 0o700 });
    const script = new URL('../dot_config/mise/install-termux-node.sh', import.meta.url).pathname;
    const result = spawnSync(shell, [script, '12.2.2', 'unused'], {
      env: { ...process.env, PATH: directory, MISE_TOOL_INSTALL_PATH: directory }, encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /pkg install libc\+\+ openssl c-ares libicu libsqlite zlib libffi/);
    assert.doesNotMatch(result.stderr, /curl:|dpkg-deb:/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
