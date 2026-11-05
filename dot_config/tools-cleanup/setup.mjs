import { requireSystemPython } from '../my-opencode/prerequisites.mjs';
import { requireTaskPlatform } from '../my-opencode/platform.mjs';
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scannerSession } from './windows-scan.mjs';

// Deliberately only compare ordinary numeric releases, never refs or prereleases.
export function older(a, b) {
  if (!/^\d+(\.\d+)*$/.test(a) || !/^\d+(\.\d+)*$/.test(b)) return false;
  const x = a.split('.').map(BigInt), y = b.split('.').map(BigInt);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0n) !== (y[i] ?? 0n)) return (x[i] ?? 0n) < (y[i] ?? 0n);
  }
  return false;
}

function records(data) {
  if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error('Unexpected mise JSON');
  return Object.entries(data).flatMap(([tool, rows]) => {
    if (!Array.isArray(rows)) throw new Error('Unexpected mise tool records');
    return rows.map(row => {
      if (typeof row.version !== 'string' || typeof row.install_path !== 'string') {
        throw new Error('Missing mise version/install_path');
      }
      return { ...row, tool };
    });
  });
}

export function plan(installed, global, sources, prunable) {
  const all = records(installed).filter(r => r.installed);
  const pins = records(global);
  if (!pins.length || pins.some(r => !r.installed)) throw new Error('Global configured tools must be installed first');
  const protectedRows = [...pins, ...records(sources)];
  const allowed = new Set(records(prunable).map(r => `${r.tool}@${r.version}`));
  const candidates = [], kept = [];
  for (const row of all) {
    const id = `${row.tool}@${row.version}`;
    if (!pins.some(p => p.tool === row.tool && older(row.version, p.version))) continue;
    if (protectedRows.some(p => p.tool === row.tool && p.version === row.version)) {
      kept.push(id);
    } else {
      // Keep busy versions in the plan so the skip reason can be reported.
      candidates.push({ ...row, id, prunable: allowed.has(id) });
    }
  }
  return { candidates, kept };
}

export function main({ platform = process.platform, args = process.argv.slice(2), execute = execFileSync, canonical = realpathSync, elevate } = {}) {
  requireTaskPlatform('tools:cleanup', ['linux', 'windows'], platform);
  const execFileSync = execute;
  const realpathSync = canonical;
  const samePath = (a, b) => platform === 'win32'
    ? a.replaceAll('\\', '/').toLowerCase() === b.replaceAll('\\', '/').toLowerCase()
    : a === b;
  if (args.length > 1 || args.some(a => !['--apply', '--dry-run'].includes(a))) {
    throw new Error('Usage: tools:cleanup [--dry-run | --apply]');
  }
  if (platform === 'linux') requireSystemPython('tools:cleanup', execute);
  const apply = args.includes('--apply');
  const mise = args => JSON.parse(execFileSync('mise', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));
  const snapshot = () => plan(
    mise(['ls', '--installed', '--json']),
    mise(['ls', '--global', '--json']),
    mise(['ls', '--all-sources', '--json']),
    mise(['ls', '--prunable', '--json']),
  );
  const initial = snapshot();
  for (const id of initial.kept) console.log(`KEEP ${id}: required by tracked configuration`);
  if (!initial.candidates.length) return console.log('No unused older versions to remove.');
  let removed = 0, skipped = 0, failed = 0, eligible = 0;
  const candidates = initial.candidates.filter(row => {
    try {
      if (samePath(realpathSync(row.install_path), row.install_path)) return true;
    } catch { /* Missing or inaccessible paths must not be uninstalled. */ }
    skipped++;
    console.log(`SKIP ${row.id}: install path is symlinked or cannot be verified`);
    return false;
  });
  if (!candidates.length) return console.log(`Summary: 0 removed, ${skipped} skipped, 0 failed.`);
  // sudo -v can require a password even with NOPASSWD permissions. Probe an
  // actual command first; only authenticate interactively when necessary.
  if (platform === 'linux') try {
    execFileSync('sudo', ['-n', '/usr/bin/true'], { stdio: 'ignore' });
  } catch {
    // Authenticate on the terminal, never capture or handle the sudo password.
    execFileSync('sudo', ['-v'], { stdio: 'inherit' });
  }
  const scanner = readFileSync(join(dirname(fileURLToPath(import.meta.url)), platform === 'win32' ? 'scan.ps1' : 'scan.py'), 'utf8');
  let useElevation = false;
  let session;
  const elevated = (scanner, input, execute) => {
    if (elevate) return elevate(scanner, input, execute);
    session ??= scannerSession(scanner, execute);
    return session.scan(scanner, input);
  };
  const check = rows => {
    console.log(`CHECK process use: ${rows.length} installation(s)`);
    const command = platform === 'win32' ? 'powershell.exe' : 'sudo';
    const args = platform === 'win32'
      ? ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(scanner, 'utf16le').toString('base64')]
      : ['-n', '/usr/bin/python3', '-c', scanner];
    let output;
    const input = JSON.stringify(rows.map(r => ({ id: r.id, path: r.install_path })));
    try { output = useElevation ? elevated(scanner, input, execFileSync) : execFileSync(command, args, {
      input,
      encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
      timeout: 120_000,
    }); } catch (error) {
      throw new Error(`Process inspection failed${error.code === 'ETIMEDOUT' ? ' (timed out)' : ''}; cleanup stopped before uninstalling unchecked versions.`);
    }
    let result = JSON.parse(output);
    if (platform === 'win32' && !useElevation && result.some(hit => hit.kind === 'inspection unavailable')) {
      useElevation = true;
      result = JSON.parse(elevated(scanner, input, execFileSync));
    }
    if (!Array.isArray(result) || result.some(r => !rows.some(row => row.id === r.id) || !Number.isInteger(r.pid) || typeof r.kind !== 'string')) {
      throw new Error('Invalid process scanner result; cleanup stopped');
    }
    return result;
  };
  try {
  const busy = check(candidates);
  for (const row of candidates) {
    console.log(`CHECK ${row.id}`);
    const skip = reason => { skipped++; console.log(`SKIP ${row.id}: ${reason}`); };
    const hits = busy.filter(hit => hit.id === row.id);
    if (hits.length) {
      const unknown = hits.filter(h => h.kind === 'inspection unavailable');
      if (unknown.length) skip(`cannot verify use: ${unknown.length} inaccessible process(es); try an Administrator terminal for greater visibility`);
      else skip(`in use: ${hits.map(h => `PID ${h.pid} (${h.kind})`).join(', ')}`);
      continue;
    }
    if (!row.prunable) { skip('Mise does not consider this version prunable'); continue; }
    if (!apply) { eligible++; console.log(`WOULD REMOVE ${row.id}`); continue; }
    // Earlier uninstalls change the inventory. Re-plan rather than compare the
    // entire original snapshot, and recheck use immediately before each removal.
    const fresh = snapshot().candidates.find(r => r.id === row.id && r.install_path === row.install_path);
    if (!fresh?.prunable) { skip('no longer eligible under current configuration'); continue; }
    try {
      if (!samePath(realpathSync(row.install_path), row.install_path)) { skip('install path changed'); continue; }
    } catch { skip('install path cannot be verified'); continue; }
    const currentHits = check([row]);
    if (currentHits.length) { skip(`now in use: ${currentHits.map(h => `PID ${h.pid} (${h.kind})`).join(', ')}`); continue; }
    try {
      execFileSync('mise', ['uninstall', row.id], { stdio: 'inherit' });
      removed++;
      console.log(`REMOVED ${row.id}`);
    } catch {
      failed++;
      console.error(`SKIP ${row.id}: uninstall failed; continuing with other versions`);
    }
  }
  console.log(`Summary: ${removed} removed, ${skipped} skipped, ${failed} failed${apply ? '' : `, ${eligible} would remove (preview only; use --apply)`}.`);
  if (failed) process.exitCode = 1;
  } finally { session?.close(); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
