import assert from 'node:assert/strict';
import { test } from 'node:test';
import { uninstall } from './openchamber-uninstall.mjs';

test('Linux removes startup and stops only the configured port', () => {
  const calls = [];
  uninstall({ platform: 'linux', env: {}, execute: (command, args) => {
    calls.push([command, args]);
    return { status: 0 };
  } });
  assert.deepEqual(calls, [
    ['openchamber', ['startup', 'disable']],
    ['openchamber', ['stop', '--port', '3000']],
  ]);
});

test('failure stops the sequence', () => {
  const calls = [];
  assert.throws(() => uninstall({ platform: 'linux', env: {}, execute: (command, args) => {
    calls.push(args);
    return { status: 1 };
  } }), /uninstall failed/);
  assert.deepEqual(calls, [['startup', 'disable']]);
});

test('Windows resolves the CLI and runs the same sequence', () => {
  uninstall({ platform: 'win32', env: {}, execute: (command, args) => {
    assert.equal(command, 'powershell.exe');
    const script = Buffer.from(args.at(-1), 'base64').toString('utf16le');
    assert.match(script, /Get-Command openchamber/);
    assert.match(script, /startup disable/);
    assert.match(script, /stop --port 3000/);
    return { status: 0 };
  } });
});
