import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireTaskPlatform } from '../my-opencode/platform.mjs';

const TASK = 'muse:setup';
const PLATFORMS = ['linux', 'windows'];
const INSTALLER_URLS = {
  linux: 'https://dev.meta.ai/install.sh',
  windows: 'https://dev.meta.ai/install.ps1',
};
const INSTALLER_TIMEOUT = 900_000;
const VERSION_TIMEOUT = 300_000;

function run(command, args, { execute = spawnSync, env = process.env, ...options } = {}) {
  const result = execute(command, args, { stdio: 'inherit', env, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with status ${result.status}.`);
  return result;
}

function installerPath(tempDir, platform) {
  return path.join(tempDir, platform === 'windows' ? 'install.ps1' : 'install.sh');
}

function launcherPath(installDir, platform) {
  return path.join(installDir, platform === 'windows' ? 'muse.cmd' : 'muse');
}

function downloadInstaller(platform, tempDir, { execute }) {
  run('curl', [
    '--fail', '--location', '--silent', '--show-error', '--max-time', '120',
    INSTALLER_URLS[platform], '--output', installerPath(tempDir, platform),
  ], { execute });
}

function runInstaller(platform, tempDir, installDir, { execute, env }) {
  const installEnv = { ...env, MUSE_NO_MODIFY_PATH: '1', MUSE_INSTALL_DIR: installDir };
  if (platform === 'windows') {
    run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', installerPath(tempDir, platform)], {
      execute, env: installEnv, timeout: INSTALLER_TIMEOUT,
    });
  } else {
    run('bash', [installerPath(tempDir, platform)], { execute, env: installEnv, timeout: INSTALLER_TIMEOUT });
  }
}

function verifyLauncher(launcher, platform, { execute }) {
  if (platform === 'windows') {
    run('cmd.exe', ['/d', '/s', '/c', `"${launcher}" --version`], { execute, timeout: VERSION_TIMEOUT });
  } else {
    run(launcher, ['--version'], { execute, timeout: VERSION_TIMEOUT });
  }
}

function hasBwrap(execute) {
  try {
    return execute('bwrap', ['--version'], { stdio: 'ignore' }).status === 0;
  } catch {
    return false;
  }
}

export function setup({ env = process.env, platform = process.platform, execute = spawnSync, log = console.log, warn = console.warn } = {}) {
  requireTaskPlatform(TASK, PLATFORMS, platform, env);
  const home = env.HOME || env.USERPROFILE || os.homedir();
  const installDir = path.join(home, '.local', 'bin');
  const launcher = launcherPath(installDir, platform);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'muse-install-'));
  try {
    downloadInstaller(platform, tempDir, { execute });
    runInstaller(platform, tempDir, installDir, { execute, env });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  if (!fs.existsSync(launcher) || !fs.statSync(launcher).isFile()) {
    throw new Error(`Official installer did not create ${launcher}.`);
  }
  verifyLauncher(launcher, platform, { execute });
  if (platform === 'linux' && !hasBwrap(execute)) {
    warn('bwrap was not found on PATH; Muse Code shell commands need it for the sandbox. Install it with your package manager (for example, sudo apt install bubblewrap) and rerun muse:setup.');
  }
  log(`Muse Code is installed at ${launcher}.`);
  log('Run "muse" in a project to sign in with your Meta account, or set META_API_KEY for headless/SSH use.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    setup();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
