import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { manage } from './service.mjs';

function fixture(options, callback) {
  const dir = mkdtempSync(join(tmpdir(), 'cloudflared-test-'));
  try {
    const binary = join(dir, 'cloudflared');
    writeFileSync(binary, '', { mode: 0o700 });
    const calls = [];
    const run = (command, argv, opts) => {
      calls.push({ command, argv, opts });
      if (command === 'mise') return { status: 0, stdout: JSON.stringify({ cloudflared: [{ installed: true, version: '2026.10.3', install_path: dir, ...options.row }] }) };
      if (command === binary) return { status: 0, stdout: options.version ?? 'cloudflared version 2026.10.3 (built today)' };
      if (argv.includes('/usr/bin/true')) return { status: options.auth ? 1 : 0 };
      if (argv[0] === '-v') return { status: options.denied ? 1 : 0 };
      return { status: options.failed ? 1 : 0, stdout: '', stderr: options.failed ? 'Sanitized failure.' : '' };
    };
    callback({ calls, execute: operation => manage(operation, { platform: 'linux', uid: 1000, args: [], run, ...options.deps }) });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('restart resolves global Mise pin and sends private input to root helper', () => fixture({}, ({ calls, execute }) => {
  execute('restart');
  const last = calls.at(-1);
  assert.equal(last.command, 'sudo');
  assert.deepEqual(last.argv.slice(0, 4), ['-n', '--', '/usr/bin/python3', '-c']);
  assert.equal(JSON.parse(last.opts.input).operation, 'restart');
  assert.ok(JSON.parse(last.opts.input).binary.endsWith('/cloudflared'));
}));
test('setup has distinct operation and authenticates on inherited terminal when needed', () => fixture({ auth: true }, ({ calls, execute }) => {
  execute('setup');
  assert.equal(JSON.parse(calls.at(-1).opts.input).operation, 'setup');
  assert.deepEqual(calls.find(c => c.argv[0] === '-v').opts, { stdio: 'inherit' });
}));
test('root skips sudo', () => fixture({ deps: { uid: 0 } }, ({ calls, execute }) => {
  execute('restart');
  assert.ok(calls.every(c => c.command !== 'sudo'));
  assert.equal(calls.at(-1).command, '/usr/bin/python3');
}));
for (const options of [{ row: { installed: false } }, { version: 'cloudflared version 2026.10.1 ' }, { auth: true, denied: true }, { failed: true }]) {
  test(`reject invalid installation/auth/helper: ${JSON.stringify(options)}`, () => fixture(options, ({ execute }) => {
    assert.throws(() => execute('restart'));
  }));
}
test('unsupported hosts and arguments fail before commands', () => {
  for (const deps of [{ platform: 'darwin' }, { args: ['--anything'] }]) {
    fixture({ deps }, ({ calls, execute }) => { assert.throws(() => execute('restart')); assert.equal(calls.length, 0); });
  }
});
test('root helper parser, lifecycle, rollback and path verification tests', () => {
  const tests = fileURLToPath(new URL('./service_test.py', import.meta.url));
  execFileSync('python3', ['-B', tests], { stdio: 'inherit' });
});
