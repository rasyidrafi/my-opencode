import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireTaskPlatform } from '../my-opencode/platform.mjs';

const MODERNZ_FILES = [
  'scripts/modernz.lua',
  'fonts/modernz-icons.ttf',
  'script-opts/modernz.conf',
];
const CONFIG_START = '# >>> mise mpv:setup (ModernZ) >>>';
const CONFIG_END = '# <<< mise mpv:setup (ModernZ) <<<';
const CONFIG_BLOCK = `${CONFIG_START}\n# Use ModernZ instead of mpv's default on-screen controller.\nosc=no\ntitle-bar=no\n${CONFIG_END}`;
const MODERNZ_RELEASE = 'https://github.com/Samillion/ModernZ/releases/latest/download';
const MODERNZ_ASSETS = [
  ['modernz.lua', 'scripts/modernz.lua'],
  ['modernz-icons.ttf', 'fonts/modernz-icons.ttf'],
  ['modernz.conf', 'script-opts/modernz.conf'],
];

function run(command, args, options = {}, spawn = spawnSync) {
  const result = spawn(command, args, { stdio: 'inherit', ...options });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} failed${result.error ? `: ${result.error.message}` : ` (exit ${result.status})`}.`);
  }
  return result;
}

function findExecutable(name, env, fsImpl) {
  for (const directory of (env.PATH || '').split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(directory, name);
    try {
      fsImpl.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {}
  }
  return undefined;
}

function getPackageManager(env, fsImpl) {
  for (const [name, packages] of [
    ['apt-get', ['mpv']],
    ['dnf', ['mpv']],
    ['pacman', ['mpv']],
    ['zypper', ['mpv']],
  ]) {
    const executable = findExecutable(name, env, fsImpl);
    if (executable) return { name, executable, packages };
  }
  throw new Error('No supported package manager found (apt-get, dnf, pacman, or zypper). Install mpv, then rerun mise run mpv:setup.');
}

function allFilesExist(configDir, fsImpl) {
  return MODERNZ_FILES.every(file => {
    try { return fsImpl.statSync(path.join(configDir, file)).isFile(); }
    catch { return false; }
  });
}

function firstProfileLine(contents) {
  return contents.split(/\r?\n/).findIndex(line => /^\s*\[[^\]]+\]\s*(?:#.*)?$/.test(line));
}

function hasManagedConfig(filePath, fsImpl) {
  try {
    const contents = fsImpl.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
    const profileLine = firstProfileLine(contents);
    const globalConfig = profileLine < 0 ? contents : contents.split('\n').slice(0, profileLine).join('\n');
    return globalConfig.includes(CONFIG_BLOCK);
  }
  catch { return false; }
}

function hasOldUosc(configDir, fsImpl) {
  return [
    'scripts/uosc/main.lua',
    'fonts/uosc_icons.otf',
    'fonts/uosc_textures.ttf',
  ].some(file => {
    try { return fsImpl.statSync(path.join(configDir, file)).isFile(); }
    catch { return false; }
  });
}

function setManagedConfig(filePath, fsImpl) {
  let original = '';
  try { original = fsImpl.readFileSync(filePath, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  let contents = original;

  // Migrate the simple uosc config written by the previous setup, preserving
  // unrelated mpv.conf content and any other user's settings.
  contents = contents.replace(
    /# Use uosc instead of mpv's default on-screen controller\.\r?\nosc=no\r?\nosd-bar=no\r?\nborder=no\r?\n?/g,
    '',
  );
  const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const blockPattern = new RegExp(`${escapeRegExp(CONFIG_START)}[\\s\\S]*?${escapeRegExp(CONFIG_END)}\\r?\\n?`, 'g');
  const withoutManagedBlock = contents.replace(blockPattern, '');
  const lineEnding = withoutManagedBlock.includes('\r\n') ? '\r\n' : '\n';
  const lines = withoutManagedBlock.replace(/\r\n/g, '\n').split('\n');
  const profileLine = firstProfileLine(withoutManagedBlock);
  let updated;
  if (profileLine >= 0) {
    const prefix = lines.slice(0, profileLine).join(lineEnding).trimEnd();
    const suffix = lines.slice(profileLine).join(lineEnding).trimEnd();
    updated = `${prefix}${prefix ? `${lineEnding}${lineEnding}` : ''}${CONFIG_BLOCK.replace(/\n/g, lineEnding)}${lineEnding}${lineEnding}${suffix}${lineEnding}`;
  } else {
    const prefix = lines.join(lineEnding).trimEnd();
    updated = `${prefix}${prefix ? `${lineEnding}${lineEnding}` : ''}${CONFIG_BLOCK.replace(/\n/g, lineEnding)}${lineEnding}`;
  }
  if (updated !== original) {
    fsImpl.mkdirSync(path.dirname(filePath), { recursive: true });
    fsImpl.writeFileSync(filePath, updated, { mode: 0o600 });
  }
}

function installPackages(manager, missing, { spawn, uid }) {
  if (!missing.length) return;
  if (uid !== 0) run('sudo', ['-v'], {}, spawn);
  const privileged = args => run(uid === 0 ? manager.executable : 'sudo',
    uid === 0 ? args : ['--', manager.executable, ...args], {}, spawn);
  if (manager.name === 'apt-get') privileged(['update']);
  const packageArgs = {
    'apt-get': ['install', '-y', '--no-install-recommends', ...missing],
    dnf: ['install', '-y', ...missing],
    pacman: ['-S', '--needed', '--noconfirm', ...missing],
    zypper: ['--non-interactive', 'install', '--no-recommends', ...missing],
  }[manager.name];
  privileged(packageArgs);
}

async function fetchAsset(asset, destination, fetchImpl, fsImpl) {
  const response = await fetchImpl(`${MODERNZ_RELEASE}/${asset}`, {
    signal: AbortSignal.timeout(300_000),
  });
  if (!response.ok) throw new Error(`ModernZ download failed for ${asset} (HTTP ${response.status}).`);
  const data = Buffer.from(await response.arrayBuffer());
  if (!data.length) throw new Error(`ModernZ download was empty: ${asset}.`);
  fsImpl.writeFileSync(destination, data, { mode: 0o600 });
}

async function installModernZ(configDir, { fetchImpl, fsImpl, tempRoot }) {
  const directory = fsImpl.mkdtempSync(path.join(tempRoot, 'mpv-modernz-'));
  try {
    for (const [asset, relative] of MODERNZ_ASSETS) {
      const downloaded = path.join(directory, asset);
      await fetchAsset(asset, downloaded, fetchImpl, fsImpl);
      const target = path.join(configDir, relative);
      fsImpl.mkdirSync(path.dirname(target), { recursive: true });
      // Preserve user customizations to ModernZ's settings file.
      if (relative === 'script-opts/modernz.conf' && fsImpl.existsSync(target)) continue;
      fsImpl.copyFileSync(downloaded, target);
    }
  } finally {
    fsImpl.rmSync(directory, { recursive: true, force: true });
  }
}

function removeOldUosc(configDir, fsImpl) {
  // Remove only the uosc files installed by the earlier setup; leave its
  // optional settings file untouched as harmless user data.
  for (const relative of [
    'scripts/uosc/main.lua',
    'fonts/uosc_icons.otf',
    'fonts/uosc_textures.ttf',
  ]) {
    try { fsImpl.unlinkSync(path.join(configDir, relative)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  try { fsImpl.rmdirSync(path.join(configDir, 'scripts/uosc')); }
  catch (error) { if (!['ENOENT', 'ENOTEMPTY'].includes(error.code)) throw error; }
}

export async function setup({
  platform = process.platform,
  env = process.env,
  uid = process.getuid?.() ?? 1,
  home = env.HOME || os.homedir(),
  fsImpl = fs,
  spawn = spawnSync,
  fetchImpl = fetch,
  log = console.log,
  tempRoot = os.tmpdir(),
} = {}) {
  requireTaskPlatform('mpv:setup', ['linux'], platform, env);
  const mpvConfigDir = path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'mpv');
  const mpvConfig = path.join(mpvConfigDir, 'mpv.conf');
  const mpv = findExecutable('mpv', env, fsImpl);
  const version = mpv && spawn(mpv, ['--version'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000,
  });
  const mpvReady = Boolean(version && !version.error && version.status === 0);
  if (mpv && !mpvReady) throw new Error('mpv is on PATH but failed its version check. Repair that installation, then rerun mise run mpv:setup.');

  if (mpvReady && allFilesExist(mpvConfigDir, fsImpl)
    && hasManagedConfig(mpvConfig, fsImpl) && !hasOldUosc(mpvConfigDir, fsImpl)) {
    log('mpv and ModernZ are already set up; no changes made.');
    return;
  }

  if (!mpvReady) {
    const manager = getPackageManager(env, fsImpl);
    const missing = manager.packages.filter(name => !findExecutable(name, env, fsImpl));
    installPackages(manager, missing, { spawn, uid });
  }

  const installedMpv = findExecutable('mpv', env, fsImpl);
  if (!installedMpv) throw new Error('Package installation finished, but mpv was not found on PATH.');
  const installedVersion = run(installedMpv, ['--version'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000,
  }, spawn);

  await installModernZ(mpvConfigDir, { fetchImpl, fsImpl, tempRoot });
  removeOldUosc(mpvConfigDir, fsImpl);
  setManagedConfig(mpvConfig, fsImpl);
  if (!allFilesExist(mpvConfigDir, fsImpl) || !hasManagedConfig(mpvConfig, fsImpl)) {
    throw new Error('ModernZ setup did not complete verification. Rerun mise run mpv:setup to repair it.');
  }
  log(`mpv ${installedVersion.stdout?.trim().split(/\r?\n/)[0] || 'is installed'} with ModernZ is ready.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  setup().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
