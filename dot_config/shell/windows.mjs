import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { restrictWindowsDirectory } from '../secrets/windows.mjs';

const templates = fileURLToPath(new URL('./templates/', import.meta.url));
const begin = '# >>> my-opencode Windows shell v1 >>>';
const end = '# <<< my-opencode Windows shell v1 <<<';
const psQuote = value => `'${value.replaceAll("'", "''")}'`;
const shQuote = value => `'${value.replaceAll("'", "'\\''")}'`;
const encode = value => Buffer.from(value, 'utf16le').toString('base64');

function ps(script, input, execute = spawnSync) {
  const result = execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encode(`$ErrorActionPreference = 'Stop'\n[Console]::InputEncoding = [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)\n${script}`)], {
    input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  if (result.error || result.status !== 0) throw new Error('Windows shell inspection/update failed; diagnostic contents withheld to protect profile values.');
  return result.stdout;
}

export function discoverWindows(execute = spawnSync) {
  return JSON.parse(ps(`
    $shells = @()
    $executables = @('powershell.exe', 'pwsh.exe')
    foreach ($root in @($env:ProgramFiles, $env:ProgramW6432, $env:LOCALAPPDATA)) {
      if ($root) { $executables += (Join-Path $root 'PowerShell/7/pwsh.exe') }
    }
    foreach ($name in $executables) {
      $command = Get-Command $name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
      if (!$command -or $shells.executable -contains $command.Source) { continue }
      $profilePath = & $command.Source -NoProfile -NonInteractive -Command '[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false); [Console]::Write($PROFILE.CurrentUserAllHosts)'
      if ($LASTEXITCODE -ne 0 -or !$profilePath) { throw 'Cannot locate shell profile.' }
      $policy = & $command.Source -NoProfile -NonInteractive -Command 'Get-ExecutionPolicy'
      if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect shell execution policy.' }
      $shells += @{ executable=$command.Source; profile=[string]$profilePath; policy=[string]$policy }
    }
    $gitRoots = @()
    foreach ($root in @($env:ProgramFiles, $env:ProgramW6432)) { if ($root) { $gitRoots += (Join-Path $root 'Git') } }
    if ($env:LOCALAPPDATA) { $gitRoots += (Join-Path $env:LOCALAPPDATA 'Programs/Git') }
    $git = Get-Command git.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($git) { $gitRoots += (Split-Path (Split-Path $git.Source -Parent) -Parent) }
    $bash = $null
    foreach ($root in $gitRoots) {
      $candidate = Join-Path $root 'bin/bash.exe'
      if (Test-Path -LiteralPath $candidate -PathType Leaf) { $bash = $candidate; break }
    }
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\\Microsoft\\Command Processor')
    $autoRun = $null; $kind = 'String'
    if ($key) {
      try {
        $autoRun = $key.GetValue('AutoRun', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        if ($null -ne $autoRun) { $kind = [string]$key.GetValueKind('AutoRun') }
      } finally { $key.Dispose() }
    }
    @{ shells=@($shells); bash=$bash; autoRun=$autoRun; autoRunKind=$kind } | ConvertTo-Json -Depth 5 -Compress
  `, '', execute));
}

export function mergeBlock(previous, body, append = false) {
  // Preserve all user content and its line endings outside the owned block.
  const starts = [...previous.matchAll(/^# >>> my-opencode Windows shell v1 >>>\r?$/gm)];
  const ends = [...previous.matchAll(/^# <<< my-opencode Windows shell v1 <<<\r?$/gm)];
  if (starts.length !== ends.length || starts.length > 1 || (starts.length && starts[0].index >= ends[0].index)) {
    throw new Error('Invalid or duplicated Windows shell markers; repair them before setup.');
  }
  const block = `${begin}\n${body}\n${end}\n`;
  if (!starts.length) return append ? previous + (previous && !previous.endsWith('\n') ? '\n' : '') + block : block + previous;
  const finish = ends[0].index + ends[0][0].length;
  return previous.slice(0, starts[0].index) + block + previous.slice(previous[finish] === '\n' ? finish + 1 : finish);
}

function safeFile(target) {
  if (!path.isAbsolute(target)) throw new Error('Shell profile paths must be absolute.');
  let current = target;
  while (true) {
    try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Refusing redirected shell path: ${current}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  if (fs.existsSync(target) && !fs.statSync(target).isFile()) throw new Error(`Expected a regular file: ${target}`);
}

function readProfile(target) {
  if (!fs.existsSync(target)) return '';
  const bytes = fs.readFileSync(target);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString('utf16le');
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return Buffer.from(bytes.subarray(2)).swap16().toString('utf16le');
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error(`Unsupported profile encoding: ${target}. Convert it to UTF-8 or UTF-16 with a BOM before setup.`); }
}

function validate(content, shell, execute, bash = false) {
  const env = { ...process.env };
  delete env.BASH_ENV; delete env.ENV;
  const args = bash ? ['--noprofile', '--norc', '-n'] : ['-NoProfile', '-NonInteractive', '-EncodedCommand', encode(`
    [Console]::InputEncoding = New-Object Text.UTF8Encoding($false)
    $tokens = $null; $errors = $null
    $null = [Management.Automation.Language.Parser]::ParseInput([Console]::In.ReadToEnd(), [ref]$tokens, [ref]$errors)
    if ($errors.Count) { exit 1 }
  `)];
  const result = execute(shell, args, { input: content, env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  if (result.error || result.status !== 0) throw new Error('Shell syntax validation failed; existing profile contents were not printed.');
}

export function setupWindows({ home = os.homedir(), env = process.env, dryRun = false, cmd = false, execute = spawnSync, discovered = discoverWindows(execute), registryPath = 'Software\\Microsoft\\Command Processor' } = {}) {
  home = path.resolve(home);
  const root = path.join(home, '.config/shell');
  const changes = new Map();
  const plan = (target, content) => {
    safeFile(target);
    if (target.endsWith('.ps1')) content = '\ufeff' + content.replace(/^\ufeff/, '');
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== content) changes.set(target, content);
  };
  const template = name => fs.readFileSync(path.join(templates, name), 'utf8').replaceAll('\r\n', '\n');
  const owned = (target, name) => {
    safeFile(target);
    const content = template(name);
    if (fs.existsSync(target) && !fs.readFileSync(target, 'utf8').replace(/^\ufeff/, '').startsWith(content.split('\n')[0])) {
      throw new Error(`Refusing to replace an unmanaged Windows loader: ${target}`);
    }
    plan(target, content);
  };
  const profiles = [...new Map(discovered.shells.map(shell => [shell.profile.toLowerCase(), shell])).values()];
  if (!profiles.length && !discovered.bash && !cmd) throw new Error('No supported Windows shell found. Install PowerShell or Git for Windows, or explicitly select --cmd.');
  const powershellLoader = path.join(root, 'windows.ps1');
  if (profiles.length) owned(powershellLoader, 'windows.ps1');
  for (const shell of profiles) {
    if (['Restricted', 'AllSigned'].includes(shell.policy)) throw new Error(`PowerShell execution policy ${shell.policy} blocks unsigned startup hooks. If permitted by your organization, run Set-ExecutionPolicy -Scope CurrentUser RemoteSigned in that PowerShell version, then rerun setup. No execution policy was changed.`);
    safeFile(shell.profile);
    const previous = readProfile(shell.profile);
    const content = mergeBlock(previous, `. ${psQuote(powershellLoader)}`, true);
    validate(content, shell.executable, execute);
    plan(shell.profile, content);
  }
  if (discovered.bash) {
    const bashLoader = path.join(root, 'windows.sh');
    owned(bashLoader, 'windows.sh');
    const unixLoader = bashLoader.replaceAll('\\', '/');
    const hook = `[ ! -r ${shQuote(unixLoader)} ] || . ${shQuote(unixLoader)}`;
    const login = ['.bash_profile', '.bash_login', '.profile'].find(name => fs.existsSync(path.join(home, name))) || '.bash_profile';
    for (const name of ['.bashrc', login]) {
      const target = path.join(home, name);
      safeFile(target);
      const previous = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
      let body = hook;
      if (name === login && !/(?:source|\.)[^\n]*\.bashrc/.test(mergeBlock(previous, ''))) {
        body += '\ncase $- in *i*) [ ! -r "$HOME/.bashrc" ] || . "$HOME/.bashrc" ;; esac';
      }
      const content = mergeBlock(previous, body);
      validate(content, discovered.bash, execute, true);
      plan(target, content);
    }
  }
  let autoRun = discovered.autoRun;
  let registryChanged = false;
  if (cmd) {
    if (!['String', 'ExpandString'].includes(discovered.autoRunKind)) throw new Error('CMD AutoRun must be a string; existing value was preserved.');
    const cmdLoader = path.join(root, 'windows.cmd');
    if (/[\r\n%!\x22]/.test(cmdLoader)) throw new Error('CMD setup cannot safely use a home path containing quotes, percent signs, exclamation marks or newlines.');
    owned(cmdLoader, 'windows.cmd');
    const prefix = `call "${cmdLoader}"`;
    if (autoRun !== prefix && !autoRun?.startsWith(prefix + ' & ')) {
      if (autoRun?.toLowerCase().includes(cmdLoader.toLowerCase())) throw new Error('Unrecognized CMD loader reference; review AutoRun before setup.');
      autoRun = prefix + (autoRun ? ` & ${autoRun}` : '');
      registryChanged = true;
    }
  }
  const report = { changed: [...changes.keys(), ...(registryChanged ? ['HKCU/Software/Microsoft/Command Processor/AutoRun'] : [])],
    shells: profiles.map(shell => shell.executable), gitBash: discovered.bash, cmd: cmd || Boolean(discovered.autoRun?.includes(path.join(root, 'windows.cmd'))), backup: null };
  if (dryRun || !report.changed.length) return report;
  const backup = path.join(home, '.local/state/shell-init-backups', `windows-${new Date().toISOString().replaceAll(':', '-')}-${process.pid}`);
  safeFile(path.join(backup, 'manifest.json'));
  fs.mkdirSync(backup, { recursive: true });
  restrictWindowsDirectory(backup);
  const files = [...changes.keys()].map((target, index) => ({ target, backup: `${index}.txt`, exists: fs.existsSync(target) }));
  for (const file of files) if (file.exists) fs.copyFileSync(file.target, path.join(backup, file.backup));
  fs.writeFileSync(path.join(backup, 'manifest.json'), JSON.stringify({ files, ...(registryChanged ? { autoRun: discovered.autoRun, autoRunKind: discovered.autoRunKind } : {}) }, null, 2));
  try {
    for (const [target, content] of changes) {
      safeFile(target);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      // UTF-8 BOM keeps non-ASCII paths readable by Windows PowerShell 5.1.
      fs.writeFileSync(target, content);
    }
    if (registryChanged) ps(`
      $data = [Console]::In.ReadToEnd() | ConvertFrom-Json
      $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($data.key)
      try {
        $current = $key.GetValue('AutoRun', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        if ($current -cne $data.previous) { throw 'AutoRun changed during setup; retry.' }
        $key.SetValue('AutoRun', $data.value, [Microsoft.Win32.RegistryValueKind][Enum]::Parse([Microsoft.Win32.RegistryValueKind], $data.kind))
      } finally { $key.Dispose() }
    `, JSON.stringify({ value: autoRun, previous: discovered.autoRun, kind: discovered.autoRunKind, key: registryPath }), execute);
  } catch {
    throw new Error(`Windows shell setup did not complete. Restore previous files/AutoRun using the private backup: ${backup}`);
  }
  return { ...report, backup };
}
