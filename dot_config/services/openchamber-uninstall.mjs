import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireTaskPlatform } from '../my-opencode/platform.mjs';

export function uninstall({ platform = process.platform, env = process.env, execute = spawnSync } = {}) {
  requireTaskPlatform('openchamber:uninstall', ['linux', 'windows'], platform, env);
  if (platform === 'win32') {
    // PowerShell resolves npm's .ps1 and .cmd launchers as well as executables.
    const script = `
      $ErrorActionPreference = 'Stop'
      $command = Get-Command openchamber -CommandType Application,ExternalScript -ErrorAction SilentlyContinue | Select-Object -First 1
      if (!$command) { throw 'openchamber is not installed or not on PATH.' }
      & $command.Source startup disable
      if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
      & $command.Source stop --port 3000
      if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    `;
    const result = execute('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { stdio: 'inherit', windowsHide: true, env });
    if (result.error || result.status !== 0) throw new Error('openchamber:uninstall failed. Check the command output above.');
    return;
  }
  for (const args of [['startup', 'disable'], ['stop', '--port', '3000']]) {
    const result = execute('openchamber', args, { stdio: 'inherit', env });
    if (result.error?.code === 'ENOENT') throw new Error('openchamber is not installed or not on PATH.');
    if (result.error || result.status !== 0) throw new Error('openchamber:uninstall failed. Check the command output above.');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { uninstall(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
