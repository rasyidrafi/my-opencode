import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { powershell, saveWindowsEnvironment, restrictWindowsDirectory } from './windows.mjs';

test('values travel only over stdin and failures hide subprocess output', () => {
  const secret = 'dummy-secret-漢字';
  saveWindowsEnvironment({ TEST_KEY: secret }, ['OLD_KEY'], (command, args, options) => {
    assert.equal(command, 'powershell.exe');
    assert.ok(!args.join(' ').includes(secret));
    if (options.timeout === 3_000) return { status: 0 };
    assert.deepEqual(JSON.parse(options.input), { environment: { TEST_KEY: secret }, retired: ['OLD_KEY'] });
    return { status: 0 };
  });
  assert.throws(() => powershell('', '', 'test', () => ({ status: 1, stderr: secret })), error => !error.message.includes(secret));
});

test('a hung desktop notification cannot fail successfully saved environment values', () => {
  const calls = [];
  saveWindowsEnvironment({ TEST_KEY: 'synthetic' }, [], (command, args, options) => {
    calls.push(options);
    const script = Buffer.from(args.at(-1), 'base64').toString('utf16le');
    if (calls.length === 1) {
      assert.match(script, /CreateSubKey\('Environment'\)/);
      assert.ok(!script.includes('SetEnvironmentVariable'));
      return { status: 0 };
    }
    assert.equal(options.timeout, 3_000);
    assert.match(script, /SendMessageTimeout/);
    return { error: { code: 'ETIMEDOUT' }, status: null };
  });
  assert.equal(calls.length, 2);
});

test('failed Registry writes still fail setup and do not send a notification', () => {
  let calls = 0;
  assert.throws(() => saveWindowsEnvironment({ TEST_KEY: 'synthetic' }, [], () => {
    calls++;
    return { status: 1 };
  }), /Windows user environment update failed/);
  assert.equal(calls, 1);
});

test('permission repair allows UAC time and preserves the original account identity', () => {
  restrictWindowsDirectory('C:\\Users\\example\\generated', (command, args, options) => {
    const script = Buffer.from(args.at(-1), 'base64').toString('utf16le');
    assert.match(script, /catch \[System.UnauthorizedAccessException\]/);
    assert.match(script, /-Verb RunAs -WindowStyle Hidden -Wait/);
    assert.match(script, /sid=\$sid.Value/);
    assert.equal(options.timeout, undefined);
    assert.equal(options.input, 'C:\\Users\\example\\generated');
    return { status: 0 };
  });
  assert.throws(() => restrictWindowsDirectory('dummy', () => ({ status: 1 })), /administrator approval may be required/);
});

test('a full Windows batch preserves Unicode and special characters and retires managed values', { skip: process.platform !== 'win32' }, () => {
  const names = Array.from({ length: 6 }, (_, i) => `MY_OPENCODE_TEST_${process.pid}_${i}`);
  const value = "dummy 漢字 é ' \" $ ` % &\nsecond line";
  try {
    const environment = Object.fromEntries(names.map(name => [name, value]));
    saveWindowsEnvironment(environment);
    powershell(`
      $data = [Console]::In.ReadToEnd() | ConvertFrom-Json
      foreach ($property in $data.PSObject.Properties) {
        if ([Environment]::GetEnvironmentVariable($property.Name, 'User') -cne $property.Value) { exit 1 }
      }
    `, JSON.stringify(environment), 'test verification');
    saveWindowsEnvironment({}, names);
    powershell(`
      $names = [Console]::In.ReadToEnd() | ConvertFrom-Json
      foreach ($name in $names) { if ($null -ne [Environment]::GetEnvironmentVariable($name, 'User')) { exit 1 } }
    `, JSON.stringify(names), 'test cleanup verification');
  } finally { saveWindowsEnvironment({}, names); }
});

test('Windows directory permissions grant only the current account and are repeatable', { skip: process.platform !== 'win32' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secrets-permissions-'));
  try {
    restrictWindowsDirectory(dir);
    restrictWindowsDirectory(dir);
    powershell(`
      $target = [Console]::In.ReadToEnd()
      $acl = Get-Acl -LiteralPath $target
      $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
      if (!$acl.AreAccessRulesProtected) { exit 1 }
      foreach ($rule in $acl.Access) {
        if ($rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -ne $sid) { exit 1 }
      }
    `, dir, 'test ACL verification');
    fs.writeFileSync(path.join(dir, 'dummy'), 'not a secret');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
