import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const source = new URL('../dot_config/chrome-remote-desktop/', import.meta.url);
function titlebuttonFixtures(config) {
  for (const file of ['setup-titlebuttons.py', 'pwa-titlebuttons.css', 'setup-terminal-font.py']) {
    fs.copyFileSync(new URL(file, source), path.join(config, file));
  }
}

test('terminal font setup is idempotent, preserves other settings and backs up once', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crd-terminal-font-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const rc = path.join(root, '.config/xfce4/terminal/terminalrc');
  fs.mkdirSync(path.dirname(rc), { recursive: true });
  const old = '[Configuration]\n# user comment\nFontName=Monospace 10\nColorBackground=#123456\n[Other]\nKeep=yes\n';
  fs.writeFileSync(rc, old);
  const run = () => spawnSync('python3', [new URL('setup-terminal-font.py', source).pathname], { env: { ...process.env, HOME: root, DISPLAY: '', DBUS_SESSION_BUS_ADDRESS: '' }, encoding: 'utf8' });
  assert.equal(run().status, 0);
  const first = fs.readFileSync(rc, 'utf8');
  const mtime = fs.statSync(rc).mtimeMs;
  assert.match(first, /FontName=Liberation Mono 10/);
  assert.match(first, /FontUseSystem=FALSE\n\[Other\]/);
  assert.match(first, /# user comment/);
  assert.match(first, /ColorBackground=#123456/);
  assert.equal(run().status, 0);
  assert.equal(fs.statSync(rc).mtimeMs, mtime);
  assert.equal(fs.readFileSync(path.join(root, '.local/state/crd-mint/terminalrc-before-font'), 'utf8'), old);
});

test('PWA spacing targets Chromium nodes in both headerbar variants without tall padding', () => {
  const css = fs.readFileSync(new URL('pwa-titlebuttons.css', source), 'utf8');
  assert.match(css, /headerbar\.titlebar\.chromium button\.titlebutton\.chromium\s*\{/);
  assert.match(css, /padding:\s*0;/);
  assert.match(css, /margin:\s*0;/);
  assert.match(css, /min-width:\s*26px;/);
  assert.doesNotMatch(css, /headerbar\.default-decoration\.titlebar button/);
});

test('titlebutton setup preserves user CSS, backs up once, repairs and is idempotent', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crd-titlebuttons-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const config = path.join(root, '.config/chrome-remote-desktop');
  fs.mkdirSync(config, { recursive: true });
  titlebuttonFixtures(config);
  const css = path.join(root, '.config/gtk-3.0/gtk.css');
  fs.mkdirSync(path.dirname(css));
  fs.writeFileSync(css, '/* user styling */\n');
  const run = () => spawnSync('python3', [path.join(config, 'setup-titlebuttons.py')], { env: { ...process.env, HOME: root }, encoding: 'utf8' });
  assert.equal(run().status, 0);
  const first = fs.readFileSync(css, 'utf8');
  const modified = fs.statSync(css).mtimeMs;
  assert.match(first, /min-width: 26px/);
  assert.ok(first.startsWith('/* user styling */\n'));
  assert.equal(run().status, 0);
  assert.equal(fs.statSync(css).mtimeMs, modified);
  fs.writeFileSync(css, first.replace('26px', '1px') + '/* later user styling */\n');
  assert.equal(run().status, 0);
  assert.equal(fs.readFileSync(css, 'utf8'), first + '/* later user styling */\n');
  assert.equal(fs.readFileSync(path.join(root, '.local/state/crd-mint/gtk.css-before-titlebuttons'), 'utf8'), '/* user styling */\n');
  fs.writeFileSync(css, first.replace('/* END crd-managed PWA titlebuttons */', ''));
  const malformed = fs.readFileSync(css, 'utf8');
  assert.notEqual(run().status, 0);
  assert.equal(fs.readFileSync(css, 'utf8'), malformed);
});

test('a duplicate helper exits before touching panel settings', () => {
  const result = spawnSync('python3', ['-c', `
import fcntl, hashlib, os, runpy, tempfile
from pathlib import Path
from unittest.mock import patch
m = runpy.run_path(${JSON.stringify(new URL('panel-workarea.py', source).pathname)})
with tempfile.TemporaryDirectory() as root:
    display = ':20'
    key = hashlib.sha256(display.encode()).hexdigest()[:16]
    with (Path(root) / f'crd-panel-workarea-{key}.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with patch.dict(os.environ, DISPLAY=display, XDG_RUNTIME_DIR=root), patch.dict(m['main'].__globals__, query=lambda *a: (_ for _ in ()).throw(AssertionError('duplicate queried X11'))):
            m['main']()
            m['main']()
`], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('panel refresh republishes and restores the actual panel size, even on failure', () => {
  const result = spawnSync('python3', ['-c', `
import runpy
from unittest.mock import patch
m = runpy.run_path(${JSON.stringify(new URL('panel-workarea.py', source).pathname)})
refresh = m['refresh']
for failure in [False, True]:
    calls = []
    def run(args, **kwargs):
        calls.append(args)
        if failure and len(calls) == 1:
            raise RuntimeError('fixture')
    with patch.dict(refresh.__globals__, query=lambda *args: '/panels/panel-1/size' if args[-1] == '-l' else '48'), patch('subprocess.run', run), patch('time.sleep'):
        try:
            refresh()
        except RuntimeError:
            assert failure
    assert [c[-1] for c in calls] == ['49', '48'], calls
`], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

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
  const shortcuts = path.join(xfce, 'xfconf/xfce-perchannel-xml/xfce4-keyboard-shortcuts.xml');
  assert.match(fs.readFileSync(shortcuts, 'utf8'), /name="&lt;Primary&gt;&lt;Shift&gt;s" type="string" value="xfce4-screenshooter -r"/);
  fs.writeFileSync(shortcuts, 'user shortcut');
  fs.writeFileSync(panel, 'user customized');
  result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(panel, 'utf8'), 'user customized');
  assert.equal(fs.readFileSync(shortcuts, 'utf8'), 'user shortcut');
});

test('active CRD enables desktop fixes idempotently without unnecessary installation or restart', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crd-active-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const stub = path.join(root, 'systemctl');
  fs.writeFileSync(stub, '#!/bin/sh\n[ "$1" = is-active ] && exit 0\nexit 1\n', { mode: 0o755 });
  const config = path.join(root, '.config/chrome-remote-desktop');
  fs.mkdirSync(config, { recursive: true });
  fs.copyFileSync(new URL('crd-panel-workarea.desktop', source), path.join(config, 'crd-panel-workarea.desktop'));
  titlebuttonFixtures(config);
  fs.writeFileSync(path.join(root, 'dpkg-query'), '#!/bin/sh\nprintf installed\n', { mode: 0o755 });
  fs.writeFileSync(path.join(root, 'timezone'), 'Asia/Jakarta\n');
  fs.writeFileSync(path.join(root, 'timedatectl'), '#!/bin/sh\ncat "$HOME/timezone"\n', { mode: 0o755 });
  const run = () => spawnSync('sh', [new URL('setup.sh', source).pathname], { env: { ...process.env, DISPLAY: '', DBUS_SESSION_BUS_ADDRESS: '', HOME: root, PATH: `${root}:${process.env.PATH}` }, encoding: 'utf8' });
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /already running/);
  const autostart = path.join(root, '.config/autostart/crd-panel-workarea.desktop');
  const before = fs.statSync(autostart).mtimeMs;
  assert.equal(run().status, 0);
  assert.equal(fs.statSync(autostart).mtimeMs, before);
  assert.equal(fs.readFileSync(autostart, 'utf8'), fs.readFileSync(new URL('crd-panel-workarea.desktop', source), 'utf8'));
  assert.ok(!fs.existsSync(path.join(root, '.config/xfce4/xfconf')));
  assert.match(fs.readFileSync(path.join(root, '.config/xfce4/terminal/terminalrc'), 'utf8'), /FontName=Liberation Mono 10/);
  // A minimal machine missing the explicit font installs it once, even when
  // CRD is active; subsequent runs do not invoke apt again.
  fs.writeFileSync(path.join(root, 'dpkg-query'), '#!/bin/sh\n[ -f "$HOME/font-installed" ] && printf installed\n', { mode: 0o755 });
  fs.writeFileSync(path.join(root, 'sudo'), '#!/bin/sh\n[ "$1" = -n ] && exit 0\nprintf "%s\\n" "$*" >> "$HOME/sudo-calls"\ncase "$*" in *install*) touch "$HOME/font-installed";; esac\n', { mode: 0o755 });
  assert.equal(run().status, 0);
  const calls = fs.readFileSync(path.join(root, 'sudo-calls'), 'utf8');
  assert.match(calls, /apt-get install -y --no-install-recommends --no-upgrade fonts-liberation/);
  assert.doesNotMatch(calls, /systemctl|restart/);
  assert.equal(run().status, 0);
  assert.equal(fs.readFileSync(path.join(root, 'sudo-calls'), 'utf8'), calls);
  fs.writeFileSync(path.join(root, 'timezone'), 'Etc/UTC\n');
  fs.writeFileSync(path.join(root, 'sudo'), '#!/bin/sh\n[ "$1" = -n ] && exit 0\nprintf "%s\\n" "$*" >> "$HOME/timezone-calls"\n[ "$*" = "timedatectl set-timezone Asia/Jakarta" ] || exit 1\nprintf "Asia/Jakarta\\n" > "$HOME/timezone"\n', { mode: 0o755 });
  assert.equal(run().status, 0);
  assert.equal(fs.readFileSync(path.join(root, 'timezone'), 'utf8'), 'Asia/Jakarta\n');
  assert.equal(run().status, 0);
  assert.equal(fs.readFileSync(path.join(root, 'timezone-calls'), 'utf8'), 'timedatectl set-timezone Asia/Jakarta\n');
});

test('a stopped registered host installs only missing screenshot and audio packages then starts', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crd-audio-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const put = (name, contents) => fs.writeFileSync(path.join(root, name), `#!/bin/sh\n${contents}\n`, { mode: 0o755 });
  put('systemctl', '[ -f "$HOME/started" ]');
  put('timedatectl', 'printf "Asia/Jakarta\\n"');
  put('dpkg-query', 'case "$*" in *xfce4-screenshooter|*pipewire|*wireplumber|*libasound2-plugins|*pulseaudio-utils) exit 1;; *) printf installed;; esac');
  put('sudo', 'if [ "$1" = -n ]; then exit 0; fi\nprintf "%s\\n" "$*" >> "$HOME/sudo-calls"\nif [ "$1" = systemctl ]; then touch "$HOME/started"; fi');
  const config = path.join(root, '.config/chrome-remote-desktop');
  fs.mkdirSync(config, { recursive: true });
  fs.writeFileSync(path.join(config, 'host#test.json'), '{}');
  titlebuttonFixtures(config);
  fs.copyFileSync(new URL('crd-panel-workarea.desktop', source), path.join(config, 'crd-panel-workarea.desktop'));
  fs.writeFileSync(path.join(config, 'mint-assets.sh'), '#!/bin/sh\nexit 0\n');
  const state = path.join(root, '.local/state/crd-mint');
  fs.mkdirSync(state, { recursive: true });
  fs.writeFileSync(path.join(state, 'preset-v1-complete'), 'done');
  const result = spawnSync('sh', [new URL('setup.sh', source).pathname], { env: { ...process.env, DISPLAY: '', DBUS_SESSION_BUS_ADDRESS: '', HOME: root, PATH: `${root}:${process.env.PATH}` }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const calls = fs.readFileSync(path.join(root, 'sudo-calls'), 'utf8');
  assert.match(calls, /apt-get install -y --no-install-recommends --no-upgrade xfce4-screenshooter pipewire wireplumber libasound2-plugins pulseaudio-utils/);
  assert.doesNotMatch(calls, /google-chrome|restart/);
});
