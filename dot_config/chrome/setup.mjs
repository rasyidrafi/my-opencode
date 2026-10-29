import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const VERSION_TIMEOUT_MS = 3_000;
const FLATPAK_TIMEOUT_MS = 3_000;
const BROWSER_LAUNCHERS = [
  {
    family: 'Chrome',
    names: ['google-chrome', 'google-chrome-stable'],
    fallbackPaths: ['/opt/google/chrome/google-chrome', '/opt/google/chrome/chrome'],
  },
  {
    family: 'Edge',
    names: ['microsoft-edge', 'microsoft-edge-stable'],
    fallbackPaths: ['/opt/microsoft/msedge/microsoft-edge', '/opt/microsoft/msedge/msedge'],
  },
  {
    family: 'Chromium',
    names: ['chromium', 'chromium-browser'],
    fallbackPaths: ['/snap/bin/chromium', '/usr/lib/chromium/chromium'],
  },
  {
    family: 'Brave',
    names: ['brave-browser', 'brave-browser-stable'],
    fallbackPaths: ['/opt/brave.com/brave/brave-browser'],
  },
];
const FLATPAK_BROWSER_IDS = new Set([
  'com.google.Chrome',
  'org.chromium.Chromium',
  'com.microsoft.Edge',
  'com.brave.Browser',
]);

function isExecutableFile(filePath) {
  try {
    return fs.statSync(filePath).isFile() && (fs.accessSync(filePath, fs.constants.X_OK), true);
  } catch {
    return false;
  }
}

function pathsFromEnvironment(env = process.env) {
  return (env.PATH || '').split(path.delimiter).filter(Boolean);
}

function findOnPath(name, env = process.env, executable = isExecutableFile) {
  for (const directory of pathsFromEnvironment(env)) {
    const candidate = path.join(directory, name);
    if (executable(candidate)) return candidate;
  }
  return undefined;
}

export function discoverBrowserCandidates({
  env = process.env,
  executable = isExecutableFile,
  includeFallbacks = true,
} = {}) {
  const candidates = [];
  const seen = new Set();
  const add = (filePath, family) => {
    if (filePath && !seen.has(filePath) && executable(filePath)) {
      seen.add(filePath);
      candidates.push({ path: filePath, family });
    }
  };

  // Keep browser-family preference stable while resolving each launcher from PATH first.
  for (const browser of BROWSER_LAUNCHERS) {
    for (const name of browser.names) add(findOnPath(name, env, executable), browser.family);
    if (includeFallbacks) {
      for (const filePath of browser.fallbackPaths) add(filePath, browser.family);
    }
  }
  return candidates;
}

function versionResult(executablePath, spawn) {
  const result = spawn(executablePath, ['--version'], {
    encoding: 'utf8',
    timeout: VERSION_TIMEOUT_MS,
    maxBuffer: 64 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = [result.stdout, result.stderr]
    .filter(value => typeof value === 'string' && value.trim())
    .join('\n')
    .trim();
  if (result.error) {
    return { ok: false, detail: result.error.code === 'ETIMEDOUT' ? 'version probe timed out' : result.error.message };
  }
  if (result.status !== 0) return { ok: false, detail: `version probe exited with status ${result.status}` };
  const hasBrowserName = /\b(?:google\s+chrome|chrome|microsoft\s+edge|edge|chromium|brave(?:\s+browser)?)\b/i.test(output);
  const hasVersion = /\d+(?:\.\d+)+/.test(output);
  if (!output || !hasBrowserName || !hasVersion) {
    return { ok: false, detail: 'version probe did not return a recognizable browser version' };
  }
  return { ok: true, version: output.replace(/\s+/g, ' ') };
}

function parseOsReleaseValue(osRelease, key) {
  const line = osRelease.split(/\r?\n/).find(candidate => candidate.startsWith(`${key}=`));
  if (!line) return '';
  let value = line.slice(key.length + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  } else {
    value = value.replace(/\s+#.*$/, '').trim();
  }
  return value;
}

export function validateHost(platform, arch, osRelease) {
  if (platform !== 'linux') throw new Error('chrome:setup supports Linux only; Windows and macOS are not supported.');
  const id = parseOsReleaseValue(osRelease, 'ID').toLowerCase();
  const idLike = parseOsReleaseValue(osRelease, 'ID_LIKE').toLowerCase().split(/\s+/).filter(Boolean);
  if (!['debian', 'ubuntu'].includes(id) && !idLike.some(token => ['debian', 'ubuntu'].includes(token))) {
    throw new Error('chrome:setup currently supports Debian-family Linux only (apt-get required).');
  }
  if (arch !== 'x64') throw new Error('Google Chrome for Linux requires amd64 (x64); this architecture is not supported.');
}

function inspectFlatpakBrowsers({ env, spawn, executable = isExecutableFile }) {
  const flatpak = findOnPath('flatpak', env, executable)
    || ['/usr/bin/flatpak', '/bin/flatpak'].find(executable);
  if (!flatpak) return { present: false };

  const result = spawn(flatpak, ['list', '--app', '--columns=application'], {
    encoding: 'utf8',
    timeout: FLATPAK_TIMEOUT_MS,
    maxBuffer: 64 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) {
    const detail = result.error?.code === 'ETIMEDOUT'
      ? 'Flatpak app listing timed out'
      : `Flatpak app listing failed: ${result.error?.message || `exit ${result.status}`}`;
    return { present: true, unknown: true, detail };
  }
  const ids = (result.stdout || '').split(/\r?\n/).map(line => line.trim()).filter(id => FLATPAK_BROWSER_IDS.has(id));
  return { present: true, ids: [...new Set(ids)] };
}

function run(command, args, spawn, options = {}) {
  const result = spawn(command, args, { stdio: 'inherit', ...options });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} failed: ${result.error?.message || `exit ${result.status}`}`);
  }
}

export async function setup(dependencies = {}) {
  const {
    platform = process.platform,
    arch = process.arch,
    env = process.env,
    spawn = spawnSync,
    isExecutable = isExecutableFile,
    includeFallbacks = true,
    fsImpl = fs,
    tmpdir = os.tmpdir(),
    readOsRelease = () => fs.readFileSync('/etc/os-release', 'utf8'),
    fetchImpl = (...args) => fetch(...args),
    getuid = () => process.getuid?.() ?? 1,
    log = message => console.log(message),
  } = dependencies;

  // Reuse detection is Linux-only and intentionally precedes distro and architecture checks.
  if (platform !== 'linux') throw new Error('chrome:setup supports Linux only; Windows and macOS are not supported.');
  const candidates = discoverBrowserCandidates({ env, executable: isExecutable, includeFallbacks });
  for (const candidate of candidates) {
    const result = versionResult(candidate.path, spawn);
    if (result.ok) {
      log(`Using installed ${candidate.family} browser: ${result.version} (${candidate.path}).`);
      return;
    }
    candidate.probeFailure = result.detail;
  }
  if (candidates.length) {
    const details = candidates.map(candidate => `${candidate.path}: ${candidate.probeFailure}`).join('; ');
    throw new Error(`Found browser launcher(s), but none returned a verifiable browser version (${details}). Fix or remove the broken launcher(s); refusing to install a replacement.`);
  }

  const flatpak = inspectFlatpakBrowsers({ env, spawn, executable: isExecutable });
  if (flatpak.unknown) {
    throw new Error(`${flatpak.detail}; cannot verify whether a supported Flatpak browser is installed. Install or verify a native browser before using chrome:setup.`);
  }
  if (flatpak.ids?.length) {
    throw new Error(`Found Flatpak browser app(s): ${flatpak.ids.join(', ')}. chrome:setup does not verify or launch Flatpak apps; install a native browser or use the Flatpak browser directly. Refusing to install a replacement.`);
  }

  validateHost(platform, arch, readOsRelease());
  run('apt-get', ['--version'], spawn, { stdio: 'ignore' });
  const root = getuid() === 0;
  // Authenticate before downloading; apt needs administrative privileges.
  if (!root) run('sudo', ['-v'], spawn);
  const directory = fsImpl.mkdtempSync(path.join(tmpdir, 'chrome-setup-'));
  try {
    const deb = path.join(directory, 'google-chrome-stable_current_amd64.deb');
    log('Downloading Google Chrome Stable from Google…');
    const response = await fetchImpl('https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb', {
      signal: AbortSignal.timeout(300_000),
    });
    if (!response.ok || !response.body) throw new Error(`Chrome download failed: HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body), fsImpl.createWriteStream(deb, { mode: 0o600 }));
    // Let apt's sandbox user read the package, without opening directory writes.
    fsImpl.chmodSync(directory, 0o755);
    fsImpl.chmodSync(deb, 0o644);
    const apt = args => root ? run('apt-get', args, spawn) : run('sudo', ['apt-get', ...args], spawn);
    apt(['update']);
    apt(['install', '-y', deb]);
    const installed = versionResult('google-chrome-stable', spawn);
    if (!installed.ok) throw new Error(`Chrome installation completed, but its version could not be verified: ${installed.detail}`);
    log(`Chrome is ready (${installed.version}). No browser was launched.`);
  } finally {
    fsImpl.rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  setup().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
