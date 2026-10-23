import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function restart({ platform = process.platform, uid = process.getuid?.(), args = process.argv.slice(2), run = spawnSync } = {}) {
  if (platform !== 'linux') throw new Error('cloudflared:restart requires Linux with systemd.');
  if (args.length) throw new Error('Usage: mise run cloudflared:restart (no arguments)');
  const unit = 'cloudflared.service';
  const assertRunning = () => {
    // Read only state, not the unit configuration which may contain tunnel tokens.
    const result = run('systemctl', ['show', unit, '--property=LoadState,ActiveState,SubState', '--no-pager'], { encoding: 'utf8' });
    if (result.error || result.status !== 0) throw new Error('Cannot inspect cloudflared.service; requires a working system systemd manager.');
    const state = Object.fromEntries(result.stdout.trim().split('\n').map(line => line.split('=')));
    if (state.LoadState !== 'loaded' || state.ActiveState !== 'active' || state.SubState !== 'running') {
      throw new Error('cloudflared.service must already be installed and running; nothing was started.');
    }
  };
  assertRunning();
  // try-restart does not start an inactive service if it stops after our check.
  // Let sudo itself prompt on the inherited terminal; never handle passwords.
  const command = ['systemctl', 'try-restart', '--job-mode=fail', unit];
  const result = uid === 0
    ? run(command[0], command.slice(1), { stdio: 'inherit' })
    : run('sudo', ['--', ...command], { stdio: 'inherit' });
  if (result.error || result.status !== 0) throw new Error('cloudflared.service restart failed (check sudo permissions and service health).');
  assertRunning();
  console.log('cloudflared.service restarted and is running.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try { restart(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
