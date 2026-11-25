import { requireTaskPlatform } from '../my-opencode/platform.mjs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function setup(app, { platform = process.platform, env = process.env, execute = spawnSync, deferred = false } = {}) {
  requireTaskPlatform(app + ':setup', ['linux', 'windows'], platform, env);
  if (app !== 'codex') throw new Error('Usage: services/setup.mjs codex');
  const commands = [['app-server', 'daemon', 'restart']];
  const serviceEnv = { ...env };
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
        & $command.Source @arguments
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
    if (process.argv.length !== 3) throw new Error('Usage: services/setup.mjs codex');
    setup(process.argv[2]);
  };
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
