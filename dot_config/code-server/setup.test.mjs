import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeConfig, renderUnit } from './setup.mjs';

test('removes old authentication secrets and pins unauthenticated localhost settings', () => {
  assert.equal(normalizeConfig('cert: false\nauth: password\npassword: old-secret\nhashed-password: old-hash\nbind-addr: 0.0.0.0:8080\n'),
    'cert: false\nauth: none\nbind-addr: 127.0.0.1:8080\n');
});

test('removes quoted credential keys and multiline credential values', () => {
  assert.equal(normalizeConfig('"password": |\n  old-secret\n\'hashed-password\': >-\n  old-hash\n\'auth\': password\ncert: false\n'),
    'cert: false\nauth: none\nbind-addr: 127.0.0.1:8080\n');
});

test('removes credentials from an indented root YAML mapping', () => {
  assert.equal(normalizeConfig('  auth: password\n  password: secret\n  cert: false\n'),
    '  cert: false\n  auth: none\n  bind-addr: 127.0.0.1:8080\n');
});

test('renders a user service bound to localhost on port 8080', () => {
  const unit = renderUnit('/home/test/.local/bin/code-server', '/home/test');
  assert.match(unit, /^ExecStart="\/home\/test\/\.local\/bin\/code-server" --bind-addr 127\.0\.0\.1:8080 --auth none$/m);
  assert.match(unit, /^WorkingDirectory=\/home\/test$/m);
  assert.match(unit, /Restart=on-failure/);
  assert.match(unit, /WantedBy=default.target/);
});

test('escapes systemd specifiers and quotes in service paths', () => {
  const unit = renderUnit('/home/a%"b/code-server', '/home/a%"b');
  assert.match(unit, /ExecStart="\/home\/a%%\\"b\/code-server"/);
  assert.match(unit, /WorkingDirectory=\/home\/a%%\\x22b/);
});
