import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { centralized, privateWrite } from '../shell/integration.mjs';

// The active Docker endpoint decides the role: SSH guests use the host's
// migrated daemon and must never move local system directories.
export function setupDocker(home, { run = docker, dryRun = false, execute = spawnSync } = {}) {
  if (process.env.DOCKER_HOST || process.env.DOCKER_CONTEXT || process.env.DOCKER_CONFIG) {
    throw new Error('Unset DOCKER_HOST/DOCKER_CONTEXT/DOCKER_CONFIG before setup; use an explicit saved Docker context.');
  }
  const endpoint = run(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']);
  if (endpoint.startsWith('ssh://')) {
    const id = run(['info', '--format', '{{.ID}}']);
    console.log(`Remote Docker ${endpoint} (daemon ${id}): migrate storage on that host. No guest daemon/storage changes.`);
    return { remote: true, endpoint };
  }
  if (!['unix:///var/run/docker.sock', 'unix:///run/docker.sock'].includes(endpoint)) {
    throw new Error('Only the native local Docker socket or an SSH context is supported.');
  }
  const helper = fileURLToPath(new URL('./docker-storage.mjs', import.meta.url));
  const args = dryRun ? [process.execPath, helper, '--dry-run']
    : ['/usr/bin/flock', '--nonblock', '/run/lock/azure-mnt-cache-docker.lock', process.execPath, helper, '--apply'];
  const root = process.getuid() === 0;
  const result = execute(root ? args[0] : 'sudo', root ? args.slice(1) : ['--', ...args], { stdio: 'inherit' });
  if (result.error || result.status !== 0) throw new Error('Docker storage migration failed; inspect the message above.');
  return { remote: false, endpoint };
}

export function options(argv) {
  if (argv.some(arg => arg !== '--dry-run')) throw new Error('Usage: azure-mnt-cache:setup [--dry-run]');
  return { dryRun: argv.includes('--dry-run') };
}

function docker(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 180_000 });
  if (result.error || result.status !== 0) throw new Error(`docker ${args[0]} failed: ${result.stderr?.trim() || result.error?.message || 'unknown error'}`);
  return result.stdout.trim();
}

export function install(home) {
  // A task cannot change its parent shell. Install a loader for future shells.
  privateWrite(home, path.join(home, '.config/azure-mnt-cache/shell-enabled'), '1\n');
  const loader = '[ ! -r "$HOME/.config/azure-mnt-cache/cache.sh" ] || . "$HOME/.config/azure-mnt-cache/cache.sh"';
  const central = centralized(home);
  for (const name of central ? ['.zshrc', '.zprofile'] : ['.bashrc', '.profile', '.zshrc', '.zprofile']) {
    const target = path.join(home, name);
    const previous = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
    if (!previous.split(/\r?\n/).includes(loader)) {
      fs.appendFileSync(target, `${previous.endsWith('\n') || !previous ? '' : '\n'}\n# Managed by mise azure-mnt-cache:setup\n${loader}\n`, { mode: 0o600 });
    }
  }
  // Bash skips .profile when one of these existing login files is present.
  if (central) return;
  for (const name of ['.bash_profile', '.bash_login']) {
    const target = path.join(home, name);
    if (!fs.existsSync(target)) continue;
    const previous = fs.readFileSync(target, 'utf8');
    if (!previous.split(/\r?\n/).includes(loader)) {
      fs.appendFileSync(target, `${previous.endsWith('\n') ? '' : '\n'}\n# Managed by mise azure-mnt-cache:setup\n${loader}\n`);
    }
    break;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.platform !== 'linux') throw new Error('This task supports Linux only.');
    const { dryRun } = options(process.argv.slice(2));
    if (spawnSync('docker', ['--version'], { encoding: 'utf8' }).status === 0) setupDocker(os.homedir(), { dryRun });
    if (!dryRun) {
      install(os.homedir());
      // The default builder now stores data on /mnt too; retire our old override.
      const marker = path.join(os.homedir(), '.config/azure-mnt-cache/docker-enabled');
      if (fs.existsSync(marker)) fs.unlinkSync(marker);
    }
    console.log(dryRun ? 'Dry run complete; no migration or shell changes.' : 'Storage setup complete. Open a new shell to refresh cache paths and builder selection.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
