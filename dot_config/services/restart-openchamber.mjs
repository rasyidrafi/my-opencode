import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireTaskPlatform } from '../my-opencode/platform.mjs';

export function restart({ platform = process.platform, env = process.env, execute = spawnSync } = {}) {
  requireTaskPlatform('openchamber:restart', ['linux'], platform, env);
  const result = execute('systemd-run', [
    '--user', '--on-active=5s', 'systemctl', '--user', 'restart', 'openchamber.service',
  ], { stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    throw new Error('Could not schedule OpenChamber restart. Check systemd user service availability and the output above.');
  }
  console.log('OpenChamber restart scheduled in 5 seconds. The connection will drop; reconnect after it starts.');
  console.log('Scheduling succeeded; check systemctl --user status openchamber.service after reconnecting.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { restart(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
