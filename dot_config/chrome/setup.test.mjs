import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateHost } from './setup.mjs';

test('rejects Windows and macOS explicitly', () => {
  for (const platform of ['win32', 'darwin']) {
    assert.throws(() => validateHost(platform, 'x64', ''), /Linux only/);
  }
});

test('rejects architectures without a Chrome Linux package', () => {
  assert.throws(() => validateHost('linux', 'arm64', 'ID=debian'), /amd64/);
});

test('supports Debian and Ubuntu, including quoted release IDs', () => {
  for (const release of ['ID=debian\n', 'ID="ubuntu"\n']) {
    assert.doesNotThrow(() => validateHost('linux', 'x64', release));
  }
});

test('rejects unsupported or missing distro IDs', () => {
  for (const release of ['ID=fedora', '', 'ID_LIKE=debian\nID=mint']) {
    assert.throws(() => validateHost('linux', 'x64', release), /Debian and Ubuntu only/);
  }
});
