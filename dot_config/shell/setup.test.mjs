import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { setup } from './setup.mjs';
import { centralized } from './integration.mjs';
import { installShellLoader, renderEnvironment } from '../secrets/setup.mjs';
import { install as installCache } from '../azure-mnt-cache/setup.mjs';

function fixture(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-setup-test-'));
  const write = (name, text) => { const target = path.join(home, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text); };
  try { fn(home, write); } finally { fs.rmSync(home, { recursive: true, force: true }); }
}

test('preserves custom profiles, installs quietly and is idempotent', () => fixture((home, write) => {
  write('.bashrc', 'case $- in *i*) ;; *) return ;; esac\nalias example=true\n');
  write('.profile', '# user customization\nexport CUSTOM=yes\n');
  for (const dir of ['bin', '.local/bin', '.local/share/mise/shims']) fs.mkdirSync(path.join(home, dir), { recursive: true });
  const result = setup({ home, env: {} });
  assert.ok(result.backup);
  assert.equal(centralized(home), true);
  assert.match(fs.readFileSync(path.join(home, '.bashrc'), 'utf8'), /alias example=true/);
  assert.deepEqual(setup({ home, env: {} }).changed, []);
  const r = spawnSync('bash', ['--noprofile', '--norc', '-c', '. "$HOME/.bashrc"; . "$HOME/.bash_env"; printf "%s" "$PATH"'], {
    env: { HOME: home, PATH: '/usr/bin:/bin' }, encoding: 'utf8',
  });
  assert.equal(r.status, 0); assert.equal(r.stderr, '');
  assert.equal(r.stdout, `${home}/bin:${home}/.local/bin:${home}/.local/share/mise/shims:/usr/bin:/bin`);
  assert.equal(fs.statSync(path.join(home, '.bash_env')).mode & 0o777, 0o600);
}));

test('helper reruns do not add Bash loaders and cache remains opt-in', () => fixture((home) => {
  setup({ home, env: {} });
  const before = fs.readFileSync(path.join(home, '.bashrc'), 'utf8');
  assert.equal(fs.existsSync(path.join(home, '.config/azure-mnt-cache/shell-enabled')), false);
  installShellLoader(home, path.join(home, '.config/secrets'), '');
  installCache(home);
  assert.equal(fs.readFileSync(path.join(home, '.bashrc'), 'utf8'), before);
  assert.equal(fs.existsSync(path.join(home, '.config/azure-mnt-cache/shell-enabled')), true);
  assert.deepEqual(setup({ home, env: {} }).changed, []);
}));

test('dry-run and unsafe migration leave files untouched', () => fixture((home, write) => {
  write('.profile', '# unchanged\n');
  assert.ok(setup({ home, env: {}, dryRun: true }).changed.length);
  assert.equal(fs.existsSync(path.join(home, '.bashrc')), false);
  write('.config/shell/env.sh', 'export CUSTOM=yes\n');
  assert.throws(() => setup({ home, env: {} }), /replace-legacy-loader/);
  assert.equal(fs.readFileSync(path.join(home, '.profile'), 'utf8'), '# unchanged\n');
  assert.ok(setup({ home, env: {}, replaceLegacy: true }).backup);
}));

test('symlinks and invalid syntax fail before any writes', () => fixture((home, write) => {
  write('original', '# private\n');
  fs.symlinkSync(path.join(home, 'original'), path.join(home, '.bashrc'));
  assert.throws(() => setup({ home, env: {} }), /symlink/);
  assert.equal(fs.existsSync(path.join(home, '.profile')), false);
  fs.unlinkSync(path.join(home, '.bashrc'));
  write('.bashrc', 'if then\n');
  assert.throws(() => setup({ home, env: {} }), /syntax validation/);
  assert.equal(fs.existsSync(path.join(home, '.profile')), false);
}));

test('caller secret values, including empty and shell metacharacters, survive legacy generated exports', () => fixture((home, write) => {
  write('.config/secrets/manifest.json', JSON.stringify({ secrets: [{ name: 'TEST_KEY', output: 'env' }, { name: 'OTHER_KEY', output: 'env' }] }));
  write('.config/secrets/generated/env.sh', "export TEST_KEY='managed'\nexport OTHER_KEY='default'\n");
  setup({ home, env: {} });
  for (const value of ['', "caller'$(false)\nvalue"]) {
    const r = spawnSync('sh', ['-c', '. "$HOME/.config/shell/env.sh"; printf "%s|%s" "$TEST_KEY" "$OTHER_KEY"'], {
      env: { HOME: home, PATH: '/usr/bin:/bin', TEST_KEY: value }, encoding: 'utf8',
    });
    assert.equal(r.status, 0); assert.equal(r.stderr, ''); assert.equal(r.stdout, `${value}|default`);
  }
}));

test('custom BASH_ENV is preserved and sourced by the wrapper', () => fixture((home, write) => {
  write('custom.sh', 'export CUSTOM_HOOK=present\n');
  setup({ home, env: { BASH_ENV: path.join(home, 'custom.sh') } });
  const r = spawnSync('bash', ['--norc', '-c', 'printf "%s" "$CUSTOM_HOOK"'], {
    env: { HOME: home, PATH: '/usr/bin:/bin', BASH_ENV: path.join(home, '.bash_env') }, encoding: 'utf8',
  });
  assert.equal(r.status, 0); assert.equal(r.stdout, 'present');
}));

test('generated secrets provide defaults without replacing caller values', () => fixture((home, write) => {
  write('env.sh', renderEnvironment({ TEST_KEY: "managed'quoted" }));
  for (const caller of [undefined, '', 'caller']) {
    const env = { HOME: home, PATH: '/usr/bin:/bin' };
    if (caller !== undefined) env.TEST_KEY = caller;
    const r = spawnSync('sh', ['-c', '. "$HOME/env.sh"; printf "%s" "$TEST_KEY"'], { env, encoding: 'utf8' });
    assert.equal(r.status, 0); assert.equal(r.stdout, caller ?? "managed'quoted");
  }
}));

test('migrates existing loader blocks and cache opt-in without losing profile syntax', () => fixture((home, write) => {
  write('.profile', 'if [ -n "$BASH_VERSION" ]; then\n    if [ -r "$HOME/.config/shell/env.sh" ]; then\n        . "$HOME/.config/shell/env.sh"\n    fi\nfi\n');
  write('.bashrc', '[ ! -r "$HOME/.config/secrets/generated/env.sh" ] || . "$HOME/.config/secrets/generated/env.sh"\n');
  write('.config/shell/env.sh', '[ ! -r "$HOME/.config/azure-mnt-cache/cache.sh" ] || . "$HOME/.config/azure-mnt-cache/cache.sh"\n');
  write('.bash_env', '# thin wrapper\nif [ -r "$HOME/.config/shell/env.sh" ]; then\n    . "$HOME/.config/shell/env.sh"\nfi\n');
  setup({ home, env: {}, replaceLegacy: true });
  assert.equal(fs.existsSync(path.join(home, '.config/azure-mnt-cache/shell-enabled')), true);
  assert.equal(fs.existsSync(path.join(home, '.config/shell/legacy-bash-env.sh')), false);
  assert.deepEqual(setup({ home, env: {} }).changed, []);
}));

test('login and interactive entry points load the shared environment quietly', () => fixture((home, write) => {
  write('.bash_profile', '# user login file\nexport LOGIN_CUSTOM=kept\n');
  setup({ home, env: {} });
  for (const args of [['--norc', '-c'], ['--norc', '-i', '-c']]) {
    const r = spawnSync('bash', [...args, '. "$HOME/.bash_profile"; printf "%s|%s" "$BASH_ENV" "$LOGIN_CUSTOM"'], {
      env: { HOME: home, PATH: '/usr/bin:/bin' }, encoding: 'utf8',
    });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, `${home}/.bash_env|kept`);
  }
}));
