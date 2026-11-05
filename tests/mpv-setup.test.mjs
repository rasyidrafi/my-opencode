import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { setup } from '../dot_config/mpv/setup.mjs';

const CONFIG_BLOCK = '# >>> mise mpv:setup (ModernZ) >>>\n# Use ModernZ instead of mpv\'s default on-screen controller.\nosc=no\ntitle-bar=no\n# <<< mise mpv:setup (ModernZ) <<<';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mpv-setup-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const mpv = path.join(bin, 'mpv');
  fs.writeFileSync(mpv, '#!/bin/sh\n');
  fs.chmodSync(mpv, 0o755);
  return { root, bin, home: path.join(root, 'home'), env: { PATH: bin } };
}

function probe(command, args) {
  assert.equal(path.basename(command), 'mpv');
  assert.deepEqual(args, ['--version']);
  return { status: 0, stdout: 'mpv v0.40.0\n', stderr: '' };
}

test('already configured ModernZ is a no-op', async t => {
  const f = fixture(t);
  const configDir = path.join(f.home, '.config/mpv');
  for (const file of ['scripts/modernz.lua', 'fonts/modernz-icons.ttf', 'script-opts/modernz.conf']) {
    const target = path.join(configDir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'existing');
  }
  fs.mkdirSync(path.dirname(path.join(configDir, 'mpv.conf')), { recursive: true });
  fs.writeFileSync(path.join(configDir, 'mpv.conf'), CONFIG_BLOCK + '\n');
  let fetches = 0;
  const messages = [];
  await setup({ ...f, spawn: probe, fetchImpl: async () => { fetches++; throw new Error('unexpected network'); }, log: m => messages.push(m) });
  assert.equal(fetches, 0);
  assert.match(messages[0], /no changes made/);
});

test('installs ModernZ, migrates the old uosc config, and preserves unrelated settings', async t => {
  const f = fixture(t);
  const configDir = path.join(f.home, '.config/mpv');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'mpv.conf'), 'volume=65\n\n# Use uosc instead of mpv\'s default on-screen controller.\nosc=no\nosd-bar=no\nborder=no\n');
  for (const file of ['scripts/uosc/main.lua', 'fonts/uosc_icons.otf', 'fonts/uosc_textures.ttf']) {
    const target = path.join(configDir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'old uosc asset');
  }

  const downloaded = [];
  const fetchImpl = async url => {
    downloaded.push(url);
    return { ok: true, arrayBuffer: async () => Buffer.from(`asset ${path.basename(url)}`) };
  };
  await setup({ ...f, spawn: probe, fetchImpl, log: () => {} });

  const config = fs.readFileSync(path.join(configDir, 'mpv.conf'), 'utf8');
  assert.match(config, /^volume=65/m);
  assert.match(config, /osc=no/);
  assert.match(config, /title-bar=no/);
  assert.doesNotMatch(config, /uosc|osd-bar=no|border=no/);
  assert.equal((config.match(/mise mpv:setup/g) || []).length, 2);
  for (const file of ['scripts/modernz.lua', 'fonts/modernz-icons.ttf', 'script-opts/modernz.conf']) {
    assert.equal(fs.readFileSync(path.join(configDir, file), 'utf8').startsWith('asset '), true);
  }
  for (const file of ['scripts/uosc/main.lua', 'fonts/uosc_icons.otf', 'fonts/uosc_textures.ttf']) {
    assert.equal(fs.existsSync(path.join(configDir, file)), false);
  }
  assert.equal(downloaded.length, 3);

  await setup({ ...f, spawn: probe, fetchImpl: async () => { throw new Error('unexpected repeat download'); }, log: () => {} });
});

test('keeps the managed OSC options global when mpv.conf contains profiles', async t => {
  const f = fixture(t);
  const configDir = path.join(f.home, '.config/mpv');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'mpv.conf'), '[quiet] # quiet playback profile\nvolume=20\n\n' + CONFIG_BLOCK + '\n');
  const fetchImpl = async () => ({ ok: true, arrayBuffer: async () => Buffer.from('asset') });
  await setup({ ...f, spawn: probe, fetchImpl, log: () => {} });

  const config = fs.readFileSync(path.join(configDir, 'mpv.conf'), 'utf8');
  assert.ok(config.indexOf(CONFIG_BLOCK) < config.indexOf('[quiet] # quiet playback profile'));
  assert.match(config, /\[quiet\] # quiet playback profile\nvolume=20/);
  await setup({ ...f, spawn: probe, fetchImpl: async () => { throw new Error('unexpected repeat download'); }, log: () => {} });
});

test('asks for sudo and installs mpv only when the player is missing', async t => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.bin, 'mpv'));
  const apt = path.join(f.bin, 'apt-get');
  fs.writeFileSync(apt, '#!/bin/sh\n');
  fs.chmodSync(apt, 0o755);
  const commands = [];
  const spawn = (command, args, options) => {
    commands.push([command, args]);
    if (command === 'sudo' && args[0] === '-v') return { status: 0 };
    if (command === 'sudo' && args[0] === '--' && args[2] === 'install') {
      const mpv = path.join(f.bin, 'mpv');
      fs.writeFileSync(mpv, '#!/bin/sh\n');
      fs.chmodSync(mpv, 0o755);
      return { status: 0 };
    }
    if (path.basename(command) === 'mpv') return { status: 0, stdout: 'mpv v0.40.0\n' };
    return { status: 0 };
  };
  await setup({
    ...f,
    uid: 1000,
    spawn,
    fetchImpl: async () => ({ ok: true, arrayBuffer: async () => Buffer.from('asset') }),
    log: () => {},
  });
  assert.deepEqual(commands.slice(0, 3), [
    ['sudo', ['-v']],
    ['sudo', ['--', apt, 'update']],
    ['sudo', ['--', apt, 'install', '-y', '--no-install-recommends', 'mpv']],
  ]);
});

test('ModernZ setup is Linux-only', async () => {
  await assert.rejects(setup({ platform: 'darwin', env: {} }), /not supported/);
  await assert.rejects(setup({ platform: 'linux', env: { PREFIX: '/data/data/com.termux/files/usr' } }), /not supported/);
});
