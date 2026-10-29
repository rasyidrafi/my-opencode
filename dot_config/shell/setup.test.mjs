import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { setup } from './setup.mjs';
import { centralized, start, end, pathStart, pathEnd } from './integration.mjs';
import { installShellLoader, renderEnvironment, renderEnvironmentFish } from '../secrets/setup.mjs';
import { install as installCache } from '../azure-mnt-cache/setup.mjs';

const cli = fileURLToPath(new URL('./setup.mjs', import.meta.url));
const fishAvailable = (() => {
  const result = spawnSync('fish', ['--version'], { encoding: 'utf8' });
  return !result.error && result.status === 0;
})();

function fixture(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-setup-test-'));
  const write = (name, text) => {
    const target = path.join(home, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  };
  try { fn(home, write); } finally { fs.rmSync(home, { recursive: true, force: true }); }
}

function runBash(home, args, command, extra = {}) {
  return spawnSync('bash', [...args, command], {
    env: { HOME: home, PATH: '/usr/bin:/bin', ...extra }, encoding: 'utf8',
  });
}

test('preserves profiles, installs quietly, normalizes baseline PATH and is idempotent', () => fixture((home, write) => {
  write('.bashrc', 'case $- in *i*) ;; *) return ;; esac\nalias example=true\n');
  write('.profile', '# user customization\nexport CUSTOM=yes\n');
  for (const dir of ['bin', '.local/bin', '.local/share/mise/shims']) fs.mkdirSync(path.join(home, dir), { recursive: true });
  const result = setup({ home, env: {} });
  assert.ok(result.backup);
  assert.equal(centralized(home), true);
  const bashrc = fs.readFileSync(path.join(home, '.bashrc'), 'utf8');
  assert.ok(bashrc.indexOf('[ ! -r "$HOME/.config/shell/env.sh" ]') < bashrc.indexOf('return'));
  assert.match(bashrc, /alias example=true/);
  assert.deepEqual(setup({ home, env: {} }).changed, []);
  const r = runBash(home, ['--noprofile', '--norc', '-c'], '. "$HOME/.bashrc"; . "$HOME/.bash_env"; printf "%s" "$PATH"');
  assert.equal(r.status, 0); assert.equal(r.stderr, '');
  assert.equal(r.stdout, `${home}/bin:${home}/.local/bin:${home}/.local/share/mise/shims:/usr/bin:/bin`);
  assert.equal(fs.statSync(path.join(home, '.bash_env')).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.join(home, '.config/shell/path.sh')).mode & 0o777, 0o600);
}));

test('Debian/Mint-style login and interactive startup keeps stock hooks and runs bootstrap once', () => fixture((home, write) => {
  for (const dir of ['bin', '.local/bin', '.local/share/mise/shims']) fs.mkdirSync(path.join(home, dir), { recursive: true });
  write('.profile', `# Debian/Ubuntu-style Bash profile\nif [ -n "$BASH_VERSION" ]; then\n    if [ -f "$HOME/.bashrc" ]; then\n        . "$HOME/.bashrc"\n    fi\nfi\nPATH="$HOME/bin:$PATH"\nexport PATH\n`);
  write('.bashrc', `# Mint-like /etc/skel interactive rc\ncase $- in\n    *i*) ;;\n    *) return ;;\nesac\neval "$(mise activate bash)"\n[ ! -r "$HOME/.config/secrets/generated/env.sh" ] || . "$HOME/.config/secrets/generated/env.sh"\nif [ -d "$HOME/.local/bin" ]; then PATH="$HOME/.local/bin:$PATH"; fi\nPATH="$HOME/custom:$PATH"\nPROMPT_COMMAND=': user-prompt-hook'\n`);
  write('.config/shell/local.sh', 'printf x >> "$HOME/local-hook-count"\n');
  write('.config/azure-mnt-cache/shell-enabled', '1\n');
  write('.config/azure-mnt-cache/cache.sh', 'printf x >> "$HOME/cache-hook-count"\nexport CACHE_HOOK=loaded\n');
  setup({ home, env: {} });
  assert.match(fs.readFileSync(path.join(home, '.bashrc'), 'utf8'), /PROMPT_COMMAND=': user-prompt-hook'/);
  assert.match(fs.readFileSync(path.join(home, '.profile'), 'utf8'), /if \[ -f "\$HOME\/\.bashrc" \]/);

  // Real Bash login startup follows .profile and then its interactive .bashrc.
  const r = spawnSync('bash', ['--login', '-i', '-c', 'printf "PATH=%s\\nCACHE=%s\\nBASH_ENV=%s\\n" "$PATH" "$CACHE_HOOK" "$BASH_ENV"'], {
    env: { HOME: home, PATH: '/usr/bin:/bin' }, encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`BASH_ENV=${home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\/.bash_env`));
  assert.match(r.stdout, /CACHE=loaded/);
  assert.equal(fs.readFileSync(path.join(home, 'local-hook-count'), 'utf8'), 'x');
  assert.equal(fs.readFileSync(path.join(home, 'cache-hook-count'), 'utf8'), 'x');
  const pathValue = r.stdout.match(/^PATH=(.*)$/m)?.[1] ?? '';
  assert.ok(pathValue.includes(`${home}/custom:`), pathValue);
  for (const managed of [`${home}/bin`, `${home}/.local/bin`, `${home}/.local/share/mise/shims`]) {
    assert.equal(pathValue.split(':').filter(entry => entry === managed).length, 1, `${managed} should appear once`);
  }
  assert.ok(pathValue.indexOf(`${home}/bin`) < pathValue.indexOf(`${home}/.local/bin`));
  assert.ok(pathValue.indexOf(`${home}/.local/bin`) < pathValue.indexOf(`${home}/.local/share/mise/shims`));
  assert.ok(pathValue.indexOf(`${home}/custom`) < pathValue.indexOf('/usr/bin'));
  assert.ok(pathValue.split(':').indexOf('/usr/bin') < pathValue.split(':').indexOf('/bin'));
}));

test('custom prompt hooks survive a distro-style early-return rc fixture', () => fixture((home, write) => {
  write('.bashrc', `case $- in\n    *i*) ;;\n    *) return ;;\nesac\nfunction user_prompt_hook() { printf user-prompt; }\nPROMPT_COMMAND=user_prompt_hook\n`);
  setup({ home, env: {} });
  const result = fs.readFileSync(path.join(home, '.bashrc'), 'utf8');
  assert.match(result, /function user_prompt_hook\(\) \{ printf user-prompt; \}/);
  assert.match(result, /PROMPT_COMMAND=user_prompt_hook/);
  assert.ok(result.indexOf('PROMPT_COMMAND=user_prompt_hook') < result.indexOf('# >>> my-opencode shell path v1 >>>'));
}));

test('POSIX profile and env loader work under dash without sourcing Bash-only local.sh', () => fixture((home, write) => {
  for (const dir of ['bin', '.local/bin', '.local/share/mise/shims']) fs.mkdirSync(path.join(home, dir), { recursive: true });
  write('.profile', 'export PROFILE_CUSTOM=kept\n');
  write('.config/shell/local.sh', '[[ unsupported_bash_syntax ]] && export BASH_ONLY=yes\n');
  setup({ home, env: {} });
  const r = spawnSync('dash', ['-c', '. "$HOME/.profile"; printf "%s|%s|%s" "$PROFILE_CUSTOM" "${BASH_ONLY-unset}" "$PATH"'], {
    env: { HOME: home, PATH: '/usr/bin:/bin' }, encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  const [profileValue, bashOnly, pathValue] = r.stdout.split('|');
  assert.equal(profileValue, 'kept');
  assert.equal(bashOnly, 'unset');
  assert.ok(pathValue.startsWith(`${home}/bin:${home}/.local/bin:${home}/.local/share/mise/shims:`));
  assert.equal(r.stderr, '');
}));

test('PATH finalizer preserves inactive managed-looking paths', () => fixture((home) => {
  fs.mkdirSync(path.join(home, '.local/bin'), { recursive: true });
  setup({ home, env: {} });
  const r = spawnSync('sh', ['-c', '. "$HOME/.config/shell/path.sh"; printf "%s" "$PATH"'], {
    env: {
      HOME: home,
      PATH: `${home}/bin:/custom:${home}/.local/bin:${home}/.local/share/mise/shims:/usr/bin`,
    }, encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, `${home}/bin:/custom:${home}/.local/bin:${home}/.local/share/mise/shims:/usr/bin`);
}));

test('helper reruns do not add Bash loaders and cache remains opt-in', () => fixture(home => {
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

test('reversed or malformed managed markers fail before writing profiles', () => {
  for (const original of [
    '# <<< my-opencode shell v1 <<<\ncustom\n# >>> my-opencode shell v1 >>>\n',
    '# <<< my-opencode shell path v1 <<<\ncustom\n# >>> my-opencode shell path v1 >>>\n',
    '# >>> my-opencode shell v1 >>>\ncustom\n# <<< my-opencode shell path v1 <<<\n',
  ]) fixture((home, write) => {
    write('.bashrc', original);
    assert.throws(() => setup({ home, env: {} }), /markers|block/);
    assert.equal(fs.readFileSync(path.join(home, '.bashrc'), 'utf8'), original);
    assert.equal(fs.existsSync(path.join(home, '.profile')), false);
    assert.equal(fs.existsSync(path.join(home, '.config/shell/env.sh')), false);
  });
});

test('prose mentions of both marker types survive repeat setup', () => fixture((home, write) => {
  setup({ home, env: {} });
  const comment = `# Marker examples are prose: ${start}, ${end}, ${pathStart}, ${pathEnd}\n`;
  write('.bashrc', comment + fs.readFileSync(path.join(home, '.bashrc'), 'utf8'));
  setup({ home, env: {} });
  const once = fs.readFileSync(path.join(home, '.bashrc'), 'utf8');
  assert.ok(once.includes(comment));
  assert.deepEqual(setup({ home, env: {} }).changed, []);
  assert.equal(fs.readFileSync(path.join(home, '.bashrc'), 'utf8'), once);
}));

test('caller secret values, including empty and shell metacharacters, survive legacy generated exports', () => fixture((home, write) => {
  write('.config/secrets/manifest.json', JSON.stringify({ secrets: [{ name: 'TEST_KEY', output: 'env' }, { name: 'OTHER_KEY', output: 'env' }] }));
  write('.config/secrets/generated/env.sh', "export TEST_KEY='managed'\nexport OTHER_KEY='default'\n");
  setup({ home, env: {} });
  for (const value of ['', "caller'$(false)\nvalue"]) {
    const r = spawnSync('sh', ['-c', '. "$HOME/.config/shell/env.sh"; . "$HOME/.config/shell/env.sh"; printf "%s|%s" "$TEST_KEY" "$OTHER_KEY"'], {
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

test('legacy BASH_ENV hook runs once per Bash process, including automatic and explicit sources', () => fixture((home, write) => {
  write('custom.sh', 'printf x >> "$HOME/legacy-hook-count"\n');
  setup({ home, env: { BASH_ENV: path.join(home, 'custom.sh') } });
  const r = spawnSync('bash', ['--norc', '-c', '. "$HOME/.bash_env"; . "$HOME/.bash_env"; bash --norc -c :'], {
    env: { HOME: home, PATH: '/usr/bin:/bin', BASH_ENV: path.join(home, '.bash_env') }, encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
  // The parent automatic/explicit sources count once; the child gets a fresh guard.
  assert.equal(fs.readFileSync(path.join(home, 'legacy-hook-count'), 'utf8'), 'xx');
}));

test('upgrades the exact previous Bash wrapper without overwriting its legacy hook', () => fixture((home, write) => {
  const previous = `# Installed by mise run shell:setup. Non-interactive Bash entry point.\n[ ! -r "$HOME/.config/shell/env.sh" ] || . "$HOME/.config/shell/env.sh"\n[ ! -r "$HOME/.config/shell/legacy-bash-env.sh" ] || . "$HOME/.config/shell/legacy-bash-env.sh"\nBASH_ENV="$HOME/.bash_env"\nexport BASH_ENV\n`;
  const legacy = 'printf legacy-hook\n';
  write('.bash_env', previous);
  write('.config/shell/legacy-bash-env.sh', legacy);
  setup({ home, env: {} });
  assert.equal(fs.readFileSync(path.join(home, '.config/shell/legacy-bash-env.sh'), 'utf8'), legacy);
  assert.match(fs.readFileSync(path.join(home, '.bash_env'), 'utf8'), /_MY_OPENCODE_LEGACY_BASH_ENV_LOADED/);
  assert.deepEqual(setup({ home, env: {} }).changed, []);
}));

test('arbitrary recursive Bash wrapper remains a blocker', () => fixture((home, write) => {
  const recursive = '# User wrapper\n. "$HOME/.bash_env"\n';
  write('.bash_env', recursive);
  assert.throws(() => setup({ home, env: {} }), /may recurse/);
  assert.equal(fs.readFileSync(path.join(home, '.bash_env'), 'utf8'), recursive);
  assert.equal(fs.existsSync(path.join(home, '.profile')), false);
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

test('migrates bounded known loaders and helper cache opt-in without losing profile syntax', () => fixture((home, write) => {
  write('.profile', 'if [ -n "$BASH_VERSION" ]; then\n    if [ -r "$HOME/.config/shell/env.sh" ]; then\n        . "$HOME/.config/shell/env.sh"\n    fi\nfi\n');
  write('.bashrc', `[ ! -r '${home}/.config/secrets/load.sh' ] || . '${home}/.config/secrets/load.sh'\n[ ! -r '${home}/.config/azure-mnt-cache/cache.sh' ] || . '${home}/.config/azure-mnt-cache/cache.sh'\n`);
  write('.bash_env', '# thin wrapper\nif [ -r "$HOME/.config/shell/env.sh" ]; then\n    . "$HOME/.config/shell/env.sh"\nfi\n');
  setup({ home, env: {} });
  assert.equal(fs.existsSync(path.join(home, '.config/azure-mnt-cache/shell-enabled')), true);
  assert.equal(fs.existsSync(path.join(home, '.config/shell/legacy-bash-env.sh')), false);
  assert.deepEqual(setup({ home, env: {} }).changed, []);
}));

test('comments do not enable cache and ambiguous conditional loaders are refused', () => fixture((home, write) => {
  write('.profile', '# . "$HOME/.config/azure-mnt-cache/cache.sh"\nreturn\n[ ! -r "$HOME/.config/azure-mnt-cache/cache.sh" ] || . "$HOME/.config/azure-mnt-cache/cache.sh"\n# source "$HOME/.bashrc"\n');
  setup({ home, env: {} });
  assert.equal(fs.existsSync(path.join(home, '.config/azure-mnt-cache/shell-enabled')), false);
  assert.match(fs.readFileSync(path.join(home, '.profile'), 'utf8'), /\*i\*\).*\.bashrc/);
}));

test('ambiguous conditional integration is refused before writes', () => fixture((home, write) => {
  write('.bashrc', 'if [ -n "$CUSTOM" ]; then\n    . "$HOME/.config/secrets/load.sh"\nfi\n');
  assert.throws(() => setup({ home, env: {} }), /Unsupported conditional shell loader/);
  assert.equal(fs.existsSync(path.join(home, '.profile')), false);
  assert.equal(fs.existsSync(path.join(home, '.config/shell/env.sh')), false);
}));

test('loader calls hidden inside shell functions are not guessed or rewritten', () => fixture((home, write) => {
  write('.bashrc', 'load_secrets() {\n    . "$HOME/.config/secrets/load.sh"\n}\n');
  assert.throws(() => setup({ home, env: {} }), /Unsupported conditional shell loader/);
  assert.equal(fs.existsSync(path.join(home, '.profile')), false);
  assert.equal(fs.readFileSync(path.join(home, '.bashrc'), 'utf8'), 'load_secrets() {\n    . "$HOME/.config/secrets/load.sh"\n}\n');
}));

test('login comments do not suppress the managed interactive .bashrc source', () => fixture((home, write) => {
  write('.profile', '# source "$HOME/.bashrc"\nexport PROFILE_CUSTOM=kept\n');
  setup({ home, env: {} });
  const profile = fs.readFileSync(path.join(home, '.profile'), 'utf8');
  assert.match(profile, /\*i\*\) \[ ! -r "\$HOME\/\.bashrc" \] \|\| \. "\$HOME\/\.bashrc"/);
  assert.match(profile, /# source "\$HOME\/\.bashrc"/);
}));

test('Bash login delegation through .profile installs the rc source once in the delegated file', () => fixture((home, write) => {
  write('.bash_profile', '# custom login profile\n. "$HOME/.profile"\n');
  write('.profile', '# normal profile\nexport PROFILE_CUSTOM=kept\n');
  write('.config/shell/local.sh', 'printf x >> "$HOME/local-hook-count"\n');
  setup({ home, env: {} });
  const bashProfile = fs.readFileSync(path.join(home, '.bash_profile'), 'utf8');
  const profile = fs.readFileSync(path.join(home, '.profile'), 'utf8');
  assert.match(bashProfile, /^# >>> my-opencode shell v1 >>>/);
  assert.match(bashProfile, /\. "\$HOME\/\.profile"/);
  assert.doesNotMatch(bashProfile, /\*i\*\).*\.bashrc/);
  assert.match(profile, /\*i\*\) \[ ! -r "\$HOME\/\.bashrc" \] \|\| \. "\$HOME\/\.bashrc"/);

  const r = spawnSync('bash', ['--login', '-i', '-c', 'printf "PROFILE=%s\\n" "$PROFILE_CUSTOM"'], {
    env: { HOME: home, PATH: '/usr/bin:/bin' }, encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /PROFILE=kept/);
  assert.equal(fs.readFileSync(path.join(home, 'local-hook-count'), 'utf8'), 'x');
}));

test('simple .bashrc file guard is recognized without a BASH_VERSION wrapper', () => fixture((home, write) => {
  write('.bash_profile', 'if [ -f ~/.bashrc ]; then\n    . ~/.bashrc\nfi\n');
  write('.config/shell/local.sh', 'printf x >> "$HOME/local-hook-count"\n');
  setup({ home, env: {} });
  const bashProfile = fs.readFileSync(path.join(home, '.bash_profile'), 'utf8');
  assert.match(bashProfile, /if \[ -f ~\/\.bashrc \]; then\n    \. ~\/\.bashrc\nfi/);
  assert.doesNotMatch(bashProfile, /\*i\*\).*\.bashrc/);

  const r = spawnSync('bash', ['--login', '-i', '-c', 'printf ready'], {
    env: { HOME: home, PATH: '/usr/bin:/bin' }, encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(path.join(home, 'local-hook-count'), 'utf8'), 'x');
}));

test('conditional Mise activation migration refuses before writing', () => fixture((home, write) => {
  write('.bashrc', 'if [ "$ENABLE_MISE" = yes ]; then\n    eval "$(mise activate bash)"\nfi\n');
  assert.throws(() => setup({ home, env: {} }), /Conditional Mise activation is ambiguous/);
  assert.equal(fs.existsSync(path.join(home, '.profile')), false);
  assert.equal(fs.existsSync(path.join(home, '.config/shell/env.sh')), false);
}));

test('inline and alternate absolute Mise activation forms refuse without changing files', () => {
  for (const line of [
    'if [ -n "$USE_MISE" ]; then eval "$(mise activate bash)"; fi',
    '[ -n "$USE_MISE" ] && eval "$(mise activate bash)"',
    'if [ -n "$USE_MISE" ]; then eval "$(/tmp/example-home/.local/bin/mise activate bash)"; fi',
    '[ -n "$USE_MISE" ] && eval "$("$HOME/.local/bin/mise" activate bash)"',
  ]) fixture((home, write) => {
    const original = `${line}\n`;
    write('.bashrc', original.replace('/tmp/example-home', home));
    const before = fs.readFileSync(path.join(home, '.bashrc'), 'utf8');
    assert.throws(() => setup({ home, env: {} }), /Unsupported inline or conditional Mise activation/);
    const after = fs.readFileSync(path.join(home, '.bashrc'), 'utf8');
    assert.equal(after, before);
    assert.doesNotMatch(after, /case \$- in[\s\S]*?eval "\$\(mise activate bash\)"/);
    assert.equal(fs.existsSync(path.join(home, '.profile')), false);
    assert.equal(fs.existsSync(path.join(home, '.config/shell/env.sh')), false);
  });
});

test('Fish loader respects user config, supports an in-home XDG root, and is idempotent', () => fixture((home, write) => {
  write('.config/fish/config.fish', '# user Fish config\nset -gx USER_FISH custom\n');
  write('.config/fish/conf.d/user.fish', 'set -gx USER_CONF custom\n');
  const xdg = path.join(home, 'portable-config');
  setup({ home, env: { XDG_CONFIG_HOME: xdg } });
  const wrapper = fs.readFileSync(path.join(xdg, 'fish/conf.d/my-opencode.fish'), 'utf8');
  assert.match(wrapper, /source "\$HOME\/\.config\/shell\/env\.fish"/);
  assert.match(wrapper, /--on-event fish_prompt/);
  assert.equal(fs.existsSync(path.join(home, '.config/fish/conf.d/my-opencode.fish')), false);
  assert.equal(fs.readFileSync(path.join(home, '.config/fish/config.fish'), 'utf8'), '# user Fish config\nset -gx USER_FISH custom\n');
  assert.equal(fs.readFileSync(path.join(home, '.config/fish/conf.d/user.fish'), 'utf8'), 'set -gx USER_CONF custom\n');
  assert.deepEqual(setup({ home, env: { XDG_CONFIG_HOME: xdg } }).changed, []);
}));

test('Fish XDG roots outside the home and unmanaged hook collisions fail safely', () => fixture((home, write) => {
  assert.throws(() => setup({ home, env: { XDG_CONFIG_HOME: 'relative-config' } }), /must be an absolute path/);
  assert.equal(fs.existsSync(path.join(home, '.profile')), false);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-xdg-outside-'));
  try {
    assert.throws(() => setup({ home, env: { XDG_CONFIG_HOME: outside } }), /within the user home/);
    assert.equal(fs.existsSync(path.join(home, '.profile')), false);
  } finally { fs.rmSync(outside, { recursive: true, force: true }); }
  write('.config/fish/conf.d/my-opencode.fish', '# user-owned hook\n');
  assert.throws(() => setup({ home, env: {} }), /Refusing to overwrite unmanaged Fish startup hook/);
  assert.equal(fs.readFileSync(path.join(home, '.config/fish/conf.d/my-opencode.fish'), 'utf8'), '# user-owned hook\n');
  assert.equal(fs.existsSync(path.join(home, '.profile')), false);
}));

test('recognizes the previous exact Fish helper hook and upgrades it safely', () => fixture((home, write) => {
  write('.config/fish/conf.d/my-opencode.fish', '# Installed by mise run shell:setup. Fish startup auto-sources conf.d files.\nif test -r "$HOME/.config/shell/env.fish"\n    source "$HOME/.config/shell/env.fish"\nend\n');
  setup({ home, env: {} });
  assert.match(fs.readFileSync(path.join(home, '.config/fish/conf.d/my-opencode.fish'), 'utf8'), /--on-event fish_prompt/);
  assert.deepEqual(setup({ home, env: {} }).changed, []);
}));

test('Fish runtime receives the managed PATH order and Bash forwarding', { skip: !fishAvailable }, () => fixture(home => {
  for (const dir of ['bin', '.local/bin', '.local/share/mise/shims']) fs.mkdirSync(path.join(home, dir), { recursive: true });
  setup({ home, env: {} });
  const r = spawnSync('fish', ['-c', 'printf "%s\\nBASH_ENV=%s" (string join : $PATH) "$BASH_ENV"'], {
    env: { HOME: home, PATH: '/usr/bin:/bin' }, encoding: 'utf8',
  });
  assert.equal(r.status, 0); assert.equal(r.stderr, '');
  assert.equal(r.stdout, `${home}/bin:${home}/.local/bin:${home}/.local/share/mise/shims:/usr/bin:/bin\nBASH_ENV=${home}/.bash_env`);
}));

test('generated Fish defaults preserve caller values', { skip: !fishAvailable }, () => fixture((home, write) => {
  write('.config/secrets/generated/env.fish', renderEnvironmentFish({ TEST_KEY: "managed'quoted", OTHER_KEY: 'line\nbreak', SAFE: 'plain' }));
  setup({ home, env: {} });
  assert.match(fs.readFileSync(path.join(home, '.config/secrets/generated/env.fish'), 'utf8'), /if not set -q TEST_KEY/);
  const r = spawnSync('fish', ['-c', 'printf "%s|%s|%s" "$OTHER_KEY" "$TEST_KEY" "$SAFE"'], {
    env: { HOME: home, PATH: '/usr/bin:/bin', TEST_KEY: 'caller' }, encoding: 'utf8',
  });
  assert.equal(r.status, 0); assert.equal(r.stderr, '');
  assert.equal(r.stdout, 'line\nbreak|caller|plain');
}));

test('check is read-only, hides secret values, reports plans, and unknown arguments fail before work', () => fixture((home, write) => {
  write('.config/secrets/manifest.json', JSON.stringify({ secrets: [{ name: 'PRIVATE_TOKEN', output: 'env' }] }));
  write('.config/secrets/generated/env.sh', "export PRIVATE_TOKEN='never-print-this-value'\n");
  const env = { HOME: home, PATH: process.env.PATH };
  const checked = spawnSync(process.execPath, [cli, '--check'], { env, encoding: 'utf8' });
  assert.equal(checked.status, 0, checked.stderr);
  assert.match(checked.stdout, /Read-only structural check/);
  assert.match(checked.stdout, /Fish config root/);
  assert.match(checked.stdout, /Planned paths/);
  assert.doesNotMatch(checked.stdout, /never-print-this-value/);
  assert.equal(fs.existsSync(path.join(home, '.profile')), false);
  assert.equal(fs.existsSync(path.join(home, '.config/shell/env.sh')), false);

  const unknown = spawnSync(process.execPath, [cli, '--replace-legacy-loader', '--unrecognized'], { env, encoding: 'utf8' });
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /Unknown argument/);
  assert.equal(fs.existsSync(path.join(home, '.profile')), false);
}));

test('check reports structural blockers without writing', () => fixture((home, write) => {
  write('.config/fish/conf.d/my-opencode.fish', '# unmanaged\n');
  const checked = spawnSync(process.execPath, [cli, '--check'], {
    env: { HOME: home, PATH: process.env.PATH }, encoding: 'utf8',
  });
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /Blocker: Refusing to overwrite unmanaged Fish startup hook/);
  assert.match(checked.stdout, /no files were written/i);
  assert.equal(fs.existsSync(path.join(home, '.profile')), false);
}));

test('read-only check does not execute an inherited BASH_ENV hook', () => fixture((home, write) => {
  write('inherited-bash-env', 'printf x >> "$HOME/bash-env-ran"\n');
  const checked = spawnSync(process.execPath, [cli, '--check'], {
    env: { HOME: home, PATH: process.env.PATH, BASH_ENV: path.join(home, 'inherited-bash-env') }, encoding: 'utf8',
  });
  assert.equal(checked.status, 0, checked.stderr);
  assert.equal(fs.existsSync(path.join(home, 'bash-env-ran')), false);
  assert.equal(fs.existsSync(path.join(home, '.profile')), false);
}));
