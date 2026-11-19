// E2E for the multi_reviewer virtual subagent against a real isolated OpenCode
// server (same config, separate instance/port, real worker model calls).
// Run: node tests/e2e-multi-reviewer.mjs
import assert from 'node:assert/strict';
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '..');
const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.on('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const port = probe.address().port;
    probe.close(() => resolve(port));
  });
});
const PORT = Number(process.env.E2E_PORT || await freePort());
const BASE = `http://127.0.0.1:${PORT}`;
const REVIEW =
  'Review the file dot_config/opencode/plugins/my-opencode/sanitize.js in /home/bull/projects/my-opencode ' +
  'for correctness bugs. Read it with shell (cat). Keep the review under 120 words.';
const runStart = Date.now();
const created = [];
let failures = 0;
let isolated = false;

const binary = execSync('mise which opencode', { encoding: 'utf8' }).trim();
const logFile = path.join(os.tmpdir(), `fusion-e2e-server-${runStart}.log`);
const logFd = fs.openSync(logFile, 'a');
const env = { ...process.env };
delete env.OPENCODE_SERVER_PASSWORD;
delete env.OPENCODE_PASSWORD;
// Isolated storage/database (same config): the database path follows the data
// directory, not the port, and an inherited absolute OPENCODE_DB would override
// it, so pin the database inside the temporary data dir explicitly.
const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fusion-e2e-data-'));
env.XDG_DATA_HOME = dataHome;
delete env.OPENCODE_DB;
env.OPENCODE_DB = path.join(dataHome, 'e2e.db');
const server = spawn(binary, ['serve', '--hostname', '127.0.0.1', '--port', String(PORT)], {
  cwd: REPO, stdio: ['ignore', logFd, logFd], env,
});
const cleanup = async () => {
  // Fail closed: never send HTTP cleanup to a server we did not provably start.
  if (isolated) {
    for (const id of created) {
      await fetch(`${BASE}/api/session/${id}`, { method: 'DELETE' }).catch(() => {});
    }
    const sessions = await api('GET', '/api/session?limit=500').catch(() => ({ data: [] }));
    for (const s of unwrap(sessions)) {
      if ((s.title || '').startsWith('fusion:') && s.time?.created >= runStart) {
        await fetch(`${BASE}/api/session/${s.id}`, { method: 'DELETE' }).catch(() => {});
      }
    }
  }
  server.kill('SIGTERM');
  fs.rmSync(dataHome, { recursive: true, force: true });
};
const unwrap = j => j?.data ?? j;
async function api(method, p, body) {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? undefined : res.json();
}
async function until(fn, timeoutMs, label, interval = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await new Promise(r => setTimeout(r, interval));
  }
  throw new Error(`timeout after ${timeoutMs}ms: ${label}`);
}
const messages = async sid => unwrap(await api('GET', `/api/session/${sid}/context`));
const assistantTexts = msgs => msgs.filter(m => m.type === 'assistant')
  .map(m => (m.content ?? []).filter(p => p.type === 'text').map(p => p.text).join('\n\n'));
const fusionWorkers = async () => unwrap(await api('GET', '/api/session?limit=500'))
  .filter(s => (s.title || '').startsWith('fusion:') && s.time?.created >= runStart);
const activeIDs = async () => Object.keys(unwrap(await api('GET', '/api/session/active')));
const newSession = async (body) => {
  const s = unwrap(await api('POST', '/api/session', body));
  created.push(s.id);
  return s.id;
};
const check = (name, fn) => {
  try { fn(); console.log(`  ok - ${name}`); }
  catch (error) { failures++; console.log(`  FAIL - ${name}: ${error.message}`); }
};
const assertMasked = (text) => {
  for (const secret of ['rawroute', 'gpt-peak', 'base-flash', 'worker-1', 'worker-2']) {
    assert.ok(!text.includes(secret), `panel reveals ${secret}`);
  }
};

try {
  console.log(`isolated server: ${binary} serve --port ${PORT} (log: ${logFile})`);
  await until(async () => {
    if (server.exitCode !== null) throw new Error(`server exited early (${server.exitCode}); see ${logFile}`);
    try { await api('GET', '/api/session?limit=1'); return true; } catch { return false; }
  }, 60_000, 'server ready');
  // The port must be owned by the spawned child, not a pre-existing server.
  const listener = execSync(`ss -ltnp 'sport = :${PORT}'`, { encoding: 'utf8' });
  assert.ok(listener.includes(`pid=${server.pid},`), `port ${PORT} is not owned by the spawned server`);
  await until(async () => {
    const models = unwrap(await api('GET', '/api/model'));
    return models.some(m => m.providerID === 'simulated' && (m.modelID ?? m.id) === 'multi_reviewer');
  }, 30_000, 'simulated provider registered');
  console.log('server ready, simulated/multi_reviewer registered');
  const initial = unwrap(await api('GET', '/api/session?limit=10'));
  assert.equal(initial.length, 0, 'isolated data dir must start with an empty session database');
  isolated = true;

  console.log('TEST A: direct multi_reviewer session, one fusion round, no wake loop');
  const a = await newSession({ agent: 'multi_reviewer', title: 'E2E A multi_reviewer', location: { directory: REPO } });
  await api('POST', `/api/session/${a}/prompt`, { text: REVIEW });
  const panelA = await until(async () => {
    const texts = assistantTexts(await messages(a));
    return texts.find(t => t.includes('◆ REVIEWS'));
  }, 300_000, 'panel A delivered');
  check('panel has both worker sections', () => {
    assert.ok(panelA.includes('## [Worker A] — REVIEW\n'), 'Worker A review missing');
    assert.ok(panelA.includes('## [Worker B] — REVIEW\n'), 'Worker B review missing');
  });
  check('panel is masked', () => assertMasked(panelA));
  const panelMessage = (await messages(a)).filter(m => m.type === 'assistant')
    .find(m => (m.content ?? []).some(p => p.type === 'text' && p.text.includes('◆ REVIEWS')));
  check('reasoning progress blocks recorded on the assistant message', () => {
    const reasoning = (panelMessage.content ?? []).filter(p => p.type === 'reasoning').map(p => p.text).join('\n');
    assert.ok(reasoning.includes('Invoking Worker A'), 'no worker invoke activity');
    assert.ok(reasoning.includes('Invoking Worker B'), 'no worker invoke activity');
    assertMasked(reasoning);
  });
  const workersA = await fusionWorkers();
  check('exactly two top-level reviewer workers', () => {
    assert.equal(workersA.length, 2);
    for (const w of workersA) {
      assert.ok(!w.parentID, `worker ${w.id} has parentID ${w.parentID}`);
      assert.equal(w.agent, 'reviewer');
    }
  });
  const assistantCountA = assistantTexts(await messages(a)).length;
  const workerCountA = (await fusionWorkers()).length;
  console.log('  stability watch: 25s (wake loop would add rounds here)');
  await new Promise(r => setTimeout(r, 25_000));
  const assistantCountA2 = assistantTexts(await messages(a)).length;
  const workerCountA2 = (await fusionWorkers()).length;
  const activeA = await activeIDs();
  check('session stayed idle with one panel', () => {
    assert.equal(assistantCountA2, assistantCountA, 'assistant turns grew after idle');
    assert.equal(workerCountA2, workerCountA, 'new workers spawned after idle');
    assert.ok(!activeA.includes(a), 'multi_reviewer still active');
  });

  console.log('TEST B: regular review loop via subagent tool from a build parent');
  const b = await newSession({
    agent: 'build', title: 'E2E B parent', location: { directory: REPO },
    model: { providerID: 'rawroute', id: 'base-flash' },
  });
  await api('POST', `/api/session/${b}/prompt`, {
    text: 'Call the subagent tool exactly once with agent "multi_reviewer", description "E2E panel review", ' +
      `and prompt "${REVIEW}" After the tool call returns, end your turn without further commentary. ` +
      'When the subagent report arrives later, reply with exactly DONE and nothing else.',
  });
  const reportB = await until(async () => {
    const msgs = await messages(b);
    const synthetic = msgs.filter(m => m.type === 'synthetic').map(m => m.text ?? '').join('\n');
    return synthetic.includes('<subagent') && synthetic.includes('◆ REVIEWS') ? synthetic : undefined;
  }, 420_000, 'subagent report with panel');
  check('report contains masked panel', () => {
    assert.ok(reportB.includes('## [Worker A] — REVIEW\n'));
    assert.ok(reportB.includes('## [Worker B] — REVIEW\n'));
    assertMasked(reportB);
  });
  const workersB = await fusionWorkers();
  check('exactly two more workers, all top-level', () => {
    assert.equal(workersB.length, 4);
    for (const w of workersB) assert.ok(!w.parentID, `worker ${w.id} has parentID`);
  });

  console.log('TEST C: abort interrupts live workers and spawns nothing new');
  const beforeC = new Set((await fusionWorkers()).map(w => w.id));
  const c = await newSession({ agent: 'multi_reviewer', title: 'E2E C multi_reviewer', location: { directory: REPO } });
  await api('POST', `/api/session/${c}/prompt`, { text: REVIEW });
  // Session lists are ordered by time_updated desc; identify round C by set
  // difference, not position.
  const cWorkers = await until(async () => {
    const workers = (await fusionWorkers()).filter(w => !beforeC.has(w.id));
    if (workers.length < 2) return undefined;
    const active = await activeIDs();
    return workers.every(w => active.includes(w.id)) ? workers : undefined;
  }, 120_000, 'round C workers demonstrably active');
  await api('POST', `/api/session/${c}/interrupt`, {});
  await until(async () => {
    const active = await activeIDs();
    return cWorkers.every(w => !active.includes(w.id)) && !active.includes(c);
  }, 90_000, 'round C workers stopped');
  await new Promise(r => setTimeout(r, 15_000));
  const workersC = await fusionWorkers();
  check('worker count stable after abort', () => assert.equal(workersC.length, 6));

  console.log(failures === 0 ? 'E2E PASS' : `E2E FAIL (${failures} failed checks)`);
} catch (error) {
  failures++;
  console.error('E2E ERROR:', error.message);
  console.error('--- server log tail ---');
  console.error(fs.readFileSync(logFile, 'utf8').split('\n').slice(-40).join('\n'));
} finally {
  await cleanup();
}
process.exit(failures === 0 ? 0 : 1);