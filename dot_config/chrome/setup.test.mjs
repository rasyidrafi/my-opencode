import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discoverBrowserCandidates, setup, validateHost } from './setup.mjs';

function makeTestDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-setup-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function makeExecutable(directory, name) {
  const executable = path.join(directory, name);
  fs.mkdirSync(path.dirname(executable), { recursive: true });
  fs.writeFileSync(executable, '#!/bin/sh\n');
  fs.chmodSync(executable, 0o755);
  return executable;
}

function isolatedSetupDependencies(directory, executablePaths = []) {
  const allowed = new Set(executablePaths);
  return {
    platform: 'linux',
    arch: 'x64',
    env: { PATH: directory },
    isExecutable: executable => allowed.has(executable),
    includeFallbacks: false,
  };
}

test('rejects Windows and macOS before inspecting launchers or the host', async () => {
  for (const platform of ['win32', 'darwin']) {
    await assert.rejects(setup({
      platform,
      isExecutable: () => assert.fail('launcher discovery should not run'),
      readOsRelease: () => assert.fail('os-release should not be read'),
    }), /Linux only/);
  }
});

test('supports exact Debian/Ubuntu IDs and Debian-family ID_LIKE tokens', () => {
  for (const release of [
    'ID=debian\n',
    'ID="ubuntu"\n',
    'ID=linuxmint\nID_LIKE="ubuntu debian"\n',
    'ID=fedora\nID_LIKE="arch ubuntu"\n',
    "ID=debian\nID_LIKE='linux'\n",
  ]) {
    assert.doesNotThrow(() => validateHost('linux', 'x64', release));
  }
});

test('requires an exact supported ID or whitespace ID_LIKE token and x64 for installation', () => {
  for (const release of [
    'ID=fedora\n',
    '',
    'ID=notdebian\n',
    'ID=fedora\nID_LIKE=ubuntuderivative\n',
    'ID=fedora\nID_LIKE="archlinux"\n',
  ]) {
    assert.throws(() => validateHost('linux', 'x64', release), /Debian-family/);
  }
  assert.throws(() => validateHost('linux', 'arm64', 'ID=ubuntu\n'), /amd64/);
  assert.throws(() => validateHost('darwin', 'x64', ''), /Linux only/);
});

test('discovers common launcher names from PATH, including paths with spaces', t => {
  const directory = makeTestDirectory(t);
  const binDirectory = path.join(directory, 'browser bin');
  const names = [
    'google-chrome', 'google-chrome-stable',
    'microsoft-edge', 'microsoft-edge-stable',
    'chromium', 'chromium-browser',
    'brave-browser', 'brave-browser-stable',
  ];
  const expected = names.map(name => makeExecutable(binDirectory, name));
  const candidates = discoverBrowserCandidates({ env: { PATH: binDirectory }, includeFallbacks: false });
  assert.deepEqual(candidates.map(candidate => candidate.path), expected);
  assert.deepEqual(candidates.map(candidate => candidate.family), [
    'Chrome', 'Chrome', 'Edge', 'Edge', 'Chromium', 'Chromium', 'Brave', 'Brave',
  ]);
});

test('checks conventional fallback executable paths when PATH has no browser', () => {
  const fallback = '/opt/google/chrome/google-chrome';
  const candidates = discoverBrowserCandidates({
    env: { PATH: '' },
    executable: filePath => filePath === fallback,
  });
  assert.deepEqual(candidates, [{ path: fallback, family: 'Chrome' }]);
});

test('preserves the PATH launcher path for snap-style symlinks', t => {
  const directory = makeTestDirectory(t);
  const target = makeExecutable(directory, 'package/chromium');
  const snapLauncher = path.join(directory, 'snap/bin/chromium');
  fs.mkdirSync(path.dirname(snapLauncher), { recursive: true });
  fs.symlinkSync(target, snapLauncher);

  const candidates = discoverBrowserCandidates({
    env: { PATH: path.dirname(snapLauncher) },
    includeFallbacks: false,
  });
  assert.equal(candidates[0].path, snapLauncher);
  assert.notEqual(candidates[0].path, fs.realpathSync(snapLauncher));
});

test('a verified installed browser of any supported family skips all installation checks', async t => {
  const cases = [
    ['google-chrome', 'Chrome', 'Google Chrome 136.0.7103.92'],
    ['microsoft-edge-stable', 'Edge', 'Microsoft Edge 136.0.3240.76'],
    ['chromium-browser', 'Chromium', 'Chromium 136.0.7103.92'],
    ['brave-browser-stable', 'Brave', 'Brave Browser 1.78.97'],
  ];
  for (const [name, family, version] of cases) {
    const directory = makeTestDirectory(t);
    const candidate = makeExecutable(directory, name);
    const logs = [];
    const calls = [];
    await setup({
      ...isolatedSetupDependencies(directory, [candidate]),
      arch: 'arm64',
      readOsRelease: () => assert.fail('existing browser should skip distro checks'),
      spawn: (command, args, options) => {
        calls.push({ command, args, options });
        return { status: 0, stdout: `${version}\n`, stderr: '' };
      },
      fetchImpl: () => assert.fail('existing browser should skip network access'),
      log: message => logs.push(message),
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, candidate);
    assert.deepEqual(calls[0].args, ['--version']);
    assert.equal(calls[0].options.timeout, 3_000);
    assert.match(logs[0], new RegExp(`Using installed ${family} browser`));
  }
});

test('tries later launchers after broken, timed-out, or unrecognizable version probes', async t => {
  const directory = makeTestDirectory(t);
  const chrome = makeExecutable(directory, 'google-chrome');
  const chromium = makeExecutable(directory, 'chromium');
  const calls = [];
  const result = await setup({
    ...isolatedSetupDependencies(directory, [chrome, chromium]),
    arch: 'arm64',
    readOsRelease: () => assert.fail('verified later candidate should skip distro checks'),
    spawn: (command, args, options) => {
      calls.push({ command, args, options });
      if (command === chrome) {
        const error = new Error('timed out');
        error.code = 'ETIMEDOUT';
        return { error, status: null, stdout: '', stderr: '' };
      }
      return { status: 0, stdout: '', stderr: 'Chromium 136.0.7103.92\n' };
    },
  });
  assert.equal(result, undefined);
  assert.deepEqual(calls.map(call => call.command), [chrome, chromium]);
  assert.ok(calls.every(call => call.options.timeout === 3_000));
});

test('stops instead of installing when recognized launchers are broken or unverifiable', async t => {
  const directory = makeTestDirectory(t);
  const candidates = [
    makeExecutable(directory, 'google-chrome'),
    makeExecutable(directory, 'chromium'),
  ];
  const calls = [];
  await assert.rejects(setup({
    ...isolatedSetupDependencies(directory, candidates),
    readOsRelease: () => assert.fail('broken launchers must stop before host validation'),
    spawn: (command, args, options) => {
      calls.push({ command, args, options });
      if (command === candidates[0]) return { status: 0, stdout: '', stderr: '' };
      return { status: 0, stdout: 'package version 1.2.3', stderr: '' };
    },
    fetchImpl: () => assert.fail('broken launchers must not trigger a download'),
  }), /none returned a verifiable browser version/);
  assert.deepEqual(calls.map(call => call.command), candidates);
});

test('recognizes known Flatpak browser metadata and refuses to replace it', async t => {
  const directory = makeTestDirectory(t);
  const flatpak = makeExecutable(directory, 'flatpak');
  const ids = ['com.google.Chrome', 'org.chromium.Chromium', 'com.microsoft.Edge', 'com.brave.Browser'];
  const calls = [];
  await assert.rejects(setup({
    ...isolatedSetupDependencies(directory, [flatpak]),
    readOsRelease: () => assert.fail('Flatpak detection should precede installation checks'),
    spawn: (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0, stdout: `${ids.join('\n')}\n`, stderr: '' };
    },
    fetchImpl: () => assert.fail('Flatpak detection must not download Chrome'),
  }), /Found Flatpak browser app\(s\): .*com\.brave\.Browser/);
  assert.deepEqual(calls[0].args, ['list', '--app', '--columns=application']);
  assert.equal(calls[0].options.timeout, 3_000);
});

test('stops with an actionable message if Flatpak browser metadata cannot be verified', async t => {
  const directory = makeTestDirectory(t);
  const flatpak = makeExecutable(directory, 'flatpak');
  await assert.rejects(setup({
    ...isolatedSetupDependencies(directory, [flatpak]),
    readOsRelease: () => assert.fail('uncertain Flatpak state should stop before install validation'),
    spawn: () => ({ status: 1, stdout: '', stderr: 'listing failed' }),
  }), /cannot verify whether a supported Flatpak browser is installed/);
});

test('installs the official Chrome deb on Mint only when no browser is present, then cleans up', async t => {
  const directory = makeTestDirectory(t);
  const calls = [];
  let downloadUrl;
  await setup({
    ...isolatedSetupDependencies(directory),
    readOsRelease: () => 'NAME="Linux Mint"\nID=linuxmint\nID_LIKE="ubuntu debian"\n',
    getuid: () => 0,
    spawn: (command, args, options) => {
      calls.push({ command, args, options });
      if (command === 'google-chrome-stable') {
        return { status: 0, stdout: 'Google Chrome 136.0.7103.92\n', stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    },
    fetchImpl: async (url, options) => {
      downloadUrl = url;
      assert.ok(options.signal instanceof AbortSignal);
      return new Response('test package contents');
    },
    tmpdir: directory,
    log: () => {},
  });

  assert.equal(downloadUrl, 'https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb');
  assert.deepEqual(calls.map(call => [call.command, ...call.args.slice(0, 1)]), [
    ['apt-get', '--version'],
    ['apt-get', 'update'],
    ['apt-get', 'install'],
    ['google-chrome-stable', '--version'],
  ]);
  const installArgs = calls.find(call => call.command === 'apt-get' && call.args[0] === 'install').args;
  assert.equal(installArgs[1], '-y');
  assert.match(installArgs[2], /google-chrome-stable_current_amd64\.deb$/);
  assert.deepEqual(fs.readdirSync(directory), []);
});

test('cleans the temporary download directory when installation fallback fails', async t => {
  const directory = makeTestDirectory(t);
  await assert.rejects(setup({
    ...isolatedSetupDependencies(directory),
    readOsRelease: () => 'ID=ubuntu\n',
    getuid: () => 0,
    spawn: (command, args) => {
      if (command === 'apt-get' && args[0] === 'install') return { status: 1, stdout: '', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    },
    fetchImpl: async () => new Response('test package contents'),
    tmpdir: directory,
    log: () => {},
  }), /apt-get failed: exit 1/);
  assert.deepEqual(fs.readdirSync(directory), []);
});

test('unsupported installation hosts fail before apt, sudo, or network access', async t => {
  const cases = [
    ['ID=fedora\n', 'x64', /Debian-family/],
    ['ID=ubuntu\n', 'arm64', /amd64/],
  ];
  for (const [osRelease, arch, expected] of cases) {
    const directory = makeTestDirectory(t);
    const calls = [];
    await assert.rejects(setup({
      ...isolatedSetupDependencies(directory),
      arch,
      getuid: () => 1000,
      readOsRelease: () => osRelease,
      spawn: (...args) => {
        calls.push(args);
        return { status: 0, stdout: '', stderr: '' };
      },
      fetchImpl: () => assert.fail('unsupported install host must not access the network'),
    }), expected);
    assert.deepEqual(calls, []);
  }
});
