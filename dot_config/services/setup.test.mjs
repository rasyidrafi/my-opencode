import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { setup, windowsTaskRepair } from './setup.mjs';

test('PowerShell 5.1 native stderr reaches access-denied recovery instead of terminating', { skip: process.platform !== 'win32' }, t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'startup-stderr-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fixture = path.join(dir, 'fixture.cjs');
  fs.writeFileSync(fixture, `if(process.argv[2]==='startup' && process.argv[3]==='enable'){console.error('Error: schtasks.exe /Create failed: ERROR: Access is denied.');process.exit(1)}`);
  fs.writeFileSync(path.join(dir, 'openchamber.ps1'), `& '${process.execPath.replaceAll("'", "''")}' '${fixture.replaceAll("'", "''")}' @args\nexit $LASTEXITCODE\n`);
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
  env.PATH = dir + path.delimiter + process.env.PATH;
  let result;
  setup('openchamber', { platform: 'win32', execute: (command, args, options) => {
    const script = Buffer.from(args.at(-1), 'base64').toString('utf16le');
    assert.ok(script.includes(windowsTaskRepair));
    args = [...args.slice(0, -1), Buffer.from(script.replace(windowsTaskRepair, "[Console]::WriteLine('RECOVERY_REACHED')"), 'utf16le').toString('base64')];
    result = spawnSync(command, args, { ...options, env, stdio: 'pipe', encoding: 'utf8' });
    return result;
  } });
  assert.match(result.stdout, /RECOVERY_REACHED/);
});

test('Linux preserves native startup commands and stops on a failed command', () => {
  const calls = [];
  setup('codex', { platform: 'linux', execute: (command, args) => { calls.push([command, args]); return { status: 0 }; } });
  assert.deepEqual(calls, [['codex', ['app-server', 'daemon', 'restart']]]);
  let count = 0;
  assert.throws(() => setup('openchamber', { platform: 'linux', execute: () => { count++; return { status: 1 }; } }), /failed/);
  assert.equal(count, 1);
});

for (const [app, extension, fail] of [['codex', 'ps1', false], ['openchamber', 'cmd', false], ['openchamber', 'ps1', true]]) {
  test(`Windows ${app} resolves .${extension} wrappers and ${fail ? 'stops on errors' : 'passes arguments'}`, { skip: process.platform !== 'win32' }, t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "startup test's "));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const marker = path.join(dir, 'calls.jsonl');
    const fixture = path.join(dir, 'fixture.cjs');
    fs.writeFileSync(fixture, `const fs=require('fs'); const args=process.argv.slice(2); fs.appendFileSync(process.env.STARTUP_TEST_MARKER,JSON.stringify(args)+'\\n'); process.exit(${fail ? "args[0]==='stop'?7:0" : '0'});`);
    if (extension === 'cmd') fs.writeFileSync(path.join(dir, `${app}.cmd`), `@echo off\r\n"${process.execPath}" "${fixture}" %*\r\nexit /b %errorlevel%\r\n`);
    else fs.writeFileSync(path.join(dir, `${app}.ps1`), `& '${process.execPath.replaceAll("'", "''")}' '${fixture.replaceAll("'", "''")}' @args\nexit $LASTEXITCODE\n`);
    const env = { ...process.env, STARTUP_TEST_MARKER: marker };
    for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
    env.PATH = dir + path.delimiter + process.env.PATH;
    const run = () => setup(app, { platform: 'win32', execute: (command, args, options) => spawnSync(command, args, { ...options, env, stdio: 'pipe', encoding: 'utf8' }) });
    if (fail) assert.throws(run, /setup failed/); else run();
    const calls = fs.readFileSync(marker, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(calls, app === 'codex' ? [['app-server', 'daemon', 'restart']]
      : fail ? [['startup', 'disable'], ['stop', '--port', '3000']]
        : [['startup', 'disable'], ['stop', '--port', '3000'], ['startup', 'enable', '--port', '3000']]);
  });
}
