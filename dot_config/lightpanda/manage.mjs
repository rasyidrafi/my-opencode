import { spawnSync } from 'node:child_process';

const name = 'lightpanda';
const image = 'docker.io/lightpanda/browser:nightly';
const label = 'io.my-opencode.managed=lightpanda';
const runtime = process.platform === 'win32' ? 'wslc.exe' : 'docker';

function containerRuntime(args, capture = false) {
  const result = spawnSync(runtime, args, {
    encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.error) throw new Error(`${runtime} unavailable: ${result.error.message}. ${process.platform === 'win32' ? 'Install/update WSL (2.9.3+).' : 'Install Docker Engine and ensure your user can access its daemon.'}`);
  if (result.status !== 0) throw new Error(`${runtime} ${args.slice(0, 2).join(' ')} failed (${result.status}). ${capture ? result.stderr.trim() : ''}`);
  return result.stdout;
}

async function main() {
  if (!['win32', 'linux'].includes(process.platform)) throw new Error('Lightpanda tasks support Windows (WSLC) and Linux (Docker) only.');
  const action = process.argv[2];
  if (!['start', 'stop', 'status', 'update'].includes(action)) throw new Error('Usage: manage.mjs start|stop|status|update');
  const ids = containerRuntime(['container', 'list', '--all', '--quiet'], true).trim().split(/\s+/).filter(Boolean);
  let existing;
  for (const id of ids) {
    const data = JSON.parse(containerRuntime(['container', 'inspect', id], true));
    const container = Array.isArray(data) ? data[0] : data;
    if (container.Name?.replace(/^\//, '') === name) existing = container;
  }
  if (existing && existing.Config?.Labels?.['io.my-opencode.managed'] !== 'lightpanda') {
    throw new Error('A container named lightpanda exists but is not managed by this helper. Rename it before using these tasks.');
  }
  if (action === 'status') {
    console.log(existing ? `Lightpanda: ${existing.State.Status}; CDP: 127.0.0.1:9222` : 'Lightpanda: not created. Run mise run lightpanda:start.');
    return;
  }
  if (action === 'stop') {
    if (existing?.State.Running) containerRuntime(['container', 'stop', name]);
    else console.log('Lightpanda is already stopped.');
    return;
  }
  if (action === 'update') {
    // Pull first so a failed download leaves the current container intact.
    containerRuntime(['image', 'pull', image]);
    if (existing) {
      if (existing.State.Running) containerRuntime(['container', 'stop', name]);
      containerRuntime(['container', 'remove', name]);
      existing = undefined;
    }
  }
  if (!existing) {
    containerRuntime(['run', '-d', '--name', name, '--label', label, '-p', '127.0.0.1:9222:9222', image]);
  } else if (!existing.State.Running) {
    containerRuntime(['container', 'start', name]);
  }
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const response = await fetch('http://127.0.0.1:9222/json/version', { signal: AbortSignal.timeout(2000) });
      const data = await response.json();
      if (response.ok && data.webSocketDebuggerUrl) {
        console.log(`Lightpanda ready: ${data.webSocketDebuggerUrl}`);
        return;
      }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`CDP did not become ready. Check: ${runtime} container logs lightpanda`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
