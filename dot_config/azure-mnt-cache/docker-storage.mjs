import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const storageRoot = '/mnt/docker-storage';
export const stores = ['docker', 'containerd'].map(name => ({
  name, source: `/var/lib/${name}`, target: `${storageRoot}/${name}`, unit: `var-lib-${name}.mount`,
}));
const stateFile = '/etc/azure-mnt-cache/docker-storage.json';
const readyFile = `${storageRoot}/.ready`;

// Bind mounts preserve Docker's existing absolute volume/layer paths. Both
// services fail closed if /mnt or the completed migration marker is missing.
export function systemdFiles() {
  const files = {};
  for (const store of stores) {
    files[`/etc/systemd/system/${store.unit}`] = `[Unit]\nDescription=Docker storage on /mnt (${store.name})\nRequires=mnt.mount\nAfter=mnt.mount\nBefore=${store.name}.service\n\n[Mount]\nWhat=${store.target}\nWhere=${store.source}\nType=none\nOptions=bind\n`;
    files[`/etc/systemd/system/${store.name}.service.d/azure-mnt-storage.conf`] = `[Unit]\nRequires=${store.unit}\nAfter=${store.unit}\n\n[Service]\nExecStartPre=/usr/bin/test -f ${readyFile}\n`;
  }
  return files;
}

function run(command, args, { allowFailure = false, ...options } = {}) {
  const env = { ...process.env, LC_ALL: 'C' };
  for (const key of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete env[key];
  const result = spawnSync(command, args, { encoding: 'utf8', env, maxBuffer: 16 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) {
    if (allowFailure) return null;
    // Command output may contain private container details; don't echo it.
    throw new Error(`${command} ${args[0] || ''} failed (${result.error?.code || result.status}).`);
  }
  return (result.stdout || '').trim();
}
const docker = args => run('/usr/bin/docker', ['--host', 'unix:///var/run/docker.sock', ...args]);
const sorted = text => [...new Set(text.split('\n').filter(Boolean))].sort();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function safePath(target) {
  let current = '/';
  for (const part of path.resolve(target).split('/').filter(Boolean)) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) {
      // existsSync is false for a dangling symlink too.
      try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Symlink refused: ${current}`); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      continue;
    }
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || stat.uid !== 0 || (stat.mode & 0o022)) throw new Error(`Expected a root-owned, non-writable path: ${current}`);
  }
}
function write(target, content) {
  safePath(target);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o755 });
  const temporary = `${target}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(temporary, content, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, target);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
function state() {
  safePath(stateFile);
  return fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : null;
}
function mounts() {
  return JSON.parse(run('findmnt', ['--json', '--list', '--output', 'TARGET,SOURCE,FSTYPE'])).filesystems;
}
function isBound(store) {
  if (!mounts().some(mount => mount.target === store.source)) return false;
  const source = fs.statSync(store.source);
  const target = fs.statSync(store.target);
  if (source.dev !== target.dev || source.ino !== target.ino) throw new Error(`Unexpected mount at ${store.source}.`);
  return true;
}
function inventory() {
  const info = JSON.parse(docker(['info', '--format', '{{json .}}']));
  if (info.DockerRootDir !== '/var/lib/docker') throw new Error('Only the native /var/lib/docker daemon layout is supported.');
  return {
    id: info.ID,
    containers: sorted(docker(['ps', '--all', '--quiet', '--no-trunc'])),
    running: sorted(docker(['ps', '--quiet', '--no-trunc'])),
    images: sorted(docker(['image', 'ls', '--all', '--quiet', '--no-trunc'])),
    volumes: sorted(docker(['volume', 'ls', '--quiet'])),
  };
}

export function checkInventory(before, after) {
  for (const key of ['id', 'containers', 'images', 'volumes']) {
    if (!same(before[key], after[key])) throw new Error(`Docker ${key} changed during migration; storage retained on /mnt for investigation.`);
  }
  if (!before.running.every(id => after.running.includes(id))) throw new Error('Some previously running containers did not restart.');
}

export function moveStore(store, execute = run) {
  // rsync validates each transfer before removing its source. Checksums also
  // detect a partially copied destination on a subsequent forward-only retry.
  execute('rsync', ['-aHAXx', '--sparse', '--checksum', '--numeric-ids', '--remove-source-files', `${store.source}/`, `${store.target}/`]);
  const remaining = execute('find', [store.source, '-xdev', '-mindepth', '1', '!', '-type', 'd', '-print', '-quit']);
  if (remaining) throw new Error(`Unmoved files remain in ${store.source}.`);
  for (const entry of fs.readdirSync(store.source)) fs.rmSync(path.join(store.source, entry), { recursive: true });
  if (fs.readdirSync(store.source).length) throw new Error(`Source cleanup incomplete: ${store.source}`);
}

// No backup or rollback tree: rsync removes only successfully transferred files.
// An interrupted migration retains its inventory and resumes forward on rerun.
export async function migrate(io, { dryRun = false } = {}) {
  const plan = io.preflight();
  if (dryRun) return { ...plan, dryRun: true };
  if (plan.complete) { io.verifyMounts(); return plan; }
  io.prepare(plan);
  try {
    io.stop();
    io.move();
    io.mount();
    io.start();
    await io.verify();
    io.finish();
  } catch (error) {
    throw new Error(`${error.message} Migration was not rolled back. Rerun this task to finish; do not delete the migration state or /mnt/docker-storage.`);
  }
  return { ...plan, complete: true };
}

export function runtime() {
  let saved;
  let before;
  return {
    preflight() {
      if (process.platform !== 'linux' || process.getuid() !== 0) throw new Error('Docker storage migration requires Linux root access.');
      if (!fs.existsSync('/run/systemd/system')) throw new Error('A systemd host is required.');
      if (run('systemd-detect-virt', ['--container'], { allowFailure: true }) !== null) throw new Error('Run Docker storage migration on the host, not inside a container.');
      if (run('mountpoint', ['--quiet', '/mnt'], { allowFailure: true }) === null) throw new Error('/mnt must be mounted.');
      if (fs.statSync('/mnt').dev === fs.statSync('/').dev) throw new Error('/mnt must use a different filesystem from root.');
      run('rsync', ['--version']);
      for (const target of [storageRoot, ...stores.flatMap(s => [s.source, s.target]), ...Object.keys(systemdFiles())]) safePath(target);
      saved = state();
      if (saved && (saved.version !== 1 || saved.root !== storageRoot || !['moving', 'complete'].includes(saved.status))) throw new Error('Unrecognized Docker storage migration state.');
      if (!saved && fs.existsSync(storageRoot) && fs.readdirSync(storageRoot).length) throw new Error(`${storageRoot} already contains unrelated data.`);
      for (const [target, content] of Object.entries(systemdFiles())) {
        if (fs.existsSync(target) && fs.readFileSync(target, 'utf8') !== content) throw new Error(`Conflicting systemd configuration: ${target}`);
      }
      if (saved?.status === 'complete') {
        this.verifyMounts();
        docker(['info', '--format', '{{.ID}}']);
        return { complete: true, root: storageRoot };
      }
      if (!saved) {
        // Refuse custom containerd roots/arguments and non-Docker workloads.
        const command = run('systemctl', ['show', 'containerd.service', '--property=ExecStart', '--value']);
        if (!/argv\[\]=\/usr\/bin\/containerd\s*;/.test(command)) throw new Error('Custom containerd service command is unsupported.');
        const dump = run('/usr/bin/containerd', ['config', 'dump']);
        if (!/^root\s*=\s*['"]\/var\/lib\/containerd['"]\s*$/m.test(dump)) throw new Error('Custom containerd root is unsupported.');
        const namespaces = sorted(run('/usr/bin/ctr', ['namespaces', 'list', '--quiet']));
        if (namespaces.some(name => !['moby', 'moby_history'].includes(name))) throw new Error('containerd has non-Docker namespaces; migrate those explicitly.');
        before = inventory();
        for (const id of before.running) {
          const status = JSON.parse(docker(['inspect', '--format', '{{json .State}}', id]));
          const autoRemove = docker(['inspect', '--format', '{{.HostConfig.AutoRemove}}', id]);
          if (status.Paused || status.Restarting || autoRemove === 'true') throw new Error('Paused, restarting or auto-remove containers must be resolved before migration.');
        }
        // External bind data is not Docker-owned. It must already live on /mnt.
        for (const id of before.containers) {
          for (const mount of JSON.parse(docker(['inspect', '--format', '{{json .Mounts}}', id]))) {
            const stat = mount.Type === 'bind' ? fs.statSync(mount.Source) : null;
            if (stat && (stat.isDirectory() || stat.isFile()) && stat.dev !== fs.statSync('/mnt').dev) {
              throw new Error(`Container ${id.slice(0, 12)} has bind data outside /mnt: ${mount.Source}`);
            }
          }
        }
        for (const name of before.volumes) {
          const [volume] = JSON.parse(docker(['volume', 'inspect', name]));
          if (volume.Driver !== 'local') throw new Error(`External volume driver for ${name} is unsupported.`);
          if (volume.Options && Object.keys(volume.Options).length && (volume.Options.o !== 'bind' || !volume.Options.device || fs.statSync(volume.Options.device).dev !== fs.statSync('/mnt').dev)) {
            throw new Error(`Volume ${name} has external storage outside /mnt.`);
          }
        }
      } else {
        before = saved.inventory;
        if (!before?.id || !['containers', 'running', 'images', 'volumes'].every(key => Array.isArray(before[key]))) throw new Error('Invalid migration inventory.');
      }
      let bytes = 0;
      for (const store of stores) {
        if (!fs.existsSync(store.source)) throw new Error(`Missing native storage: ${store.source}`);
        if (!saved && mounts().some(m => m.target === store.source)) throw new Error(`Existing mount at ${store.source} is not managed by this task.`);
        if (!isBound(store)) bytes += Number(run('du', ['--summarize', '--one-file-system', '--block-size=1', store.source]).split(/\s/)[0]);
      }
      const free = fs.statfsSync('/mnt');
      const available = free.bavail * free.bsize;
      if (available < bytes + 1024 ** 3) throw new Error('Not enough free space on /mnt (requires remaining data plus 1 GiB).');
      return { complete: false, root: storageRoot, bytesToMove: bytes, availableBytes: available, containersToRestart: before.running.length, resuming: Boolean(saved) };
    },
    prepare() {
      fs.mkdirSync(storageRoot, { recursive: true, mode: 0o700 });
      for (const store of stores) fs.mkdirSync(store.target, { recursive: true, mode: 0o700 });
      write(stateFile, JSON.stringify({ version: 1, status: 'moving', root: storageRoot, inventory: before }) + '\n');
      // Install boot guards before moving the first byte. Missing readiness keeps
      // Docker/containerd stopped after an interrupted migration or reboot.
      for (const [target, content] of Object.entries(systemdFiles())) write(target, content);
      run('systemctl', ['daemon-reload']);
    },
    stop() {
      const current = run('/usr/bin/docker', ['--host', 'unix:///var/run/docker.sock', 'ps', '--quiet', '--no-trunc'], { allowFailure: true });
      if (current !== null) checkInventory({ ...before, running: [] }, inventory());
      if (current) docker(['stop', '--time', '60', ...sorted(current)]);
      run('systemctl', ['stop', 'docker.service', 'docker.socket']);
      run('systemctl', ['stop', 'containerd.service']);
      if (fs.existsSync(readyFile)) fs.unlinkSync(readyFile);
      for (const store of stores) {
        const nested = mounts().filter(m => m.target.startsWith(store.source + '/'));
        if (nested.length) throw new Error(`Storage still has mounted children under ${store.source}; refusing to move live files.`);
      }
    },
    move() {
      for (const store of stores) {
        if (isBound(store)) continue;
        // Nested mounts were refused; remove all old files before hiding the root directory.
        moveStore(store);
      }
    },
    mount() {
      run('systemctl', ['start', ...stores.map(s => s.unit)]);
      this.verifyMounts();
      write(readyFile, '1\n');
    },
    verifyMounts() {
      for (const store of stores) {
        if (!isBound(store) || fs.statSync(store.source).dev !== fs.statSync('/mnt').dev) throw new Error(`Storage is not on /mnt: ${store.source}`);
      }
    },
    start() {
      run('systemctl', ['reset-failed', 'containerd.service', 'docker.service', 'docker.socket']);
      run('systemctl', ['start', 'containerd.service', 'docker.service']);
      if (before.running.length) docker(['start', ...before.running]);
    },
    async verify() {
      this.verifyMounts();
      // Allow normal startup, but don't silently accept a container that exits.
      await new Promise(resolve => setTimeout(resolve, 3000));
      checkInventory(before, inventory());
    },
    finish() {
      write(stateFile, JSON.stringify({ version: 1, status: 'complete', root: storageRoot }) + '\n');
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !['--apply', '--dry-run'].includes(args[0])) {
    console.error('Use azure-mnt-cache:setup [--dry-run], or run this helper as root with --apply/--dry-run.');
    process.exitCode = 1;
  } else {
    migrate(runtime(), { dryRun: args[0] === '--dry-run' }).then(result => console.log(JSON.stringify(result)))
      .catch(error => { console.error(error.message); process.exitCode = 1; });
  }
}
