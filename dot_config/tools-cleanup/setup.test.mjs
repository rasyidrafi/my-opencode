import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { older, plan } from './setup.mjs';

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
test('Linux process scan detects a process using a candidate working directory', async () => {
  if (process.platform !== 'linux') return;
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

for (const mode of ['preview', 'busy', 'denied', 'interactive-auth', 'apply', 'uninstall-failure', 'not-prunable', 'config-changed', 'scan-denied']) {
  test(`CLI ${mode}: safe preflight before uninstall`, () => {
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
