import { spawnSync } from 'node:child_process';
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

export function setup(app, { platform = process.platform, execute = spawnSync } = {}) {
  const commands = app === 'codex' ? [['app-server', 'daemon', 'restart']]
    : app === 'openchamber' ? [['startup', 'disable'], ['stop', '--port', '3000'], ['startup', 'enable', '--port', '3000']]
      : null;
  if (!commands) throw new Error('Usage: services/setup.mjs codex|openchamber');
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
      const result = execute(app, args, { stdio: 'inherit' });
      if (result.error?.code === 'ENOENT') throw new Error(`${app} is not installed or not on PATH. Run mise install and mise reshim, then retry.`);
      if (result.error || result.status !== 0) throw new Error(`${app}:setup failed. Check the command output above.`);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: services/setup.mjs codex|openchamber');
    setup(process.argv[2]);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
