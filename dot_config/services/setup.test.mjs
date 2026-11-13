import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { setup, windowsTaskRepair } from './setup.mjs';
import { fileURLToPath } from 'node:url';

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

const fakeGlobalOpencode = t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-opencode-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const installPath = path.join(dir, '2.2.7');
  const binary = path.join(installPath, 'node_modules', '.bin', 'opencode');
  fs.mkdirSync(path.dirname(binary), { recursive: true });
  fs.writeFileSync(binary, '#!/bin/sh\n');
  return {
    binary: fs.realpathSync(binary),
    listing: JSON.stringify({ opencode: [{ version: '2.2.7', installed: true, install_path: installPath }] }),
  };
};

test('Linux preserves native startup commands and stops on a failed command', () => {
  const calls = [];
  setup('codex', { platform: 'linux', env: {}, execute: (command, args) => { calls.push([command, args]); return { status: 0 }; } });
  assert.deepEqual(calls, [['codex', ['app-server', 'daemon', 'restart']]]);
  let count = 0;
  assert.throws(() => setup('openchamber', { platform: 'linux', env: {}, execute: command => {
    count++;
    return command === 'mise' ? { status: 0, stdout: '{}' } : { status: 1 };
  } }), /startup status failed/);
  assert.equal(count, 2);
});

test('Linux first-time OpenChamber setup resolves global OpenCode and runs the enable sequence directly', t => {
  const fixture = fakeGlobalOpencode(t);
  const calls = [];
  setup('openchamber', { platform: 'linux', env: { PATH: '/usr/bin' }, execute: (command, args, options) => {
    calls.push({ command, args, options });
    if (command === 'mise') return { status: 0, stdout: fixture.listing };
    if (args[0] === 'startup') return { status: 0, stdout: JSON.stringify({ enabled: false }) };
    return { status: 0 };
  } });
  assert.deepEqual(calls.map(c => [c.command, c.args]), [
    ['mise', ['ls', '--global', '--json']],
    ['openchamber', ['startup', 'status', '--json']],
    ['openchamber', ['startup', 'disable']],
    ['openchamber', ['stop', '--port', '3000']],
    ['openchamber', ['startup', 'enable', '--port', '3000']],
  ]);
  assert.equal(calls.at(-1).options.env.OPENCODE_BINARY, fixture.binary);
  assert.equal(calls.at(-1).options.env.PATH, '/usr/bin');
});

test('Linux OpenChamber setup leaves the environment alone without a global OpenCode', () => {
  const calls = [];
  const env = { PATH: '/usr/bin', OPENCODE_BINARY: '/custom/opencode' };
  setup('openchamber', { platform: 'linux', env, execute: (command, args, options) => {
    calls.push({ command, args, options });
    if (command === 'mise') return { status: 0, stdout: '{}' };
    if (args[0] === 'startup') return { status: 0, stdout: JSON.stringify({ enabled: false }) };
    return { status: 0 };
  } });
  assert.equal(calls[0].command, 'mise');
  assert.equal(calls.at(-1).options.env.OPENCODE_BINARY, '/custom/opencode');
});

test('Linux existing OpenChamber setup schedules the update asynchronously with global OpenCode', t => {
  const fixture = fakeGlobalOpencode(t);
  const calls = [];
  const env = {
    HOME: '/home/user', XDG_RUNTIME_DIR: '/run/user/1000', PATH: '/home/user/.local/bin',
    OPENCODE_BINARY: '/old/opencode/2.2.6/node_modules/.bin/opencode',
  };
  setup('openchamber', { platform: 'linux', env, execute: (command, args, options) => {
    calls.push({ command, args, options });
    if (command === 'mise') return { status: 0, stdout: fixture.listing };
    if (args[0] === 'startup') return { status: 0, stdout: JSON.stringify({ enabled: true }) };
    return { status: 0 };
  } });
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0].args, ['ls', '--global', '--json']);
  assert.deepEqual(calls[1].args, ['startup', 'status', '--json']);
  const scheduled = calls[2];
  assert.equal(scheduled.command, 'systemd-run');
  assert.equal(scheduled.args[0], '--user');
  assert.ok(scheduled.args.includes('--on-active=5s'));
  assert.ok(scheduled.args.includes('--timer-property=AccuracySec=1us'));
  assert.ok(scheduled.args.includes('--collect'));
  assert.equal(scheduled.args.at(-3), 'openchamber');
  assert.equal(scheduled.args.at(-4), fileURLToPath(new URL('./setup.mjs', import.meta.url)));
  const environmentFile = scheduled.args.at(-1);
  assert.equal(environmentFile.startsWith('/run/user/1000/openchamber-setup-'), true);
  assert.equal(scheduled.options.env.OPENCODE_BINARY, fixture.binary);
  const written = JSON.parse(fs.readFileSync(environmentFile, 'utf8'));
  assert.equal(written.OPENCODE_BINARY, fixture.binary);
  assert.notEqual(written.OPENCODE_BINARY, env.OPENCODE_BINARY);
  t.after(() => fs.rmSync(path.dirname(environmentFile), { recursive: true, force: true }));
});

test('Linux reports failure to schedule an existing OpenChamber setup', t => {
  const fixture = fakeGlobalOpencode(t);
  let call = 0;
  assert.throws(() => setup('openchamber', { platform: 'linux', env: {}, execute: command => {
    call++;
    if (command === 'mise') return { status: 0, stdout: fixture.listing };
    return call === 2 ? { status: 0, stdout: '{"enabled":true}' } : { status: 1 };
  } }), /Could not schedule/);
  assert.equal(call, 3);
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
