import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { discoverWindows, mergeBlock, setupWindows } from './windows.mjs';

const windows = process.platform === 'win32';
const powershell = windows ? path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe') : 'powershell.exe';
const bash = windows ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash';

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "shell win's 漢字 "));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const profile = path.join(home, 'Documents/WindowsPowerShell/profile.ps1');
  fs.mkdirSync(path.dirname(profile), { recursive: true });
  fs.writeFileSync(profile, "# user profile\r\n$global:MyCustomSetting = 'keep'\r\n");
  const discovered = { shells: [{ executable: powershell, profile }], bash: fs.existsSync(bash) ? bash : null, autoRun: null, autoRunKind: 'String' };
  return { home, profile, discovered };
}

test('managed blocks preserve user text and reject ambiguous markers', () => {
  const text = '# user content\r\n';
  const once = mergeBlock(text, 'managed');
  assert.equal(mergeBlock(once, 'managed'), once);
  assert.ok(once.endsWith(text));
  assert.throws(() => mergeBlock('# >>> my-opencode Windows shell v1 >>>\n', ''), /markers/);
});

test('Windows dry run parses profiles without changing files or Registry', { skip: !windows }, t => {
  const f = fixture(t);
  const previous = fs.readFileSync(f.profile, 'utf8');
  const result = setupWindows({ ...f, dryRun: true, cmd: true });
  assert.ok(result.changed.some(target => target.endsWith('AutoRun')));
  assert.equal(fs.readFileSync(f.profile, 'utf8'), previous);
  assert.equal(fs.existsSync(path.join(f.home, '.config')), false);
});

test('PowerShell and Git Bash setup is idempotent with private backups and preserved customizations', { skip: !windows }, t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.home, '.bashrc'), '# Bash customization\nexport KEPT=yes\n');
  const result = setupWindows(f);
  assert.ok(result.backup);
  assert.deepEqual(setupWindows(f).changed, []);
  assert.match(fs.readFileSync(f.profile, 'utf8'), /MyCustomSetting = 'keep'/);
  const manifest = JSON.parse(fs.readFileSync(path.join(result.backup, 'manifest.json')));
  const oldProfile = manifest.files.find(file => file.target === f.profile);
  assert.equal(fs.readFileSync(path.join(result.backup, oldProfile.backup), 'utf8'), "# user profile\r\n$global:MyCustomSetting = 'keep'\r\n");
  if (f.discovered.bash) {
    const r = spawnSync(bash, ['--noprofile', '--norc', '-c', '. "$HOME/.bashrc"; . "$HOME/.bashrc"; printf "%s" "$KEPT"'], {
      env: { ...process.env, HOME: f.home, USERPROFILE: f.home }, encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, 'yes');
  }
});

test('bad existing PowerShell syntax blocks all changes without printing profile contents', { skip: !windows }, t => {
  const f = fixture(t);
  fs.writeFileSync(f.profile, "if ( { # synthetic-private-value");
  assert.throws(() => setupWindows(f), error => /syntax validation failed/.test(error.message) && !error.message.includes('synthetic-private-value'));
  assert.equal(fs.existsSync(path.join(f.home, '.config')), false);
});

test('CMD opt-in prepends its loader and preserves the original unexpanded AutoRun and type', { skip: !windows }, t => {
  const f = fixture(t);
  f.discovered.autoRun = 'echo %SOME_CUSTOM_VALUE%';
  f.discovered.autoRunKind = 'ExpandString';
  let update;
  const execute = (command, args, options) => {
    if (command === 'powershell.exe') {
      update = JSON.parse(options.input);
      return { status: 0, stdout: '' };
    }
    return spawnSync(command, args, options);
  };
  const result = setupWindows({ ...f, cmd: true, execute });
  assert.ok(result.changed.some(target => target.endsWith('AutoRun')));
  assert.equal(update.kind, 'ExpandString');
  assert.ok(update.value.endsWith(' & echo %SOME_CUSTOM_VALUE%'));
  assert.ok(update.value.startsWith('call '));
  f.discovered.autoRun = update.value;
  assert.deepEqual(setupWindows({ ...f, cmd: true, execute }).changed, []);
});

test('CMD remains untouched by default and refuses non-string AutoRun values', { skip: !windows }, t => {
  const f = fixture(t);
  f.discovered.autoRun = 'custom-startup';
  const result = setupWindows({ ...f, dryRun: true });
  assert.ok(result.changed.every(target => !target.endsWith('AutoRun')));
  f.discovered.autoRunKind = 'DWord';
  assert.throws(() => setupWindows({ ...f, cmd: true }), /must be a string/);
  assert.equal(fs.existsSync(path.join(f.home, '.config')), false);
});

test('unmanaged loader collisions and redirected paths are refused', { skip: !windows }, t => {
  const f = fixture(t);
  const loader = path.join(f.home, '.config/shell/windows.ps1');
  fs.mkdirSync(path.dirname(loader), { recursive: true });
  fs.writeFileSync(loader, 'custom script');
  assert.throws(() => setupWindows(f), /unmanaged Windows loader/);
  fs.unlinkSync(loader);
  fs.mkdirSync(path.join(f.home, 'elsewhere'));
  fs.symlinkSync(path.join(f.home, 'elsewhere'), path.join(f.home, '.config/shell/redirected'), 'junction');
  f.discovered.shells[0].profile = path.join(f.home, '.config/shell/redirected/profile.ps1');
  assert.throws(() => setupWindows(f), /redirected shell path/);
});

test('CMD loader preserves existing environment values without producing output', { skip: !windows }, t => {
  const f = fixture(t);
  const loader = fileURLToPath(new URL('./templates/windows.cmd', import.meta.url));
  for (const name of ['bin', '.local/bin', 'mise/shims']) fs.mkdirSync(path.join(f.home, name), { recursive: true });
  const result = spawnSync('cmd.exe', ['/d', '/s', '/c', `call "${loader}" & call "${loader}" & echo %UNRELATED_TEST_VALUE%`], {
    env: { ...process.env, USERPROFILE: f.home, MISE_DATA_DIR: path.join(f.home, 'mise'), UNRELATED_TEST_VALUE: 'preserved' }, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'preserved');
});

test('real discovery detects PowerShell profiles without running them', { skip: !windows }, () => {
  const result = discoverWindows();
  assert.ok(result.shells.some(shell => path.isAbsolute(shell.profile)));
});

test('PowerShell startup keeps user settings, activates mise and runs its local hook once', { skip: !windows }, t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.home, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(f.home, 'bin/mise.cmd'), "@echo off\r\necho $env:MISE_TEST_ACTIVATED = 'yes'\r\necho function global:mise { 'fixture' }\r\n");
  setupWindows(f);
  fs.writeFileSync(path.join(f.home, '.config/shell/local.ps1'), "$global:FixtureLocalCount += 1\n");
  const script = `. '${f.profile.replaceAll("'", "''")}'; . '${f.profile.replaceAll("'", "''")}'; if ($global:MyCustomSetting -ne 'keep' -or $global:FixtureLocalCount -ne 1 -or $env:MISE_TEST_ACTIVATED -ne 'yes' -or (mise) -ne 'fixture') { exit 1 }`;
  const env = { ...process.env, USERPROFILE: f.home };
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
  env.PATH = path.join(f.home, 'bin') + ';' + path.join(process.env.SystemRoot, 'System32');
  const result = spawnSync(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});

test('CMD registry update writes the real string kind in an isolated test key', { skip: !windows }, t => {
  const f = fixture(t);
  const registryPath = `Software\\my-opencode-shell-tests\\${process.pid}`;
  const run = script => {
    const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  t.after(() => run(`Remove-Item -LiteralPath 'HKCU:\\${registryPath}' -Force -ErrorAction SilentlyContinue`));
  setupWindows({ ...f, cmd: true, registryPath });
  const result = JSON.parse(run(`$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('${registryPath}'); try { @{value=$key.GetValue('AutoRun'); kind=[string]$key.GetValueKind('AutoRun')} | ConvertTo-Json -Compress } finally { $key.Dispose() }`));
  assert.equal(result.kind, 'String');
  assert.ok(result.value.includes('windows.cmd'));
});

test('restrictive execution policies are reported before any writes', { skip: !windows }, t => {
  const f = fixture(t);
  f.discovered.shells[0].policy = 'Restricted';
  assert.throws(() => setupWindows(f), /Set-ExecutionPolicy -Scope CurrentUser RemoteSigned/);
  assert.equal(fs.existsSync(path.join(f.home, '.config')), false);
});

test('UTF-16 PowerShell profiles preserve Unicode content and using directives', { skip: !windows }, t => {
  const f = fixture(t);
  const original = "using namespace System.Text\r\n# custom 漢字\r\n$global:Setting = 'kept'\r\n";
  fs.writeFileSync(f.profile, Buffer.from('\ufeff' + original, 'utf16le'));
  setupWindows(f);
  const content = fs.readFileSync(f.profile, 'utf8').replace(/^\ufeff/, '');
  assert.ok(content.startsWith(original));
  assert.deepEqual(setupWindows(f).changed, []);
});
