import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { start, end, loader, read, assertSafe, privateWrite } from './integration.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const blockPattern = /^# >>> my-opencode shell v1 >>>\n[\s\S]*?^# <<< my-opencode shell v1 <<<\n?/gm;

function syntax(text, shell, target) {
  if (shell === 'fish') {
    // Hosts without Fish cannot execute these files; still validate it when Fish exists.
    if (spawnSync('fish', ['--version'], { encoding: 'utf8' }).error) return;
    const result = spawnSync('fish', ['-n'], { input: text, encoding: 'utf8' });
    // Parser diagnostics can echo a credential assignment from an existing profile.
    if (result.error || result.status !== 0) throw new Error(`Fish syntax validation failed for ${target}.`);
    return;
  }
  const result = spawnSync(shell, ['-n'], { input: text, encoding: 'utf8' });
  // Parser diagnostics can echo a credential assignment from an existing profile.
  if (result.error || result.status !== 0) throw new Error(`Shell syntax validation failed for ${target}; no diagnostic contents printed.`);
}

function cleanProfile(text, home) {
  const begins = (text.match(/^# >>> my-opencode shell v1 >>>$/gm) || []).length;
  const ends = text.split('\n').filter(line => line === end).length;
  if (begins !== ends) throw new Error('Unbalanced managed shell block; repair it before rerunning setup.');
  text = text.replace(blockPattern, '');
  const paths = ['$HOME/.config/shell/env.sh', `${home}/.config/shell/env.sh`,
    '$HOME/.config/secrets/generated/env.sh', `${home}/.config/secrets/generated/env.sh`,
    '$HOME/.config/secrets/load.sh', `${home}/.config/secrets/load.sh`,
    '$HOME/.config/azure-mnt-cache/cache.sh', `${home}/.config/azure-mnt-cache/cache.sh`];
  return text.split('\n').map(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    // Only replace complete known loader commands, never surrounding user code.
    for (const target of paths) {
      const operands = [`"${target}"`, `'${target}'`];
      if (operands.some(operand => trimmed === `. ${operand}` || trimmed === `source ${operand}`
        || trimmed === `[ ! -r ${operand} ] || . ${operand}`)) return `${line.match(/^\s*/)[0]}:`;
    }
    if (/^(?:export\s+)?BASH_ENV=/.test(trimmed)) {
      if ([`BASH_ENV="$HOME/.bash_env"`, `BASH_ENV='${home}/.bash_env'`, `BASH_ENV="${home}/.bash_env"`].includes(trimmed.replace(/^export\s+/, ''))) return `${line.match(/^\s*/)[0]}:`;
      throw new Error('Custom BASH_ENV assignment in a profile: move its absolute path into the invoking environment, or migrate it explicitly before setup.');
    }
    if (trimmed === 'eval "$(mise activate bash)"' || trimmed === `eval "$(${home}/.local/bin/mise activate bash)"`) return `${line.match(/^\s*/)[0]}:`;
    // Unsupported direct calls could override central policy after this hook.
    if (paths.some(target => trimmed.includes(target)) && /(?:^|[; ])(?:\.|source)\s/.test(trimmed)
      && !trimmed.startsWith('if ')) throw new Error('Unsupported inline shell loader; split it into a standalone command before setup.');
    return line;
  }).join('\n');
}

export function setup({ home = os.homedir(), platform = process.platform, env = process.env, dryRun = false, replaceLegacy = false } = {}) {
  if (!['linux', 'darwin'].includes(platform)) throw new Error('shell:setup supports Linux and macOS Bash environments only.');
  home = path.resolve(home);
  const changes = new Map();
  const plan = (name, content, shell) => {
    const target = path.join(home, name);
    assertSafe(home, target);
    if (shell) syntax(content, shell, name);
    if (!fs.existsSync(target) || read(target) !== content) changes.set(target, content);
  };
  const profiles = ['.profile', '.bashrc', ...['.bash_profile', '.bash_login'].filter(name => fs.existsSync(path.join(home, name)))];
  const originals = Object.fromEntries(profiles.map(name => [name, read(path.join(home, name))]));
  const oldShared = read(path.join(home, '.config/shell/env.sh'));
  const shared = read(path.join(directory, 'templates/env.sh'));
  if (oldShared && oldShared !== shared && read(path.join(home, '.config/shell/installed-v1')) !== '1\n' && !replaceLegacy) {
    throw new Error('Existing shared env.sh is not managed by this installer. Review its customizations, then use --replace-legacy-loader to replace it with a private backup.');
  }
  const oldSharedFish = read(path.join(home, '.config/shell/env.fish'));
  const sharedFish = read(path.join(directory, 'templates/env.fish'));
  if (oldSharedFish && oldSharedFish !== sharedFish && read(path.join(home, '.config/shell/installed-v1')) !== '1\n' && !replaceLegacy) {
    throw new Error('Existing shared env.fish is not managed by this installer. Review its customizations, then use --replace-legacy-loader to replace it with a private backup.');
  }
  const enabled = fs.existsSync(path.join(home, '.config/azure-mnt-cache/shell-enabled'))
    || fs.existsSync(path.join(home, '.config/azure-mnt-cache/docker-enabled'))
    || [...Object.values(originals), ...(oldShared !== shared ? [oldShared] : [])].some(text => text.split('\n').some(line => !line.trim().startsWith('#') && /(?:\.|source)\s+[^\n]*azure-mnt-cache\/cache\.sh/.test(line)));
  if (enabled) plan('.config/azure-mnt-cache/shell-enabled', '1\n');

  const manifestFile = path.join(home, '.config/secrets/manifest.json');
  if (fs.existsSync(manifestFile)) {
    const manifest = JSON.parse(read(manifestFile));
    if (!Array.isArray(manifest.secrets)) throw new Error('Invalid secrets manifest.');
    const names = manifest.secrets.filter(entry => entry.output === 'env').map(entry => entry.name);
    if (names.some(name => typeof name !== 'string' || !/^[A-Z_][A-Z0-9_]*$/.test(name))) throw new Error('Invalid secret identifier in manifest.');
    plan('.config/secrets/generated/names', names.map(name => `${name}\n`).join(''));
  } else if (fs.existsSync(path.join(home, '.config/secrets/generated/env.sh'))) {
    throw new Error('Existing secrets require manifest.json to preserve caller overrides; install the manifest before setup.');
  }
  plan('.config/secrets/load.sh', read(path.join(directory, '../secrets/load.sh')), 'sh');

  const wrapper = read(path.join(directory, 'templates/bash_env'));
  const oldWrapper = read(path.join(home, '.bash_env'));
  const custom = env.BASH_ENV && env.BASH_ENV !== path.join(home, '.bash_env') ? env.BASH_ENV : null;
  const legacy = path.join(home, '.config/shell/legacy-bash-env.sh');
  if (custom) {
    if (!path.isAbsolute(custom) || !fs.statSync(custom).isFile()) throw new Error('Custom BASH_ENV must name an existing absolute regular file.');
    if (read(custom).includes('.bash_env') || read(custom).includes('.config/shell/env.sh')) throw new Error('Custom BASH_ENV already references shell integration; migrate it explicitly to avoid a startup cycle.');
    const content = `# Preserved custom BASH_ENV hook.\n[ ! -r ${quote(custom)} ] || . ${quote(custom)}\n`;
    if (fs.existsSync(legacy) && read(legacy) !== content) throw new Error('A different legacy Bash hook already exists; merge it explicitly before setup.');
    plan('.config/shell/legacy-bash-env.sh', content, 'bash');
  } else if (oldWrapper && oldWrapper !== wrapper) {
    // Recognize only thin wrappers. Preserve arbitrary existing hook code privately.
    const thin = /^\s*(?:#.*)?$|^\s*(?:if \[ -r "\$HOME\/\.config\/shell\/env\.sh" \]; then|\. "\$HOME\/\.config\/shell\/env\.sh"|fi|\[ ! -r "\$HOME\/\.config\/shell\/env\.sh" \] \|\| \. "\$HOME\/\.config\/shell\/env\.sh")\s*$/;
    if (!oldWrapper.split('\n').every(line => thin.test(line))) {
      if (oldWrapper.includes('.bash_env')) throw new Error('Existing .bash_env may recurse; migrate it explicitly before setup.');
      if (fs.existsSync(legacy) && read(legacy) !== oldWrapper) throw new Error('A legacy Bash hook already exists; merge it explicitly before setup.');
      plan('.config/shell/legacy-bash-env.sh', oldWrapper, 'bash');
    }
  }
  plan('.config/shell/env.sh', shared, 'sh');
  plan('.config/shell/env.fish', sharedFish, 'fish');
  plan('.config/fish/conf.d/my-opencode.fish',
    '# Installed by mise run shell:setup. Fish startup auto-sources conf.d files.\nif test -r "$HOME/.config/shell/env.fish"\n    source "$HOME/.config/shell/env.fish"\nend\n',
    'fish');
  plan('.bash_env', wrapper, 'bash');
  const login = ['.bash_profile', '.bash_login', '.profile'].find(name => Object.hasOwn(originals, name));
  for (const name of profiles) {
    const clean = cleanProfile(originals[name], home);
    let hook = `${start}\n${loader}\n`;
    if (name === '.bashrc') {
      hook += 'case $- in\n    *i*) if command -v mise >/dev/null 2>&1; then eval "$(mise activate bash)"; fi ;;\nesac\n';
    } else if (name === login && !/(?:\.|source)\s+[^\n]*(?:\.bashrc|\.profile)/.test(clean)) {
      hook += 'if [ -n "${BASH_VERSION-}" ]; then\n    case $- in\n        *i*) [ ! -r "$HOME/.bashrc" ] || . "$HOME/.bashrc" ;;\n    esac\nfi\n';
    }
    hook += `${end}\n`;
    plan(name, hook + clean, name === '.profile' ? 'sh' : 'bash');
  }
  plan('.config/shell/installed-v1', '1\n');
  if (!changes.size) return { changed: [], backup: null };
  if (dryRun) return { changed: [...changes.keys()], backup: null };
  // Validate every destination and proposed shell before any write or backup.
  const backup = path.join(home, '.local/state/shell-init-backups', `${new Date().toISOString().replaceAll(':', '-')}-${process.pid}`);
  assertSafe(home, path.join(backup, 'manifest.json'));
  for (const [target] of changes) {
    if (fs.existsSync(target)) privateWrite(home, path.join(backup, path.relative(home, target)), read(target));
  }
  privateWrite(home, path.join(backup, 'manifest.json'), JSON.stringify({ changed: [...changes.keys()].map(target => path.relative(home, target)) }, null, 2) + '\n');
  for (const [target, content] of changes) privateWrite(home, target, content);
  return { changed: [...changes.keys()], backup };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const dryRun = process.argv.includes('--dry-run');
    const result = setup({ dryRun, replaceLegacy: process.argv.includes('--replace-legacy-loader') });
    if (dryRun) {
      console.log(`Dry run: ${result.changed.length} file(s) would change; no files written.`);
      for (const target of result.changed) console.log(target);
    } else {
      console.log(result.changed.length ? `Installed deterministic Bash setup (${result.changed.length} changed files). Private backup: ${result.backup}` : 'Bash setup is already current; no changes.');
      console.log('Open a new Bash or Fish login. Existing processes and systemd/cron need explicit environment integration.');
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
