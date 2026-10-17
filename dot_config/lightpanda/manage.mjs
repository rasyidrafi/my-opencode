import { spawnSync } from 'node:child_process';

const name = 'lightpanda';
const image = 'docker.io/lightpanda/browser:nightly';
const label = 'io.my-opencode.managed=lightpanda';

function wslc(args, capture = false) {
  const result = spawnSync('wslc.exe', args, {
    encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.error) throw new Error(`WSLC unavailable: ${result.error.message}. Install/update WSL (2.9.3+).`);
  if (result.status !== 0) throw new Error(`wslc ${args.slice(0, 2).join(' ')} failed (${result.status}). ${capture ? result.stderr.trim() : ''}`);
  return result.stdout;
}

async function main() {
  if (process.platform !== 'win32') throw new Error('These Lightpanda tasks support Windows + WSLC only. Linux/macOS setup is not configured.');
  const action = process.argv[2];
  if (!['start', 'stop', 'status', 'update'].includes(action)) throw new Error('Usage: manage.mjs start|stop|status|update');
  const ids = wslc(['container', 'list', '--all', '--quiet'], true).trim().split(/\s+/).filter(Boolean);
  let existing;
  for (const id of ids) {
    const data = JSON.parse(wslc(['container', 'inspect', id], true));
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
    if (existing?.State.Running) wslc(['container', 'stop', name]);
    else console.log('Lightpanda is already stopped.');
    return;
  }
  if (action === 'update') {
    // Pull first so a failed download leaves the current container intact.
    wslc(['image', 'pull', image]);
    if (existing) {
      if (existing.State.Running) wslc(['container', 'stop', name]);
      wslc(['container', 'remove', name]);
      existing = undefined;
    }
  }
  if (!existing) {
    wslc(['run', '-d', '--name', name, '--label', label, '-p', '127.0.0.1:9222:9222', image]);
  } else if (!existing.State.Running) {
    wslc(['container', 'start', name]);
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
  throw new Error('CDP did not become ready. Check: wslc container logs lightpanda');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
