import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { start, end, pathStart, pathEnd, loader, pathLoader, read, assertSafe, privateWrite } from './integration.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const fishLoaderName = 'my-opencode.fish';
const fishLoaderHeader = '# Installed by mise run shell:setup. Fish startup auto-sources conf.d files.';
const previousBashEnvWrapper = `# Installed by mise run shell:setup. Non-interactive Bash entry point.
[ ! -r "$HOME/.config/shell/env.sh" ] || . "$HOME/.config/shell/env.sh"
[ ! -r "$HOME/.config/shell/legacy-bash-env.sh" ] || . "$HOME/.config/shell/legacy-bash-env.sh"
BASH_ENV="$HOME/.bash_env"
export BASH_ENV
`;

function stripManagedBlock(text, begins, finishes, label) {
  const lines = text.split('\n');
  const beginCount = lines.filter(line => line === begins).length;
  const finishCount = lines.filter(line => line === finishes).length;
  if (beginCount !== finishCount || beginCount > 1) {
    throw new Error(`Unbalanced or duplicated ${label} block; repair it before rerunning setup.`);
  }
  if (!beginCount) return text;
  const beginLine = lines.findIndex(line => line === begins);
  const finishLine = lines.findIndex(line => line === finishes);
  if (beginLine >= finishLine) throw new Error(`Reversed ${label} markers; repair them before rerunning setup.`);
  const beginOffset = lines.slice(0, beginLine).reduce((offset, line) => offset + line.length + 1, 0);
  const escapedBegin = begins.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedFinish = finishes.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const block = new RegExp(`^${escapedBegin}\\n[\\s\\S]*?^${escapedFinish}\\n?`, 'm').exec(text);
  if (!block || block.index !== beginOffset) throw new Error(`Invalid ${label} block; repair it before rerunning setup.`);
  return text.slice(0, block.index) + text.slice(block.index + block[0].length);
}

function stripOwnedBlocks(text) {
  text = stripManagedBlock(text, start, end, 'managed shell');
  return stripManagedBlock(text, pathStart, pathEnd, 'managed PATH');
}

function validatorEnvironment() {
  const env = { ...process.env };
  // Bash may execute BASH_ENV before parsing stdin; syntax checks must not run
  // any user's startup hooks. Fish is invoked with --no-config as well.
  delete env.BASH_ENV;
  delete env.ENV;
  return env;
}

function fishAvailable() {
  const result = spawnSync('fish', ['--version'], { encoding: 'utf8', env: validatorEnvironment() });
  return !result.error && result.status === 0;
}

function syntax(text, shell, target, hasFish = fishAvailable()) {
  if (shell === 'fish') {
    // Hosts without Fish cannot execute these files; report the skipped check.
    if (!hasFish) return;
    const result = spawnSync('fish', ['--no-config', '-n'], { input: text, encoding: 'utf8', env: validatorEnvironment() });
    // Parser diagnostics can echo a credential assignment from an existing profile.
    if (result.error || result.status !== 0) throw new Error(`Fish syntax validation failed for ${target}.`);
    return;
  }
  const result = spawnSync(shell, ['-n'], { input: text, encoding: 'utf8', env: validatorEnvironment() });
  // Parser diagnostics can echo a credential assignment from an existing profile.
  if (result.error || result.status !== 0) throw new Error(`Shell syntax validation failed for ${target}; no diagnostic contents printed.`);
}

function operands(home, relative) {
  const absolute = path.join(home, relative);
  const homeRelative = `"$HOME/${relative}"`;
  const braceRelative = `"${'${HOME}'}/${relative}"`;
  const values = new Set([homeRelative, braceRelative, quote(absolute),
    `$HOME/${relative}`, '${HOME}/' + relative, `~/${relative}`]);
  if (!/["`$\\]/.test(absolute)) values.add(`"${absolute}"`);
  return [...values];
}

function loaderCommandMap(home) {
  const commands = new Map();
  const targets = [
    ['env', '.config/shell/env.sh'],
    ['path', '.config/shell/path.sh'],
    ['secrets-env', '.config/secrets/generated/env.sh'],
    ['secrets-load', '.config/secrets/load.sh'],
    ['cache', '.config/azure-mnt-cache/cache.sh'],
    ['local', '.config/shell/local.sh'],
  ];
  for (const [name, relative] of targets) {
    for (const operand of operands(home, relative)) {
      commands.set(`. ${operand}`, name);
      commands.set(`source ${operand}`, name);
      commands.set(`[ ! -r ${operand} ] || . ${operand}`, name);
    }
  }
  return commands;
}

function knownLegacyEnvironmentBlocks(lines) {
  const forms = [
    ['if [ -n "$BASH_VERSION" ]; then', 'if [ -r "$HOME/.config/shell/env.sh" ]; then', '. "$HOME/.config/shell/env.sh"', 'fi', 'fi'],
    ['if [ -n "$BASH_VERSION" ]; then', 'if [ -f "$HOME/.config/shell/env.sh" ]; then', '. "$HOME/.config/shell/env.sh"', 'fi', 'fi'],
    ['if [ -r "$HOME/.config/shell/env.sh" ]; then', '. "$HOME/.config/shell/env.sh"', 'fi'],
    ['if [ -f "$HOME/.config/shell/env.sh" ]; then', '. "$HOME/.config/shell/env.sh"', 'fi'],
  ];
  // Older installations replaced loader commands with ':' but left their
  // guards behind. These empty blocks are safe to migrate on subsequent runs.
  forms.push(...forms.map(form => form.map(line => line === '. "$HOME/.config/shell/env.sh"' ? ':' : line)));
  const meaningful = lines.map((line, index) => ({ line: line.trim(), index }))
    .filter(({ line }) => line && !line.startsWith('#'));
  const removed = new Set();
  let depth = 0;
  for (let i = 0; i < meaningful.length; i++) {
    for (const form of forms) {
      if (depth === 0 && form.every((line, offset) => meaningful[i + offset]?.line === line)) {
        for (let offset = 0; offset < form.length; offset++) removed.add(meaningful[i + offset].index);
        i += form.length - 1;
        break;
      }
    }
    if (!removed.has(meaningful[i].index)) depth = controlDepthChange(meaningful[i].line, depth);
  }
  return removed;
}

function controlDepthChange(line, depth) {
  if (/^(?:fi|esac|done)\b/.test(line)) return Math.max(0, depth - 1);
  if (line === '}' || line === ')') return Math.max(0, depth - 1);
  if (line === '{' || line === '(') return depth + 1;
  if (/^(?:function\s+[A-Za-z_][A-Za-z0-9_]*(?:\s*\(\s*\))?|[A-Za-z_][A-Za-z0-9_]*\s*\(\s*\))(?:\s|\{|$)/.test(line)) {
    if (!line.includes('{')) return depth;
    return /}\s*$/.test(line) ? depth : depth + 1;
  }
  if (/^(?:if|case|for|while|until|select)\b/.test(line)) {
    if (/\b(?:fi|esac|done)\s*;?\s*$/.test(line)) return depth;
    return depth + 1;
  }
  return depth;
}

function defaultBashEnvAssignments(home) {
  const absolute = path.join(home, '.bash_env');
  return new Set([
    'BASH_ENV="$HOME/.bash_env"',
    "BASH_ENV='$HOME/.bash_env'",
    'BASH_ENV=${HOME}/.bash_env',
    `BASH_ENV=${quote(absolute)}`,
    `BASH_ENV="${absolute}"`,
    `BASH_ENV='${absolute}'`,
  ]);
}

function knownMiseActivationCommands(home) {
  const absolute = path.join(home, '.local/bin/mise');
  const executables = new Set([
    'mise', absolute, quote(absolute),
    '$HOME/.local/bin/mise', '"$HOME/.local/bin/mise"',
    '${HOME}/.local/bin/mise', '"${HOME}/.local/bin/mise"',
  ]);
  return new Set([...executables].map(executable => `eval "$(${executable} activate bash)"`));
}

function cleanProfile(text, home) {
  text = stripOwnedBlocks(text);
  const lines = text.split('\n');
  const knownBlocks = knownLegacyEnvironmentBlocks(lines);
  const commands = loaderCommandMap(home);
  const miseActivations = knownMiseActivationCommands(home);
  const integrationPaths = [
    '.config/shell/env.sh', '.config/shell/path.sh', '.config/shell/local.sh',
    '.config/secrets/generated/env.sh', '.config/secrets/load.sh', '.config/azure-mnt-cache/cache.sh',
  ];
  const defaultBashEnv = defaultBashEnvAssignments(home);
  let depth = 0;
  return lines.map((line, index) => {
    if (knownBlocks.has(index)) return '';
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;

    const knownLoader = commands.get(trimmed);
    if (knownLoader) {
      if (depth > 0) throw new Error('Unsupported conditional shell loader; migrate it to a standalone known loader command before setup.');
      return `${line.match(/^\s*/)[0]}:`;
    }
    if (/^(?:export\s+)?BASH_ENV\s*=/.test(trimmed)) {
      const assignment = trimmed.replace(/^export\s+/, '');
      if (defaultBashEnv.has(assignment)) return `${line.match(/^\s*/)[0]}:`;
      throw new Error('Custom BASH_ENV assignment in a profile: move its absolute path into the invoking environment, or migrate it explicitly before setup.');
    }
    if (miseActivations.has(trimmed)) {
      if (depth > 0) throw new Error('Conditional Mise activation is ambiguous; migrate the conditional explicitly before shell:setup.');
      return `${line.match(/^\s*/)[0]}:`;
    }
    const embedsKnownMiseActivation = [...miseActivations].some(command => trimmed.includes(command));
    if (embedsKnownMiseActivation || (/\beval\b/.test(trimmed) && /\bmise["']?\s+activate\s+bash\b/.test(trimmed))) {
      throw new Error('Unsupported inline or conditional Mise activation; migrate its condition explicitly before shell:setup.');
    }
    const referencesIntegration = integrationPaths.some(target => trimmed.includes(target));
    const sourcesIntegration = /(?:^|[;&|\s])(?:source|\.)\s+/.test(trimmed);
    const conditionalIntegration = /^(?:if|elif|while|until|case)\b/.test(trimmed) && referencesIntegration;
    if (referencesIntegration && (sourcesIntegration || conditionalIntegration)) {
      throw new Error('Unsupported conditional or inline shell integration; split it into a standalone known loader command before setup.');
    }
    depth = controlDepthChange(trimmed, depth);
    return line;
  }).join('\n');
}

function sourceCommands(home, relative) {
  const result = new Set();
  for (const operand of operands(home, relative)) {
    result.add(`. ${operand}`);
    result.add(`source ${operand}`);
  }
  return result;
}

function knownSimpleFileGuardIndexes(lines, home, relative) {
  const sources = sourceCommands(home, relative);
  const sourceTokens = [...sources];
  const fileOperands = operands(home, relative);
  const tests = fileOperands.flatMap(operand => [`if [ -f ${operand} ]; then`, `if [ -r ${operand} ]; then`]);
  const oneLine = new Set();
  for (const test of tests) {
    for (const source of sourceTokens) {
      oneLine.add(`${test} ${source}; fi`);
      oneLine.add(`${test} ${source} ; fi`);
    }
  }
  const meaningful = lines.map((line, index) => ({ line: line.trim(), index }))
    .filter(({ line }) => line && !line.startsWith('#'));
  const removed = new Set();
  let depth = 0;
  for (let i = 0; i < meaningful.length; i++) {
    const current = meaningful[i].line;
    if (depth === 0 && oneLine.has(current)) {
      removed.add(meaningful[i].index);
      continue;
    }
    if (depth === 0 && tests.includes(current) && sourceTokens.includes(meaningful[i + 1]?.line)
      && meaningful[i + 2]?.line === 'fi') {
      removed.add(meaningful[i].index);
      removed.add(meaningful[i + 1].index);
      removed.add(meaningful[i + 2].index);
      i += 2;
      continue;
    }
    depth = controlDepthChange(current, depth);
  }
  return removed;
}

// Earlier installations kept this interactive-only delegation outside the
// managed block. Match the complete structure so custom conditions still fail.
function knownInteractiveBashrcIndexes(lines) {
  const prefix = [
    'if [ -n "${BASH_VERSION-}" ]; then',
    'case $- in',
    '*i*) [ ! -r "$HOME/.bashrc" ] || . "$HOME/.bashrc" ;;',
  ];
  const forms = [
    [...prefix, 'esac', 'fi'],
    [...prefix.slice(0, 2), '*i*) if [ -r "$HOME/.bashrc" ]; then . "$HOME/.bashrc"; fi ;;', 'esac', 'fi'],
    [...prefix, '*)', 'if [ "${BASH_ENV-}" != "$HOME/.bash_env" ]; then',
      ':', 'fi', ';;', 'esac', 'else', ':', 'fi'],
  ];
  const meaningful = lines.map((line, index) => ({ line: line.trim(), index }))
    .filter(({ line }) => line && !line.startsWith('#'));
  const recognized = new Set();
  let depth = 0;
  for (let i = 0; i < meaningful.length; i++) {
    const form = depth === 0 && forms.find(form =>
      form.every((line, offset) => meaningful[i + offset]?.line === line));
    if (form) {
      for (let offset = 0; offset < form.length; offset++) recognized.add(meaningful[i + offset].index);
      i += form.length - 1;
    } else {
      depth = controlDepthChange(meaningful[i].line, depth);
    }
  }
  return recognized;
}

function knownBashrcConditionalIndexes(lines, home) {
  const sourceCommands = sourceCommandsForBashrc(home);
  const sourceTokens = [...sourceCommands];
  const operandsForBashrc = operands(home, '.bashrc');
  const conditionals = ['if [ -n "$BASH_VERSION" ]; then', 'if [ "$BASH" ]; then'];
  const tests = operandsForBashrc.flatMap(operand => [`if [ -f ${operand} ]; then`, `if [ -r ${operand} ]; then`]);
  const meaningful = lines.map((line, index) => ({ line: line.trim(), index }))
    .filter(({ line }) => line && !line.startsWith('#'));
  const removed = new Set();
  let depth = 0;
  for (let i = 0; i < meaningful.length; i++) {
    const block = meaningful.slice(i, i + 5).map(item => item.line);
    if (depth === 0 && conditionals.includes(block[0]) && tests.includes(block[1])
      && sourceTokens.includes(block[2]) && block[3] === 'fi' && block[4] === 'fi') {
      for (let offset = 0; offset < 5; offset++) removed.add(meaningful[i + offset].index);
      i += 4;
    } else {
      depth = controlDepthChange(meaningful[i].line, depth);
    }
  }
  return new Set([...removed, ...knownSimpleFileGuardIndexes(lines, home, '.bashrc'),
    ...knownInteractiveBashrcIndexes(lines)]);
}

function sourceCommandsForBashrc(home) {
  return sourceCommands(home, '.bashrc');
}

function hasBashrcSource(text, home) {
  const lines = text.split('\n');
  const knownConditional = knownBashrcConditionalIndexes(lines, home);
  const commands = sourceCommandsForBashrc(home);
  let depth = 0;
  let found = false;
  for (let index = 0; index < lines.length; index++) {
    if (knownConditional.has(index)) continue;
    const trimmed = lines[index].trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (commands.has(trimmed)) {
      if (depth > 0) throw new Error('Unsupported conditional .bashrc source; use the known Bash-version/file-exists startup block before setup.');
      found = true;
      continue;
    }
    if (trimmed.includes('.bashrc') && /(?:^|[;&|\s])(?:source|\.)\s/.test(trimmed)) {
      throw new Error('Unsupported inline or conditional .bashrc source; use a standalone source command or the known default startup block.');
    }
    depth = controlDepthChange(trimmed, depth);
  }
  return found || knownConditional.size > 0;
}

function hasProfileSource(text, home) {
  const lines = text.split('\n');
  const knownConditional = knownSimpleFileGuardIndexes(lines, home, '.profile');
  const commands = sourceCommands(home, '.profile');
  let depth = 0;
  let found = false;
  for (let index = 0; index < lines.length; index++) {
    if (knownConditional.has(index)) continue;
    const trimmed = lines[index].trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (commands.has(trimmed)) {
      if (depth > 0) throw new Error('Unsupported conditional .profile delegation; use a standalone source command or a known file-exists guard.');
      found = true;
      continue;
    }
    if (trimmed.includes('.profile') && /(?:^|[;&|\s])(?:source|\.)\s/.test(trimmed)) {
      throw new Error('Unsupported inline or conditional .profile delegation; use a standalone source command or a known file-exists guard.');
    }
    depth = controlDepthChange(trimmed, depth);
  }
  return found || knownConditional.size > 0;
}

function activeCacheLoader(text, home) {
  const lines = stripOwnedBlocks(text).split('\n');
  const knownBlocks = knownLegacyEnvironmentBlocks(lines);
  const commands = loaderCommandMap(home);
  let depth = 0;
  for (let index = 0; index < lines.length; index++) {
    if (knownBlocks.has(index)) continue;
    const trimmed = lines[index].trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (commands.get(trimmed) === 'cache' && depth === 0) return true;
    if (depth === 0 && /^(?:return|exit)(?:\s|$)/.test(trimmed)) return false;
    depth = controlDepthChange(trimmed, depth);
  }
  return false;
}

function configRoot(home, env) {
  const value = env.XDG_CONFIG_HOME || path.join(home, '.config');
  if (!path.isAbsolute(value)) throw new Error('XDG_CONFIG_HOME must be an absolute path for Fish setup.');
  const root = path.resolve(value);
  const relative = path.relative(home, root);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Fish XDG_CONFIG_HOME must be within the user home; setup refuses to write a startup hook outside it.');
  }
  return root;
}

function fishLoaderContent() {
  return `${fishLoaderHeader}\nif test -r "$HOME/.config/shell/env.fish"\n    source "$HOME/.config/shell/env.fish"\nend\nfunction __my_opencode_path_finalize --on-event fish_prompt\n    if test -r "$HOME/.config/shell/path.fish"\n        source "$HOME/.config/shell/path.fish"\n    end\nend\n`;
}

function previousFishLoaderContent() {
  return `${fishLoaderHeader}\nif test -r "$HOME/.config/shell/env.fish"\n    source "$HOME/.config/shell/env.fish"\nend\n`;
}

export function setup({ home = os.homedir(), platform = process.platform, env = process.env, dryRun = false, replaceLegacy = false } = {}) {
  if (!['linux', 'darwin'].includes(platform)) throw new Error('shell:setup supports Linux and macOS Bash/Fish environments only.');
  home = path.resolve(home);
  const fishRoot = configRoot(home, env);
  const fishLoader = path.join(fishRoot, 'fish', 'conf.d', fishLoaderName);
  const changes = new Map();
  const plan = (name, content, shell) => {
    const target = path.join(home, name);
    assertSafe(home, target);
    if (shell) syntax(content, shell, name, hasFish);
    if (!fs.existsSync(target) || read(target) !== content) changes.set(target, content);
  };
  const hasFish = fishAvailable();
  const profileCandidates = ['.profile', '.bashrc', '.bash_profile', '.bash_login',
    '.config/shell/env.sh', '.config/shell/env.fish', '.config/shell/path.sh', '.config/shell/path.fish',
    '.config/shell/installed-v1', '.config/shell/legacy-bash-env.sh', '.bash_env',
    '.config/secrets/manifest.json', '.config/secrets/generated/names', '.config/secrets/generated/env.sh',
    '.config/secrets/load.sh', '.config/azure-mnt-cache/shell-enabled', '.config/azure-mnt-cache/docker-enabled',
    '.config/azure-mnt-cache/cache.sh', '.config/shell/local.sh'];
  for (const name of profileCandidates) assertSafe(home, path.join(home, name));
  assertSafe(home, fishLoader);

  const profileNames = ['.profile', '.bashrc', ...['.bash_profile', '.bash_login'].filter(name => fs.existsSync(path.join(home, name)))];
  const originals = Object.fromEntries(profileNames.map(name => [name, read(path.join(home, name))]));
  const installed = read(path.join(home, '.config/shell/installed-v1')) === '1\n';
  const oldShared = read(path.join(home, '.config/shell/env.sh'));
  const shared = read(path.join(directory, 'templates/env.sh'));
  if (oldShared && oldShared !== shared && !installed && !replaceLegacy) {
    throw new Error('Existing shared env.sh is not managed by this installer. Review its customizations, then use --replace-legacy-loader to replace it with a private backup.');
  }
  const oldSharedFish = read(path.join(home, '.config/shell/env.fish'));
  const sharedFish = read(path.join(directory, 'templates/env.fish'));
  if (oldSharedFish && oldSharedFish !== sharedFish && !installed && !replaceLegacy) {
    throw new Error('Existing shared env.fish is not managed by this installer. Review its customizations, then use --replace-legacy-loader to replace it with a private backup.');
  }
  const oldPath = read(path.join(home, '.config/shell/path.sh'));
  const pathScript = read(path.join(directory, 'templates/path.sh'));
  if (oldPath && oldPath !== pathScript && !installed && !replaceLegacy) {
    throw new Error('Existing shared path.sh is not managed by this installer. Review it, then use --replace-legacy-loader to replace it with a private backup.');
  }
  const oldPathFish = read(path.join(home, '.config/shell/path.fish'));
  const pathFish = read(path.join(directory, 'templates/path.fish'));
  if (oldPathFish && oldPathFish !== pathFish && !installed && !replaceLegacy) {
    throw new Error('Existing shared path.fish is not managed by this installer. Review it, then use --replace-legacy-loader to replace it with a private backup.');
  }

  const fishHook = fishLoaderContent();
  const oldFishHook = read(fishLoader);
  if (oldFishHook && oldFishHook !== fishHook && oldFishHook !== previousFishLoaderContent()) {
    throw new Error(`Refusing to overwrite unmanaged Fish startup hook ${fishLoader}; move or merge it manually, then rerun shell:setup.`);
  }

  const cacheEnabled = fs.existsSync(path.join(home, '.config/azure-mnt-cache/shell-enabled'))
    || fs.existsSync(path.join(home, '.config/azure-mnt-cache/docker-enabled'))
    || [...Object.values(originals), ...(oldShared && oldShared !== shared ? [oldShared] : [])].some(text => activeCacheLoader(text, home));
  if (cacheEnabled) plan('.config/azure-mnt-cache/shell-enabled', '1\n');

  const manifestFile = path.join(home, '.config/secrets/manifest.json');
  if (fs.existsSync(manifestFile)) {
    const manifest = JSON.parse(read(manifestFile));
    if (!Array.isArray(manifest.secrets)) throw new Error('Invalid secrets manifest.');
    const names = manifest.secrets.filter(entry => entry && entry.output === 'env').map(entry => entry.name);
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
    let regularFile = false;
    try { regularFile = path.isAbsolute(custom) && fs.statSync(custom).isFile(); } catch {}
    if (!regularFile) throw new Error('Custom BASH_ENV must name an existing absolute regular file.');
    if (read(custom).includes('.bash_env') || read(custom).includes('.config/shell/env.sh')) throw new Error('Custom BASH_ENV already references shell integration; migrate it explicitly to avoid a startup cycle.');
    const content = `# Preserved custom BASH_ENV hook.\n[ ! -r ${quote(custom)} ] || . ${quote(custom)}\n`;
    if (fs.existsSync(legacy) && read(legacy) !== content) throw new Error('A different legacy Bash hook already exists; merge it explicitly before setup.');
    plan('.config/shell/legacy-bash-env.sh', content, 'bash');
  } else if (oldWrapper && oldWrapper !== wrapper && oldWrapper !== previousBashEnvWrapper) {
    // Recognize only thin wrappers. Preserve arbitrary existing hook code privately.
    const thin = /^\s*(?:#.*)?$|^\s*(?:if \[ -r "\$HOME\/\.config\/shell\/env\.sh" \]; then|\. "\$HOME\/\.config\/shell\/env\.sh"|fi|\[ ! -r "\$HOME\/\.config\/shell\/env\.sh" \] \|\| \. "\$HOME\/\.config\/shell\/env\.sh")\s*$/;
    if (!oldWrapper.split('\n').every(line => thin.test(line))) {
      if (oldWrapper.includes('.bash_env')) throw new Error('Existing .bash_env may recurse; migrate it explicitly before setup.');
      if (fs.existsSync(legacy) && read(legacy) !== oldWrapper) throw new Error('A legacy Bash hook already exists; merge it explicitly before setup.');
      plan('.config/shell/legacy-bash-env.sh', oldWrapper, 'bash');
    }
  }

  plan('.config/shell/path.sh', pathScript, 'sh');
  plan('.config/shell/path.fish', pathFish, 'fish');
  plan('.config/shell/env.sh', shared, 'sh');
  plan('.config/shell/env.fish', sharedFish, 'fish');
  // The fish conf.d hook is an installer-owned file, not a place for merging
  // arbitrary user snippets. A collision is refused above before any writes.
  const fishRelative = path.relative(home, fishLoader);
  plan(fishRelative, fishHook, 'fish');
  plan('.bash_env', wrapper, 'bash');

  const cleanProfiles = Object.fromEntries(profileNames.map(name => [name, cleanProfile(originals[name], home)]));
  const login = ['.bash_profile', '.bash_login', '.profile'].find(name => Object.hasOwn(originals, name));
  let bashrcSourceHost = null;
  if (!hasBashrcSource(cleanProfiles[login], home)) {
    bashrcSourceHost = login !== '.profile' && hasProfileSource(cleanProfiles[login], home) ? '.profile' : login;
  }
  for (const name of profileNames) {
    const clean = cleanProfiles[name];
    let hook = `${start}\n${loader}\n`;
    if (name === '.bashrc') {
      hook += 'case $- in\n    *i*) if command -v mise >/dev/null 2>&1; then eval "$(mise activate bash)"; fi ;;\nesac\n';
    } else if (name === bashrcSourceHost && !hasBashrcSource(clean, home)) {
      hook += 'if [ -n "${BASH_VERSION-}" ]; then\n    case $- in\n        *i*) [ ! -r "$HOME/.bashrc" ] || . "$HOME/.bashrc" ;;\n    esac\nfi\n';
    }
    hook += `${end}\n`;
    const finalizer = `${pathStart}\n${pathLoader}\n${pathEnd}\n`;
    const content = `${hook}${clean}${clean && !clean.endsWith('\n') ? '\n' : ''}${finalizer}`;
    plan(name, content, name === '.profile' ? 'sh' : 'bash');
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

function parseArguments(args) {
  const options = { dryRun: false, check: false, replaceLegacy: false };
  for (const arg of args) {
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--check') options.check = true;
    else if (arg === '--replace-legacy-loader') options.replaceLegacy = true;
    else throw new Error(`Unknown argument: ${arg}\nUsage: shell:setup [--check] [--dry-run] [--replace-legacy-loader]`);
  }
  return options;
}

function selectedLogin(home) {
  return ['.bash_profile', '.bash_login', '.profile'].find(name => fs.existsSync(path.join(home, name))) ?? '.profile (created by setup)';
}

function checkReport({ home, env, replaceLegacy }) {
  home = path.resolve(home);
  const hasFish = fishAvailable();
  let root = '(invalid)';
  try { root = configRoot(home, env); } catch {}
  const cacheMarker = ['shell-enabled', 'docker-enabled'].some(name => fs.existsSync(path.join(home, '.config/azure-mnt-cache', name)));
  const cacheLoader = ['.profile', '.bashrc', '.bash_profile', '.bash_login']
    .map(name => read(path.join(home, name))).some(text => activeCacheLoader(text, home));
  console.log('Read-only structural check (shell configs and secret values are not sourced or printed).');
  console.log('Supported: Bash + POSIX .profile on Linux/macOS; optional Fish; Zsh is not managed.');
  console.log(`Validators: bash and sh syntax checks; Fish ${hasFish ? 'syntax check available' : 'unavailable (Fish syntax check skipped)'}.`);
  console.log(`Fish config root: ${root}`);
  console.log(`Bash login entrypoint: ${selectedLogin(home)}.`);
  console.log(`Cache integration: ${cacheMarker ? 'enabled by marker' : cacheLoader ? 'active direct loader detected' : 'disabled'}.`);
  try {
    const result = setup({ home, env, dryRun: true, replaceLegacy });
    console.log(result.changed.length ? `Planned paths (${result.changed.length}):` : 'Planned paths: none (already current).');
    for (const target of result.changed) console.log(`  ${target}`);
    console.log('Check complete; no files were written.');
    return 0;
  } catch (error) {
    console.error(`Blocker: ${error.message}`);
    console.log('Check stopped; no files were written.');
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.check) {
      process.exitCode = checkReport({ home: os.homedir(), env: process.env, replaceLegacy: options.replaceLegacy });
    } else {
      const result = setup({ dryRun: options.dryRun, replaceLegacy: options.replaceLegacy });
      if (options.dryRun) {
        console.log(`Dry run: ${result.changed.length} file(s) would change; no files written.`);
        for (const target of result.changed) console.log(target);
      } else {
        console.log(result.changed.length ? `Installed deterministic Bash/Fish setup (${result.changed.length} changed files). Private backup: ${result.backup}` : 'Bash/Fish setup is already current; no changes.');
        console.log('Open a new Bash or Fish shell afterward. Zsh, existing clean processes and systemd/cron need their own explicit environment integration.');
      }
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
