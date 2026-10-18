import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export function validateHost(platform, arch, osRelease) {
  if (platform !== 'linux') throw new Error('chrome:setup supports Linux only; Windows and macOS are not supported.');
  if (arch !== 'x64') throw new Error('Google Chrome for Linux requires amd64 (x64); this architecture is not supported.');
  const id = osRelease.match(/^ID=["']?([^"'\r\n]+)/m)?.[1];
  if (!['debian', 'ubuntu'].includes(id)) {
    throw new Error('chrome:setup currently supports Debian and Ubuntu only (apt-get required).');
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} failed: ${result.error?.message || `exit ${result.status}`}`);
  }
}

export async function setup() {
  // Reject unsupported hosts before accessing Linux files or invoking commands.
  validateHost(process.platform, process.arch,
    process.platform === 'linux' ? fs.readFileSync('/etc/os-release', 'utf8') : '');
  const existing = spawnSync('google-chrome-stable', ['--version'], { encoding: 'utf8' });
  if (existing.status === 0) {
    console.log(`Already installed: ${existing.stdout.trim()}`);
    return;
  }
  run('apt-get', ['--version'], { stdio: 'ignore' });
  const root = process.getuid() === 0;
  // Authenticate before downloading; apt needs administrative privileges.
  if (!root) run('sudo', ['-v']);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-setup-'));
  try {
    const deb = path.join(directory, 'google-chrome-stable_current_amd64.deb');
    console.log('Downloading Google Chrome Stable from Google…');
    const response = await fetch('https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb', {
      signal: AbortSignal.timeout(300_000),
    });
    if (!response.ok || !response.body) throw new Error(`Chrome download failed: HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(deb, { mode: 0o600 }));
    // Let apt's sandbox user read the package, without opening directory writes.
    fs.chmodSync(directory, 0o755);
    fs.chmodSync(deb, 0o644);
    const apt = args => root ? run('apt-get', args) : run('sudo', ['apt-get', ...args]);
    apt(['update']);
    apt(['install', '-y', deb]);
    run('google-chrome-stable', ['--version']);
    console.log('Chrome is ready for browser-use, including headless mode. No browser was launched.');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  setup().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
