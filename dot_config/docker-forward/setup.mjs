import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { run } from '../docker-setup/setup.mjs';

const service = 'workbox-docker-forward.service';
const directory = '/usr/local/libexec';
const pendingFile = '/etc/workbox-docker-forward.pending';

export function settings(state) {
  if (state.role !== 'guest') throw new Error('Run docker:setup --role guest first.');
  for (const key of ['context', 'ssh-alias']) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(state[key] || '')) throw new Error(`Invalid saved ${key}. Rerun docker:setup.`);
  }
  return { context: state.context, ssh_alias: state['ssh-alias'], interval: 10 };
}

export function unit(user, group, home) {
  for (const value of [user, group]) {
    if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*\$?$/.test(value)) throw new Error('Unsupported service user/group.');
  }
  if (!path.isAbsolute(home) || /[\r\n"\\%]/.test(home)) throw new Error('Unsupported service home path.');
  return `# Managed by mise run docker:forward:setup\n[Unit]\nDescription=Forward host Docker published TCP ports to workbox localhost\nWants=network-online.target\nAfter=network-online.target\n\n[Service]\nType=simple\nUser=${user}\nGroup=${group}\nEnvironment="HOME=${home}"\nExecStart=/usr/bin/python3 ${directory}/workbox-docker-forward.py --config /etc/workbox-docker-forward.json\nRestart=always\nRestartSec=5\nTimeoutStopSec=20\nNoNewPrivileges=yes\n\n[Install]\nWantedBy=multi-user.target\n`;
}

export function activateAssets(assets, io) {
  const revision = createHash('sha256').update(JSON.stringify(assets)).digest('hex');
  const changed = assets.filter(([target, content]) => !io.matches(target, content));
  const pending = io.readPending();

  if (changed.length || pending !== null) {
    // Persist recovery intent before changing any installed asset. If install,
    // daemon-reload, restart or health verification fails, reruns retry it.
    if (pending !== revision) io.writePending(revision);
    for (const [target, content] of changed) io.install(target, content);
    io.daemonReload();
    io.enable();
    io.restart();
    if (!io.isActive()) throw new Error(`Service activation is still pending; ${service} is not active. Rerun docker:forward:setup.`);
    io.clearPending();
    return { changed: changed.map(([target]) => target), restarted: true };
  }

  io.enable();
  if (io.isActive()) return { changed: [], restarted: false };
  io.start();
  if (!io.isActive()) throw new Error(`${service} did not become active after start.`);
  return { changed: [], restarted: false };
}

export function setup(argv = process.argv.slice(2)) {
  if (argv.some(arg => arg !== '--dry-run')) throw new Error('Usage: mise run docker:forward:setup -- [--dry-run]');
  if (process.platform !== 'linux' || !fs.existsSync('/run/systemd/system')) throw new Error('Linux with systemd is required.');
  if (process.getuid() === 0) throw new Error('Run as the intended guest user; setup invokes sudo for installation.');
  for (const name of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) {
    if (process.env[name]) throw new Error(`Unset ${name} before setup so the service uses the same Docker configuration.`);
  }
  const home = os.homedir();
  const stateFile = path.join(home, '.config/docker-setup/state.json');
  if (!fs.existsSync(stateFile)) throw new Error('Missing saved guest configuration. Run docker:setup --role guest first.');
  const config = settings(JSON.parse(fs.readFileSync(stateFile, 'utf8')));
  const endpoint = run('/usr/bin/docker', ['context', 'inspect', config.context, '--format', '{{.Endpoints.docker.Host}}'], { capture: true });
  if (endpoint !== `ssh://${config.ssh_alias}`) throw new Error('Saved guest context and its SSH endpoint disagree. Rerun docker:setup.');
  run('/usr/bin/docker', ['--context', config.context, 'info', '--format', 'Docker host: {{.Name}}']);
  run('/usr/bin/python3', ['--version']);
  run('/usr/bin/ssh', ['-V']);
  const user = run('id', ['-un'], { capture: true });
  const group = run('id', ['-gn'], { capture: true });
  const contents = unit(user, group, home);
  console.log(`Install/update ${service} for ${user}: context ${config.context}, SSH ${config.ssh_alias}, polling every ${config.interval}s.`);
  console.log('All published TCP ports on this context are mirrored. Occupied localhost ports are reported, never replaced.');
  console.log('The existing workbox-docker-forward service is updated in place; unrelated/manual tunnels are preserved.');
  if (argv.includes('--dry-run')) return;

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'docker-forward-'));
  try {
    const assets = [
      [path.join(directory, 'workbox-docker-forward.py'), fs.readFileSync(new URL('./forward.py', import.meta.url), 'utf8')],
      ['/etc/workbox-docker-forward.json', JSON.stringify(config, null, 2) + '\n'],
      [`/etc/systemd/system/${service}`, contents],
    ];
    activateAssets(assets, {
      matches(target, content) { return fs.existsSync(target) && fs.readFileSync(target, 'utf8') === content; },
      readPending() {
        try {
          const stat = fs.lstatSync(pendingFile);
          if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Refusing unsafe activation marker: ${pendingFile}`);
          return fs.readFileSync(pendingFile, 'utf8');
        } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
      },
      writePending(revision) {
        const source = path.join(temporary, 'activation.pending');
        fs.writeFileSync(source, `${revision}\n`, { mode: 0o600 });
        run('sudo', ['install', '-D', '-o', 'root', '-g', 'root', '-m', '0644', source, pendingFile]);
      },
      install(target, content) {
        const source = path.join(temporary, path.basename(target));
        fs.writeFileSync(source, content, { mode: 0o600 });
        run('sudo', ['install', '-D', '-o', 'root', '-g', 'root', '-m', '0644', source, target]);
      },
      daemonReload() { run('sudo', ['systemctl', 'daemon-reload']); },
      enable() { run('sudo', ['systemctl', 'enable', service]); },
      restart() { run('sudo', ['systemctl', 'restart', service]); },
      start() { run('sudo', ['systemctl', 'start', service]); },
      isActive() { return run('systemctl', ['is-active', service], { capture: true, allowFailure: true }) === 'active'; },
      clearPending() { run('sudo', ['rm', '--', pendingFile]); },
    });
    console.log(`Ready. Inspect forwarding/conflicts: journalctl -u ${service} -f`);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { setup(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
