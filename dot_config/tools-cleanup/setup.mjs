import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

function main() {
  if (process.platform !== 'linux') throw new Error('tools:cleanup supports Linux only');
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some(a => !['--apply', '--dry-run'].includes(a))) {
    throw new Error('Usage: tools:cleanup [--dry-run | --apply]');
  }
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
      if (realpathSync(row.install_path) === row.install_path) return true;
    } catch { /* Missing or inaccessible paths must not be uninstalled. */ }
    skipped++;
    console.log(`SKIP ${row.id}: install path is symlinked or cannot be verified`);
    return false;
  });
  if (!candidates.length) return console.log(`Summary: 0 removed, ${skipped} skipped, 0 failed.`);
  // sudo -v can require a password even with NOPASSWD permissions. Probe an
  // actual command first; only authenticate interactively when necessary.
  try {
    execFileSync('sudo', ['-n', '/usr/bin/true'], { stdio: 'ignore' });
  } catch {
    // Authenticate on the terminal, never capture or handle the sudo password.
    execFileSync('sudo', ['-v'], { stdio: 'inherit' });
  }
  const scanner = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'scan.py'), 'utf8');
  const check = rows => {
    const result = JSON.parse(execFileSync('sudo', ['-n', '/usr/bin/python3', '-c', scanner], {
      input: JSON.stringify(rows.map(r => ({ id: r.id, path: r.install_path }))),
      encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    }));
    if (!Array.isArray(result) || result.some(r => !rows.some(row => row.id === r.id) || !Number.isInteger(r.pid) || typeof r.kind !== 'string')) {
      throw new Error('Invalid process scanner result; cleanup stopped');
    }
    return result;
  };
  const busy = check(candidates);
  for (const row of candidates) {
    const skip = reason => { skipped++; console.log(`SKIP ${row.id}: ${reason}`); };
    const hits = busy.filter(hit => hit.id === row.id);
    if (hits.length) { skip(`in use: ${hits.map(h => `PID ${h.pid} (${h.kind})`).join(', ')}`); continue; }
    if (!row.prunable) { skip('Mise does not consider this version prunable'); continue; }
    if (!apply) { eligible++; console.log(`WOULD REMOVE ${row.id}`); continue; }
    // Earlier uninstalls change the inventory. Re-plan rather than compare the
    // entire original snapshot, and recheck use immediately before each removal.
    const fresh = snapshot().candidates.find(r => r.id === row.id && r.install_path === row.install_path);
    if (!fresh?.prunable) { skip('no longer eligible under current configuration'); continue; }
    try {
      if (realpathSync(row.install_path) !== row.install_path) { skip('install path changed'); continue; }
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
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
