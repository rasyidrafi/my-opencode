import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

test('Linux uninstalls without mise and stops only the OpenChamber server on port 3000', {
  skip: process.platform !== 'linux',
}, async () => {
  const home = mkdtempSync(path.join(tmpdir(), 'openchamber-uninstall-'));
  const unitDir = path.join(home, '.config/systemd/user');
  const cli = path.join(home, 'node_modules/@openchamber/web/build/bin/cli.js');
  const server = path.join(home, 'node_modules/@openchamber/web/build/server/index.js');
  const log = path.join(home, 'systemctl.log');
  const children = [];
  try {
    mkdirSync(unitDir, { recursive: true });
    mkdirSync(path.dirname(cli), { recursive: true });
    mkdirSync(path.dirname(server), { recursive: true });
    writeFileSync(path.join(unitDir, 'openchamber.service'), '');
    for (const script of [cli, server]) {
      writeFileSync(script, 'console.log("ready"); setInterval(() => {}, 1000);');
    }
    writeFileSync(path.join(home, 'systemctl'), `#!/bin/sh
printf '%s\\n' "$*" >> "$HOME/systemctl.log"
if [ "$2" = show ]; then echo loaded; fi
`, { mode: 0o755 });
    for (const args of [[cli, 'serve', '--port=3000'], [server, '--port', '3000'], [cli, 'serve', '-p', '3001']]) {
      const child = spawn(process.execPath, args);
      children.push(child);
      await once(child.stdout, 'data');
    }
    const exits = children.slice(0, 2).map(child => once(child, 'exit'));
    const result = spawnSync('bash', [fileURLToPath(new URL('./openchamber-uninstall.sh', import.meta.url))], {
      env: { HOME: home, PATH: `${home}:/usr/bin:/bin` },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    for (const exit of exits) assert.deepEqual(await exit, [null, 'SIGTERM']);
    assert.equal(process.kill(children[2].pid, 0), true);
    assert.throws(() => readFileSync(path.join(unitDir, 'openchamber.service')), { code: 'ENOENT' });
    assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n'), [
      '--user show-environment',
      '--user show openchamber.service --property=LoadState --value',
      '--user stop openchamber.service',
      '--user disable openchamber.service',
      '--user daemon-reload',
    ]);
  } finally {
    for (const child of children) child.kill();
    rmSync(home, { recursive: true, force: true });
  }
});
