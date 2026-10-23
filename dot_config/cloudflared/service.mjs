import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';

export function manage(operation, { platform = process.platform, uid = process.getuid?.(), args = process.argv.slice(2), run = spawnSync } = {}) {
  if (platform !== 'linux') throw new Error('cloudflared integration requires Linux/systemd.');
  if (!['setup', 'restart'].includes(operation) || args.length) throw new Error('Usage: mise run cloudflared:setup or cloudflared:restart (no arguments)');
  const listing = run('mise', ['ls', '--global', '--json'], { encoding: 'utf8' });
  if (listing.error || listing.status !== 0) throw new Error('Cannot resolve global Mise configuration.');
  const rows = JSON.parse(listing.stdout).cloudflared;
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0].installed || !rows[0].version || !rows[0].install_path) {
    throw new Error('Exactly one installed global cloudflared version is required; run mise install first.');
  }
  const binary = realpathSync(`${rows[0].install_path}/cloudflared`);
  const probe = run(binary, ['--version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0 || !probe.stdout.startsWith(`cloudflared version ${rows[0].version} `)) {
    throw new Error('Installed cloudflared binary does not report the configured version.');
  }
  if (uid !== 0) {
    const access = run('sudo', ['-n', '/usr/bin/true'], { stdio: 'ignore' });
    if (access.error || access.status !== 0) {
      const auth = run('sudo', ['-v'], { stdio: 'inherit' });
      if (auth.error || auth.status !== 0) throw new Error('Sudo authentication failed.');
    }
  }
  const helper = readFileSync(new URL('./service.py', import.meta.url), 'utf8');
  const command = ['/usr/bin/python3', '-c', helper];
  const result = run(uid === 0 ? command[0] : 'sudo', uid === 0 ? command.slice(1) : ['-n', '--', ...command], {
    input: JSON.stringify({ operation, binary }), encoding: 'utf8', maxBuffer: 1024 * 1024,
  });
  // The root helper emits only sanitized status/errors, never unit contents.
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.error || result.status !== 0) throw new Error(result.stderr?.trim() || 'cloudflared integration failed.');
}
