import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

test('cua setup installs once, handles missing AT-SPI and restarts on rerun', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cua-setup-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin);
  const stub = (name, body) => fs.writeFileSync(path.join(bin, name), '#!/bin/sh\n' + body + '\n', { mode: 0o755 });
  stub('systemctl', 'printf "systemctl %s\\n" "$*" >> "$HOME/calls"');
  stub('dpkg-query', '[ -f "$HOME/atspi" ] && printf installed || exit 1');
  stub('sudo', 'printf "sudo %s\\n" "$*" >> "$HOME/calls"\ncase "$*" in *install*) touch "$HOME/atspi";; esac');
  stub('curl', `
printf 'curl %s\\n' "$*" >> "$HOME/calls"
while [ "$1" != -o ]; do shift; done
cat > "$2" <<'INSTALLER'
#!/bin/bash
printf 'installer %s\\n' "$*" >> "$HOME/calls"
mkdir -p "$HOME/.local/bin"
printf '#!/bin/sh\\nexit 0\\n' > "$HOME/.local/bin/cua-driver"
chmod +x "$HOME/.local/bin/cua-driver"
INSTALLER`);
  const run = () => spawnSync('sh', [new URL('../dot_config/cua/startup.sh', import.meta.url).pathname], {
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, 'config'), DISPLAY: ':99', WAYLAND_DISPLAY: '', TERMUX_VERSION: '', PREFIX: '', PATH: `${bin}:/usr/bin:/bin` }, encoding: 'utf8',
  });
  let result = run();
  assert.equal(result.status, 0, result.stderr);
  result = run();
  assert.equal(result.status, 0, result.stderr);
  const calls = fs.readFileSync(path.join(home, 'calls'), 'utf8');
  assert.equal((calls.match(/^curl /gm) || []).length, 1);
  assert.match(calls, /https:\/\/cua\.ai\/driver\/install\.sh/);
  assert.match(calls, /installer --no-modify-path --no-connect --no-test/);
  assert.equal((calls.match(/^sudo apt-get install /gm) || []).length, 1);
  assert.equal((calls.match(/^systemctl --user restart cua-driver\.service$/gm) || []).length, 2);
  assert.match(fs.readFileSync(path.join(home, 'config/systemd/user/cua-driver.service'), 'utf8'), /ExecStart=.*\.local\/bin\/cua-driver serve/);
  assert.match(fs.readFileSync(path.join(home, 'config/autostart/cua-driver-session.desktop'), 'utf8'), /import-environment DISPLAY XAUTHORITY/);
});

test('cua setup refuses to overwrite a custom unit', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cua-conflict-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const bin = path.join(home, 'bin');
  const units = path.join(home, '.config/systemd/user');
  fs.mkdirSync(bin); fs.mkdirSync(units, { recursive: true });
  for (const [name, body] of Object.entries({ systemctl: 'exit 0', 'dpkg-query': 'printf installed', 'cua-driver': 'exit 0' }))
    fs.writeFileSync(path.join(bin, name), '#!/bin/sh\n' + body + '\n', { mode: 0o755 });
  const unit = path.join(units, 'cua-driver.service');
  fs.writeFileSync(unit, 'custom\n');
  const result = spawnSync('sh', [new URL('../dot_config/cua/startup.sh', import.meta.url).pathname], { env: { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), TERMUX_VERSION: '', PREFIX: '', PATH: `${bin}:/usr/bin:/bin` }, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Existing service differs/);
  assert.equal(fs.readFileSync(unit, 'utf8'), 'custom\n');
});
