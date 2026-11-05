import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';

// Android denies link(2). Exercise the real fallback and exclusive rename syscall.
test('Termux publication preserves its source and never overwrites a racing winner', {skip: process.platform !== 'android'}, () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 't3-native-test-'));
  try {
    const native = new URL('../dot_config/t3code/native/', import.meta.url);
    const headers = path.resolve(path.dirname(process.execPath), '../include/node');
    const compile = spawnSync('clang', ['-shared', '-fPIC', '-I', headers, '-o', path.join(temp, 'rename.node'), new URL('rename.c', native).pathname], {encoding: 'utf8'});
    assert.equal(compile.status, 0, compile.stderr);
    fs.copyFileSync(new URL('preload.cjs', native), path.join(temp, 'preload.cjs'));
    const script = `
      const assert = require('node:assert/strict');
      const fs = require('node:fs');
      const source = process.argv[1] + '/source';
      const dest = process.argv[1] + '/destination';
      fs.writeFileSync(source, 'complete secret', {mode: 0o600});
      fs.linkSync(source, dest);
      assert.equal(fs.readFileSync(source, 'utf8'), 'complete secret');
      assert.equal(fs.readFileSync(dest, 'utf8'), 'complete secret');
      assert.equal(fs.statSync(dest).mode & 0o777, 0o600);
      fs.writeFileSync(source, 'replacement');
      assert.throws(() => fs.linkSync(source, dest), {code: 'EEXIST'});
      assert.equal(fs.readFileSync(dest, 'utf8'), 'complete secret');
      Promise.allSettled(Array.from({length: 12}, () => fs.promises.link(source, dest + '-race'))).then(results => {
        assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
        for (const r of results.filter(r => r.status === 'rejected')) assert.equal(r.reason.code, 'EEXIST');
        assert.equal(fs.readFileSync(dest + '-race', 'utf8'), 'replacement');
        assert.deepEqual(fs.readdirSync(process.argv[1]).filter(n => n.includes('.t3-publish-')), []);
      }).catch(e => { console.error(e); process.exitCode = 1; });
    `;
    const result = spawnSync(process.execPath, ['--require', path.join(temp, 'preload.cjs'), '-e', script, temp], {encoding: 'utf8'});
    assert.equal(result.status, 0, result.stderr);
  } finally {
    fs.rmSync(temp, {recursive: true, force: true});
  }
});
