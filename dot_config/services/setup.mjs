import { requireTaskPlatform } from '../my-opencode/platform.mjs';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const windowsTaskRepair = `
  $ErrorActionPreference = 'Stop'
  $wrapper = Join-Path $env:USERPROFILE '.config/openchamber/bin/OpenChamber.ps1'
  if (!(Test-Path -LiteralPath $wrapper -PathType Leaf)) { throw 'OpenChamber startup wrapper was not generated; cannot repair task registration.' }
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $payload = @{ sid=$identity.User.Value; wrapper=$wrapper; powershell="$PSHOME\\powershell.exe"; home=$env:USERPROFILE } | ConvertTo-Json -Compress
  $encodedData = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($payload))
  $child = @'
$ErrorActionPreference = 'Stop'
try {
  $data = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__DATA__')) | ConvertFrom-Json
  $action = New-ScheduledTaskAction -Execute $data.powershell -Argument ('-NoProfile -ExecutionPolicy Bypass -File "' + $data.wrapper + '"') -WorkingDirectory $data.home
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $data.sid
  $principal = New-ScheduledTaskPrincipal -UserId $data.sid -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
  $null = Register-ScheduledTask -TaskName 'dev.openchamber.web' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force
  exit 0
} catch { exit 1 }
'@
  $child = $child.Replace('__DATA__', $encodedData)
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($child))
  Write-Host 'Approve the Windows UAC prompt to register OpenChamber startup for your account.'
  try {
    $process = Start-Process -FilePath "$PSHOME\\powershell.exe" -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList "-NoProfile -NonInteractive -EncodedCommand $encoded"
    if ($process.ExitCode -ne 0) { throw 'Task registration failed.' }
  } catch { throw 'OpenChamber task registration failed or administrator approval was cancelled.' }
  & schtasks.exe /Run /TN dev.openchamber.web
  if ($LASTEXITCODE -ne 0) { throw 'OpenChamber startup task was registered but could not start.' }
`;

// A running OpenChamber instance injects the OpenCode binary it manages into
// this shell. Snapshotting that value would pin every future restart to the
// version that happened to be running. Resolve the global Mise OpenCode
// instead, matching what a first-time setup sees when no instance has
// injected anything. Returns null when Mise does not manage exactly one
// installed global OpenCode, leaving the caller's environment untouched.
function globalOpencodeBinary(env, execute) {
  const listing = execute('mise', ['ls', '--global', '--json'], { encoding: 'utf8', env });
  if (listing.error || listing.status !== 0) return null;
  let rows;
  try { rows = JSON.parse(listing.stdout)?.opencode; } catch { return null; }
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0].installed || !rows[0].install_path) return null;
  try { return realpathSync(path.join(rows[0].install_path, 'node_modules', '.bin', 'opencode')); } catch { return null; }
}

export function setup(app, { platform = process.platform, env = process.env, execute = spawnSync, deferred = false } = {}) {
  requireTaskPlatform(app + ':setup', ['linux', 'windows'], platform, env);
  const commands = app === 'codex' ? [['app-server', 'daemon', 'restart']]
    : app === 'openchamber' ? [['startup', 'disable'], ['stop', '--port', '3000'], ['startup', 'enable', '--port', '3000']]
      : null;
  if (!commands) throw new Error('Usage: services/setup.mjs codex|openchamber');
  const serviceEnv = { ...env };
  if (app === 'openchamber' && platform === 'linux') {
    const opencodeBinary = globalOpencodeBinary(serviceEnv, execute);
    if (opencodeBinary) serviceEnv.OPENCODE_BINARY = opencodeBinary;
  }
  if (app === 'openchamber' && platform === 'linux' && !deferred) {
    const status = execute('openchamber', ['startup', 'status', '--json'], { encoding: 'utf8', env: serviceEnv });
    if (status.error?.code === 'ENOENT') throw new Error('openchamber is not installed or not on PATH. Run mise install and mise reshim, then retry.');
    if (status.error || status.status !== 0) throw new Error('openchamber startup status failed. Check the command output above.');
    let integration;
    try { integration = JSON.parse(status.stdout); } catch { throw new Error('Could not read OpenChamber startup status.'); }
    if (integration.enabled) {
      const runtime = env.XDG_RUNTIME_DIR && path.isAbsolute(env.XDG_RUNTIME_DIR) ? env.XDG_RUNTIME_DIR : os.tmpdir();
      const directory = mkdtempSync(path.join(runtime, 'openchamber-setup-'));
      const environmentFile = path.join(directory, 'environment.json');
      writeFileSync(environmentFile, JSON.stringify(serviceEnv), { mode: 0o600 });
      const unit = `my-opencode-openchamber-setup-${process.pid}-${Date.now()}`;
      const script = fileURLToPath(import.meta.url);
      const result = execute('systemd-run', [
        '--user', '--on-active=5s', '--timer-property=AccuracySec=1us', '--collect', `--unit=${unit}`,
        process.execPath, script, 'openchamber', '--deferred', environmentFile,
      ], { stdio: 'inherit', env: serviceEnv });
      if (result.error || result.status !== 0) {
        rmSync(directory, { recursive: true, force: true });
        throw new Error('Could not schedule OpenChamber setup/update. Check systemd user service availability and the output above.');
      }
      console.log(`OpenChamber setup/update scheduled independently as ${unit}.service; reconnect after it restarts.`);
      console.log(`If it fails, inspect: journalctl --user -u ${unit}.service -n 100 --no-pager`);
      return;
    }
  }
  if (platform === 'win32') {
    // PowerShell resolves npm .ps1/.cmd wrappers as well as native executables.
    const payload = Buffer.from(JSON.stringify({ app, commands }), 'utf8').toString('base64');
    const script = `
      $ErrorActionPreference = 'Stop'
      $ProgressPreference = 'SilentlyContinue'
      $data = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
      $command = Get-Command $data.app -CommandType Application,ExternalScript -ErrorAction SilentlyContinue | Select-Object -First 1
      if (!$command) { Write-Error ($data.app + ' is not installed or not on PATH. Run mise install and mise reshim, then retry.'); exit 1 }
      foreach ($arguments in $data.commands) {
        $LASTEXITCODE = 0
        if ($data.app -eq 'openchamber' -and $arguments[0] -eq 'startup' -and $arguments[1] -eq 'enable') {
          # PowerShell 5.1 wraps redirected native stderr as ErrorRecord. Stop
          # would terminate before the exit code/access-denied recovery runs.
          $ErrorActionPreference = 'Continue'
          try {
            $output = & $command.Source @arguments 2>&1
            $code = $LASTEXITCODE
          } finally { $ErrorActionPreference = 'Stop' }
          if ($code -ne 0 -and (($output | Out-String) -match '(?i)access is denied|0x80070005|E_ACCESSDENIED')) {
            ${windowsTaskRepair}
            $LASTEXITCODE = 0
          } else { $output | ForEach-Object { [Console]::WriteLine([string]$_) }; $LASTEXITCODE = $code }
        } else { & $command.Source @arguments }
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
      }
    `;
    const result = execute('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
      stdio: 'inherit', windowsHide: true,
    });
    if (result.error || result.status !== 0) throw new Error(`${app}:setup failed. Check the command output above.`);
  } else {
    for (const args of commands) {
      const result = execute(app, args, { stdio: 'inherit', env: serviceEnv });
      if (result.error?.code === 'ENOENT') throw new Error(`${app} is not installed or not on PATH. Run mise install and mise reshim, then retry.`);
      if (result.error || result.status !== 0) throw new Error(`${app}:setup failed. Check the command output above.`);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const main = () => {
    if (process.argv[2] === 'openchamber' && process.argv[3] === '--deferred' && process.argv.length === 5) {
      const file = process.argv[4];
      let env;
      try { env = JSON.parse(readFileSync(file, 'utf8')); }
      finally { rmSync(path.dirname(file), { recursive: true, force: true }); }
      if (!env || Array.isArray(env) || typeof env !== 'object') throw new Error('Invalid deferred OpenChamber environment.');
      return setup('openchamber', { platform: 'linux', env, deferred: true, execute: (command, args, options = {}) => spawnSync(command, args, { ...options, env: options.env || env }) });
    }
    if (process.argv.length !== 3) throw new Error('Usage: services/setup.mjs codex|openchamber');
    setup(process.argv[2]);
  };
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
