import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const source = new URL('../dot_config/chrome-remote-desktop/', import.meta.url);
test('seeds an existing XFCE profile once, backs it up, and preserves later edits', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crd & preset-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const config = path.join(root, '.config/chrome-remote-desktop');
  fs.mkdirSync(config, { recursive: true });
  fs.cpSync(new URL('mint-preset/', source), path.join(config, 'mint-preset'), { recursive: true });
  const xfce = path.join(root, '.config/xfce4');
  fs.mkdirSync(xfce, { recursive: true });
  fs.writeFileSync(path.join(xfce, 'existing-setting'), 'keep me');
  const run = () => spawnSync('python3', [new URL('seed-mint.py', source).pathname], { env: { ...process.env, HOME: root }, encoding: 'utf8' });
  const incomplete = run();
  assert.notEqual(incomplete.status, 0);
  assert.ok(!fs.existsSync(path.join(root, '.local/state/crd-mint/preset-v1-complete')));
  for (const name of ['.local/share/backgrounds/crd-mint/sele_ring.jpg', '.local/share/themes/Mint-Y-Dark-Aqua/gtk-3.0/gtk.css']) {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'fixture');
  }
  let result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(root, '.local/state/crd-mint/xfce4-before-mint/existing-setting'), 'utf8'), 'keep me');
  const panel = path.join(xfce, 'xfconf/xfce-perchannel-xml/xfce4-panel.xml');
  assert.match(fs.readFileSync(panel, 'utf8'), /Mint|whiskermenu/);
  const desktop = fs.readFileSync(path.join(xfce, 'xfconf/xfce-perchannel-xml/xfce4-desktop.xml'), 'utf8');
  assert.ok(desktop.includes('crd &amp; preset-'));
  assert.ok(!desktop.includes('MINT_WALLPAPER_PATH'));
  fs.writeFileSync(panel, 'user customized');
  result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(panel, 'utf8'), 'user customized');
});

test('an active CRD service exits before installation, profile changes, or restart', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crd-active-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const stub = path.join(root, 'systemctl');
  fs.writeFileSync(stub, '#!/bin/sh\n[ "$1" = is-active ] && exit 0\nexit 1\n', { mode: 0o755 });
  const result = spawnSync('sh', [new URL('setup.sh', source).pathname], { env: { ...process.env, HOME: root, PATH: `${root}:${process.env.PATH}` }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /already running/);
  assert.ok(!fs.existsSync(path.join(root, '.config')));
});

test('a stopped registered host installs only missing audio packages then starts', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crd-audio-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const put = (name, contents) => fs.writeFileSync(path.join(root, name), `#!/bin/sh\n${contents}\n`, { mode: 0o755 });
  put('systemctl', '[ -f "$HOME/started" ]');
  put('dpkg-query', 'case "$*" in *pipewire|*wireplumber|*libasound2-plugins|*pulseaudio-utils) exit 1;; *) printf installed;; esac');
  put('sudo', 'if [ "$1" = -n ]; then exit 0; fi\nprintf "%s\\n" "$*" >> "$HOME/sudo-calls"\nif [ "$1" = systemctl ]; then touch "$HOME/started"; fi');
  const config = path.join(root, '.config/chrome-remote-desktop');
  fs.mkdirSync(config, { recursive: true });
  fs.writeFileSync(path.join(config, 'host#test.json'), '{}');
  fs.writeFileSync(path.join(config, 'mint-assets.sh'), '#!/bin/sh\nexit 0\n');
  const state = path.join(root, '.local/state/crd-mint');
  fs.mkdirSync(state, { recursive: true });
  fs.writeFileSync(path.join(state, 'preset-v1-complete'), 'done');
  const result = spawnSync('sh', [new URL('setup.sh', source).pathname], { env: { ...process.env, HOME: root, PATH: `${root}:${process.env.PATH}` }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const calls = fs.readFileSync(path.join(root, 'sudo-calls'), 'utf8');
  assert.match(calls, /apt-get install -y --no-install-recommends --no-upgrade pipewire wireplumber libasound2-plugins pulseaudio-utils/);
  assert.doesNotMatch(calls, /google-chrome|restart/);
});
