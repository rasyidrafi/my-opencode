import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const runtime = process.platform === 'win32' ? 'wslc.exe' : 'docker';
const image = 'docker.io/lightpanda/browser:nightly';
const owner = 'io.my-opencode.managed=lightpanda';
const lifecycle = 'io.my-opencode.lifecycle=ephemeral';

function run(args, capture = true) {
  const r = spawnSync(runtime, args, { encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
  if (r.error) throw new Error(runtime + ' unavailable; install/start the container runtime: ' + r.error.message);
  if (r.status !== 0) throw new Error(runtime + ' command failed: ' + (r.stderr?.trim() || r.status));
  return r.stdout?.trim();
}
function inspect(id) {
  const data = JSON.parse(run(['container', 'inspect', id]));
  return Array.isArray(data) ? data[0] : data;
}
function managed() {
  const ids = run(['container', 'list', '--all', '--quiet', '--filter', 'label=' + owner, '--filter', 'label=' + lifecycle]);
  return ids ? ids.split(/\s+/).map(inspect) : [];
}
function describe(c) {
  // Docker nests ports; WSLC exposes them at the top level.
  const binding = (c.NetworkSettings?.Ports ?? c.Ports)?.['9222/tcp']?.find(p => p.HostIp === '127.0.0.1');
  const port = Number(binding?.HostPort);
  return {
    task: c.Name.replace(/^\/?lightpanda-/, ''),
    container: c.Name.replace(/^\//, ''),
    status: c.State.Status,
    cdpUrl: Number.isInteger(port) && port > 0 ? 'ws://127.0.0.1:' + port + '/' : null,
  };
}
async function main() {
  if (!['win32', 'linux'].includes(process.platform)) throw new Error('Supported platforms: Windows (WSLC), Linux (Docker).');
  const [action, suppliedTask, ...extra] = process.argv.slice(2);
  if (!['start', 'stop', 'status', 'update'].includes(action) || extra.length) throw new Error('Usage: start [task-id] | stop <task-id> | status [task-id] | update');
  if (suppliedTask && !/^[a-z0-9][a-z0-9-]{0,62}$/.test(suppliedTask)) throw new Error('Task ID: 1-63 lowercase letters/digits/hyphens, starting with a letter/digit.');
  if (action === 'update') {
    if (suppliedTask) throw new Error('update takes no task ID.');
    run(['image', 'pull', image], false);
    return;
  }
  if (action === 'stop' && !suppliedTask) throw new Error('stop requires a task ID.');
  const task = suppliedTask || (action === 'start' ? randomUUID() : undefined);
  const name = task ? 'lightpanda-' + task : undefined;
  const containers = managed();
  const existing = containers.find(c => c.Name.replace(/^\//, '') === name);
  if (action === 'status') {
    console.log(JSON.stringify((task ? containers.filter(c => c === existing) : containers).map(describe)));
    return;
  }
  if (action === 'stop') {
    if (existing) {
      run(['container', existing.State.Running ? 'stop' : 'remove', existing.Id]);
      if (managed().some(c => c.Id === existing.Id)) throw new Error('Container was not removed: ' + name);
    }
    console.log(JSON.stringify({ task, removed: Boolean(existing) }));
    return;
  }
  if (existing) throw new Error('Task already exists. Use status to reuse its CDP URL or choose a new ID: ' + task);
  let createdId;
  try {
    const output = run(['run', '-d', '--rm', '--name', name, '--label', owner, '--label', lifecycle, '-p', '127.0.0.1::9222', image]);
    createdId = output.split(/\r?\n/).findLast(line => /^[a-f0-9]{64}$/.test(line.trim()))?.trim();
    if (!createdId) throw new Error('Cannot read container ID. Inspect ' + name + '; clean up with lightpanda:stop ' + task);
    for (let attempt = 0; attempt < 30; attempt++) {
      const c = inspect(createdId);
      if (!c.State.Running) throw new Error('Container exited before CDP became ready.');
      const info = describe(c);
      if (info.cdpUrl) {
        try {
          const response = await fetch(info.cdpUrl.replace('ws:', 'http:') + 'json/version', { signal: AbortSignal.timeout(1500) });
          const data = await response.json();
          if (response.ok && data.webSocketDebuggerUrl) {
            const endpoint = new URL(data.webSocketDebuggerUrl);
            const host = new URL(info.cdpUrl);
            endpoint.hostname = host.hostname;
            endpoint.port = host.port;
            console.log(JSON.stringify({ ...info, cdpUrl: endpoint.href }));
            return;
          }
        } catch {}
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error('CDP readiness timeout.');
  } catch (error) {
    if (createdId) {
      try { run(['container', 'remove', '--force', createdId]); }
      catch (cleanup) { console.error('Cleanup failed: ' + cleanup.message + '. Run lightpanda:stop ' + task); }
    }
    throw error;
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
