import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repository = fileURLToPath(new URL('../', import.meta.url));
const chezmoi = process.env.CHEZMOI_TEST_BINARY || 'chezmoi';

function fixture(t, content) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ssh-config-test-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const target = path.join(home, '.ssh/config');
  fs.mkdirSync(path.dirname(target));
  if (content !== undefined) fs.writeFileSync(target, content);
  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), XDG_DATA_HOME: path.join(home, '.local/share'), XDG_CACHE_HOME: path.join(home, '.cache') };
  const apply = () => {
    const result = spawnSync(chezmoi, ['--source', repository, '--destination', home,
      '--config', path.join(home, 'chezmoi.toml'), '--persistent-state', path.join(home, 'state.boltdb'),
      '--no-tty', 'apply', '--force', target], { env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return fs.readFileSync(target, 'utf8');
  };
  const effective = host => {
    const result = spawnSync('ssh', ['-G', '-F', target, host], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return Object.fromEntries(result.stdout.trim().split('\n').map(line => {
      const space = line.indexOf(' ');
      return [line.slice(0, space), line.slice(space + 1)];
    }));
  };
  return { apply, effective, target };
}

test('creates endpoints on a fresh home and is stable on reapply', t => {
  const { apply, effective } = fixture(t);
  const first = apply();
  assert.equal(apply(), first);
  for (const alias of ['soy', 'soy-wb', 'bull', 'bull-wb']) {
    const config = effective(alias);
    assert.equal(config.hostname, `${alias.split('-')[0]}.qilin-elver.ts.net`);
    assert.equal(config.user, alias);
    assert.equal(config.port, alias.endsWith('-wb') ? '2222' : '22');
  }
});

test('preserves shared Bitwarden socket, per-host options, Match and unrelated aliases', t => {
  const shared = '# Local Bitwarden agent\nHost soy soy-wb bull bull-wb\n    IdentityAgent /tmp/bitwarden.sock\n';
  const { apply, effective } = fixture(t, `ServerAliveInterval 19
Include config.d/docker-*.conf
Host *
    Port 9999
Host soy
    HostName old.example
    User old-user
    Port 2220
    IdentityFile /tmp/soy-key
${shared}
Host personal
    HostName personal.example
    User personal-user
Match originalhost personal
    Compression yes
`);
  const first = apply();
  assert.ok(first.includes(shared));
  assert.ok(!first.includes('old.example'));
  assert.equal(apply(), first);
  for (const alias of ['soy', 'soy-wb', 'bull', 'bull-wb']) {
    assert.equal(effective(alias).identityagent, '/tmp/bitwarden.sock');
    assert.equal(effective(alias).serveraliveinterval, '19');
  }
  assert.equal(effective('soy').identityfile, '/tmp/soy-key');
  assert.equal(effective('soy').port, '22');
  assert.equal(effective('soy-wb').port, '2222');
  assert.equal(effective('personal').hostname, 'personal.example');
  assert.equal(effective('personal').user, 'personal-user');
  assert.equal(effective('personal').port, '9999');
  assert.equal(effective('personal').compression, 'yes');
});

test('preserves a socket inside a single alias with case-insensitive equals syntax', t => {
  const { apply, effective } = fixture(t, 'hOsT="soy"\n HOSTNAME=old.example\n USER=old\n PORT=99\n IdentityAgent /tmp/local.sock\n');
  const first = apply();
  assert.equal(apply(), first);
  assert.equal(effective('soy').hostname, 'soy.qilin-elver.ts.net');
  assert.equal(effective('soy').identityagent, '/tmp/local.sock');
});

test('retains local options added inside a previously generated block', t => {
  const { apply, effective, target } = fixture(t);
  fs.writeFileSync(target, apply().replace('Host soy\n', 'Host soy\n    IdentityAgent /tmp/added-later.sock\n'));
  const updated = apply();
  assert.equal(effective('soy').identityagent, '/tmp/added-later.sock');
  assert.equal(apply(), updated);
});
