import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { scannerSession } from './windows-scan.mjs';

test('scanner reuses one helper for multiple requests and closes it', { skip: process.platform !== 'win32' }, () => {
  let launches = 0;
  const scanner = '$result = [Console]::In.ReadToEnd(); [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false); $result';
  const session = scannerSession(scanner, (command, args, options) => {
    launches++;
    const script = Buffer.from(args.at(-1), 'base64').toString('utf16le');
    assert.match(script, /-Verb RunAs -WindowStyle Hidden/);
    assert.match(script, /GetCurrent\(\).User.Value/);
    // Exercise the real file protocol without requesting UAC in a test.
    const actual = script.replace('-Verb RunAs ', '');
    return execFileSync(command, [...args.slice(0, -1), Buffer.from(actual, 'utf16le').toString('base64')], options);
  });
  try {
    assert.equal(session.scan('', '[{"id":"first"}]'), '[{"id":"first"}]');
    assert.equal(session.scan('', '[{"id":"second"}]'), '[{"id":"second"}]');
    assert.equal(launches, 1);
  } finally { session.close(); }
});
