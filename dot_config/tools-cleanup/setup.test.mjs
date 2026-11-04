import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { older, plan, main } from './setup.mjs';

const row = (version, extra = {}) => ({ version, install_path: `/tools/demo/${version}`, installed: true, ...extra });
test('numeric comparison is conservative and does not mistake 1.10 for 1.1', () => {
  assert.equal(older('1.9', '1.10'), true);
  assert.equal(older('2.0', '1.10'), false);
  assert.equal(older('1.0', '1.0.0'), false);
  assert.equal(older('1.0-beta', '2.0'), false);
});
test('keep global pin, tracked project versions, newer versions, and removed tools', () => {
  const result = plan(
    { demo: [row('1'), row('2'), row('3'), row('4')], orphan: [row('1')] },
    { demo: [row('3')] },
    { demo: [row('2'), row('3')] },
    { demo: [row('1')] },
  );
  assert.deepEqual(result.candidates.map(r => r.id), ['demo@1']);
  assert.deepEqual(result.kept, ['demo@2']);
});
test('busy old versions remain candidates so skips can be reported', () => {
  const result = plan({ demo: [row('1'), row('2')] }, { demo: [row('2')] }, {}, {});
  assert.equal(result.candidates[0].prunable, false);
});
test('missing pins and malformed inventories fail closed', () => {
  assert.throws(() => plan({}, { demo: [row('2', { installed: false })] }, {}, {}));
  assert.throws(() => plan({}, {}, {}, {}));
  assert.throws(() => plan({ demo: [{}] }, {}, {}, {}));
});
test('Linux process scan detects a process using a candidate working directory', { skip: process.platform !== 'linux' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tools-cleanup-'));
  const child = spawn('/bin/sleep', ['30'], { cwd: dir });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  try {
    const scanner = fileURLToPath(new URL('./scan.py', import.meta.url));
    const code = `import runpy,json,sys; m=runpy.run_path(sys.argv[1]); print(json.dumps(m['scan'](json.loads(sys.argv[2]), sys.argv[3])))`;
    // Restrict fixture proc to this same-user process; no root or real-home writes.
    const proc = join(dir, 'proc');
    mkdirSync(proc);
    symlinkSync(`/proc/${child.pid}`, join(proc, String(child.pid)));
    const hits = JSON.parse(execFileSync('python3', ['-B', '-c', code, scanner, JSON.stringify([{ id: 'demo@1', path: dir }]), proc], { encoding: 'utf8' }));
    assert.ok(hits.some(h => h.pid === child.pid && h.kind === 'cwd'));
  } finally {
    child.kill();
    await new Promise(resolve => child.once('exit', resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('scanner skips permission-denied zombies but refuses inaccessible live processes', { skip: process.platform !== 'linux' }, () => {
  const scanner = fileURLToPath(new URL('./scan.py', import.meta.url));
  const code = `import runpy,sys,errno,io
from unittest.mock import patch
scan=runpy.run_path(sys.argv[1])['scan']
for state in ['Z', 'S']:
    with patch('os.listdir', return_value=['123']), patch('os.readlink', side_effect=PermissionError(errno.EACCES, 'denied')), patch('builtins.open', return_value=io.StringIO('State:\\t'+state+' (state)\\n')):
        try:
            assert scan([]) == []
            assert state == 'Z'
        except PermissionError:
            assert state == 'S'
`;
  execFileSync('python3', ['-B', '-c', code, scanner]);
});

for (const mode of ['preview', 'busy', 'denied', 'interactive-auth', 'apply', 'uninstall-failure', 'not-prunable', 'config-changed', 'scan-denied']) {
  test(`CLI ${mode}: safe preflight before uninstall`, { skip: process.platform !== 'linux' }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'tools-cleanup-cli-'));
    try {
      const old = join(dir, '1'), other = join(dir, '2'), current = join(dir, '3');
      mkdirSync(old); mkdirSync(other); mkdirSync(current);
      const marker = join(dir, 'uninstalled');
      const inventory = { demo: [row('1', { install_path: old }), row('2', { install_path: other }), row('3', { install_path: current })] };
      const configured = { demo: [inventory.demo[2]] };
      const prunable = { demo: mode === 'not-prunable' ? [inventory.demo[1]] : inventory.demo.slice(0, 2) };
      writeFileSync(join(dir, 'mise'), `#!${process.execPath}
const fs=require('fs'), a=process.argv.slice(2), marker=${JSON.stringify(marker)};
if(a[0]==='uninstall') {
  fs.appendFileSync(marker,a[1]+'\\n');
  if(${JSON.stringify(mode)}==='uninstall-failure' && a[1]==='demo@1') process.exit(1);
} else {
  let result=a.includes('--installed')?${JSON.stringify(inventory)}:a.includes('--prunable')?${JSON.stringify(prunable)}:${JSON.stringify(configured)};
  const counter=${JSON.stringify(join(dir, 'calls'))};
  const calls=fs.existsSync(counter)?Number(fs.readFileSync(counter,'utf8')):0;
  fs.writeFileSync(counter,String(calls+1));
  if(${JSON.stringify(mode)}==='config-changed' && calls>=4 && a.includes('--all-sources')) result=${JSON.stringify(inventory)};
  console.log(JSON.stringify(result));
}

`, { mode: 0o700 });
      writeFileSync(join(dir, 'sudo'), `#!${process.execPath}
const fs=require('fs'), mode=${JSON.stringify(mode)};
if(process.argv[3]==='/usr/bin/true') {
  fs.writeFileSync(${JSON.stringify(join(dir, 'authenticated'))},'probed');
  process.exit(['denied','interactive-auth'].includes(mode)?1:0);
}
if(process.argv[2]==='-v') {
  fs.writeFileSync(${JSON.stringify(join(dir, 'authenticated'))},'prompted');
  process.exit(mode==='denied'?1:0);
}
if(mode==='scan-denied') process.exit(1);
const targets=JSON.parse(fs.readFileSync(0,'utf8'));
console.log(JSON.stringify(mode==='busy' && targets.some(r=>r.id==='demo@1')?[{id:'demo@1',pid:123,kind:'exe'}]:[]));
`, { mode: 0o700 });
      const script = fileURLToPath(new URL('./setup.mjs', import.meta.url));
      const run = () => execFileSync(process.execPath, [script, ...(mode === 'preview' ? [] : ['--apply'])], {
        env: { ...process.env, PATH: `${dir}:${process.env.PATH}` }, encoding: 'utf8', stdio: 'pipe',
      });
      let output;
      if (['denied', 'scan-denied', 'uninstall-failure'].includes(mode)) {
        assert.throws(run, error => { output = error.stdout; return true; });
      } else output = run();
      assert.equal(existsSync(join(dir, 'authenticated')), true);
      assert.equal(readFileSync(join(dir, 'authenticated'), 'utf8'), ['denied', 'interactive-auth'].includes(mode) ? 'prompted' : 'probed');
      const attempted = existsSync(marker) ? readFileSync(marker, 'utf8').trim().split('\n') : [];
      if (['preview', 'denied', 'scan-denied', 'config-changed'].includes(mode)) assert.deepEqual(attempted, []);
      else if (['busy', 'not-prunable'].includes(mode)) {
        assert.deepEqual(attempted, ['demo@2']);
        assert.match(output, /SKIP demo@1/);
      } else assert.deepEqual(attempted, ['demo@1', 'demo@2']);
      if (mode === 'preview') assert.match(output, /2 would remove/);
      if (mode === 'uninstall-failure') assert.match(output, /1 removed, 0 skipped, 1 failed/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

for (const mode of ['preview', 'apply', 'busy', 'unknown', 'config-changed', 'scan-denied']) {
  test(`Windows ${mode}: rechecks configuration and use before removal`, () => {
    const old = row('1', { install_path: 'C:/mise/installs/demo/1' });
    const pin = row('2', { install_path: 'C:/mise/installs/demo/2' });
    const calls = [];
    let snapshots = 0;
    const execute = (command, args) => {
      calls.push([command, args]);
      if (command === 'powershell.exe') {
        if (mode === 'scan-denied') throw new Error('scan denied');
        return JSON.stringify(mode === 'busy' ? [{ id: 'demo@1', pid: 123, kind: 'open file' }]
          : mode === 'unknown' ? [{ id: 'demo@1', pid: 123, kind: 'inspection unavailable' }] : []);
      }
      assert.equal(command, 'mise');
      if (args[0] === 'uninstall') return '';
      if (args.includes('--installed')) { snapshots++; return JSON.stringify({ demo: [old, pin] }); }
      if (args.includes('--prunable')) return JSON.stringify({ demo: [old] });
      if (args.includes('--all-sources') && mode === 'config-changed' && snapshots > 1) return JSON.stringify({ demo: [old, pin] });
      return JSON.stringify({ demo: [pin] });
    };
    const run = () => main({ platform: 'win32', args: mode === 'preview' ? [] : ['--apply'], execute,
      elevate: () => JSON.stringify([{ id: 'demo@1', pid: 123, kind: 'inspection unavailable' }]),
      canonical: value => value.replaceAll('/', '\\').toUpperCase() });
    if (mode === 'scan-denied') assert.throws(run, /Process inspection failed/); else run();
    const removals = calls.filter(([, args]) => args[0] === 'uninstall');
    assert.equal(removals.length, mode === 'apply' ? 1 : 0);
    assert.ok(calls.every(([command]) => !['sudo', 'python3'].includes(command)));
    if (mode === 'apply') assert.equal(calls.filter(([command]) => command === 'powershell.exe').length, 2);
  });
}

test('Windows process scan detects executable, loaded modules and script arguments without enumerating installs', { skip: process.platform !== 'win32' }, () => {
  const script = readFileSync(fileURLToPath(new URL('./scan.ps1', import.meta.url)), 'utf8');
  assert.ok(!script.includes('Get-ChildItem'));
  assert.ok(!script.includes('RmRegisterResources'));
  const dir = mkdtempSync(join(tmpdir(), 'cleanup-process-'));
  const childScript = join(dir, 'fixture.cjs');
  writeFileSync(childScript, 'setInterval(() => {}, 1000)');
  const child = spawn(process.execPath, [childScript], { stdio: 'ignore' });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('spawn', () => {
      try {
        const hits = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
          input: JSON.stringify([{ id: 'script@1', path: dir }, { id: 'node@1', path: join(process.execPath, '..') }]), encoding: 'utf8', windowsHide: true, timeout: 30_000,
        }));
        assert.ok(hits.some(hit => hit.id === 'script@1' && hit.pid === child.pid && hit.kind === 'argument'));
        assert.ok(hits.some(hit => hit.id === 'node@1' && hit.pid === child.pid && hit.kind === 'executable'));
        assert.ok(hits.some(hit => hit.id === 'node@1' && hit.pid === child.pid && hit.kind === 'loaded module'));
        assert.ok(hits.every(hit => Object.keys(hit).sort().join(',') === 'id,kind,pid'));
        resolve();
      } catch (error) { reject(error); }
      finally { child.kill(); }
    });
  }).finally(async () => {
    if (child.exitCode === null) await new Promise(resolve => child.once('exit', resolve));
    rmSync(dir, { recursive: true, force: true });
  });
});
