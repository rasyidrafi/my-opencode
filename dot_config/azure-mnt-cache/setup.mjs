import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { centralized, privateWrite } from '../shell/integration.mjs';

export function setupDocker(home, run = docker, mounted = () => spawnSync('mountpoint', ['-q', '/mnt']).status === 0, root = `/mnt/cache/${os.userInfo().username}/docker-buildkit`) {
  if (!mounted()) throw new Error('/mnt must be mounted before configuring Docker cache.');
  const builder = 'azure-mnt-cache';
  const volume = 'buildx_buildkit_azure-mnt-cache0_state';
  run(['info', '--format', '{{.DockerRootDir}}']);
  // Restrict this to the local daemon: a remote daemon cannot use our /mnt.
  const endpoint = run(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']);
  if (process.env.DOCKER_HOST || process.env.DOCKER_CONTEXT || !endpoint.startsWith('unix://')) {
    throw new Error('Docker cache setup requires a local Unix-socket context without DOCKER_HOST/DOCKER_CONTEXT overrides.');
  }
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const volumes = run(['volume', 'ls', '--format', '{{.Name}}']).split('\n');
  if (volumes.includes(volume)) {
    const [existing] = JSON.parse(run(['volume', 'inspect', volume]));
    if (existing.Driver !== 'local' || existing.Options?.device !== root || existing.Options?.o !== 'bind' || existing.Options?.type !== 'none') {
      throw new Error(`Volume ${volume} already exists with different settings; refusing to modify it.`);
    }
  } else {
    run(['volume', 'create', '--driver', 'local', '--opt', 'type=none', '--opt', `device=${root}`, '--opt', 'o=bind', volume]);
  }
  const builders = run(['buildx', 'ls', '--format', '{{json .}}']).split('\n').filter(Boolean).map(line => JSON.parse(line));
  const existing = builders.find(item => item.Name === builder);
  if (existing) {
    if (existing.Driver !== 'docker-container' || existing.Nodes?.length !== 1 || existing.Nodes[0].Name !== 'azure-mnt-cache0' || existing.Nodes[0].Endpoint !== endpoint) {
      throw new Error(`Builder ${builder} already exists with different settings; refusing to modify it.`);
    }
  } else {
    run(['buildx', 'create', '--name', builder, '--node', 'azure-mnt-cache0', '--driver', 'docker-container', '--driver-opt', 'default-load=true', endpoint]);
  }
  run(['buildx', 'inspect', builder, '--bootstrap']);
  fs.writeFileSync(path.join(home, '.config/azure-mnt-cache/docker-enabled'), `${builder}\n`, { mode: 0o600 });
  console.log(`Docker BuildKit cache enabled at ${root}. Other builders and application data were left untouched.`);
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
    install(os.homedir());
    if (spawnSync('docker', ['--version'], { encoding: 'utf8' }).status === 0) setupDocker(os.homedir());
    console.log('Installed cache loader for new Bash/Zsh shells. Existing caches were not moved or deleted.');
    console.log('Activate in this shell: . "$HOME/.config/azure-mnt-cache/cache.sh"');
    console.log('Uses /mnt only when mounted and writable; otherwise uses home defaults.');
    console.log('If /mnt/cache is not writable, ask an administrator to create /mnt/cache/<your-user> owned by you.');
    console.log('Files stored on an Azure temporary disk can disappear when that disk is reset.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
