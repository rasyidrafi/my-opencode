import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const binary = process.env.CHEZMOI_TEST_BINARY || 'chezmoi';
const available = spawnSync(binary, ['--version']).status === 0;
const template = fs.readFileSync(new URL('../dot_config/mise/config.toml.tmpl', import.meta.url), 'utf8');
function render(platform, extraEnv = {}) {
  const env = { ...process.env, TERMUX_VERSION: '', PREFIX: '', ...extraEnv };
  const result = spawnSync(binary, ['execute-template', '--source', new URL('..', import.meta.url).pathname, '--override-data', JSON.stringify({ chezmoi: { os: platform, arch: 'arm64' } })], { env, input: template, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
function tools(config) {
  return config.split('[tools]\n')[1].split('[tasks.')[0].split('\n')
    .filter(line => line.trim() && !line.startsWith('#'));
}
for (const [platform, env] of [['android', {}], ['linux', { TERMUX_VERSION: '0.118.3' }], ['linux', { PREFIX: '/data/data/com.termux/files/usr' }]]) {
  test(`Android defaults via ${platform} ${JSON.stringify(env)}`, { skip: !available }, () => {
    const config = render(platform, env);
    assert.equal(tools(config).length, 5);
    assert.ok(config.includes('"http:codex" = '));
    assert.deepEqual(tools(config).slice(0, 2), ['"npm:@bitwarden/cli" = "2026.10.1"', '"chezmoi" = "2.74.0"']);
    assert.match(tools(config)[2], /^"http:gh" = /);
    assert.ok(config.includes('gh_2.103.3_aarch64.deb'));
    assert.ok(config.includes('checksum = "sha256:b94190b38c5c6aa4174d0ed252e9096b2b2f243c16491413b83cf3f769c71842"'));
    assert.ok(!config.includes('github:cli/cli'));
    assert.ok(config.includes('npm.shell_out = true'));
    assert.ok(config.includes('"http:node" = '));
    assert.ok(config.includes('# "vfox:gcloud" = '));
    assert.ok(config.includes('{{ env.USERPROFILE }}'));
    assert.ok(config.includes('{{ env.HOME }}'));
  });
}
test('Linux adds T3 CLI to the shared desktop tool defaults', { skip: !available }, () => {
  const linux = render('linux');
  const windows = tools(render('windows'));
  assert.deepEqual(tools(linux).filter(line => !line.startsWith('\"npm:t3\"')), windows);
  assert.ok(tools(linux).includes('\"npm:t3\" = \"0.1.7\"'));
  assert.ok(!windows.some(line => line.startsWith('\"npm:t3\"')));
  assert.ok(!tools(render('android')).some(line => line.startsWith('\"npm:t3\"')));
  assert.ok(tools(linux).includes('"npm:@bitwarden/cli" = "2026.10.1"'));
  assert.ok(tools(linux).includes('"node" = "26.13.0"'));
  assert.equal(tools(linux).length, 21);
  assert.ok(!linux.includes('npm.shell_out'));
});

const catalog = JSON.parse(fs.readFileSync(new URL('../.chezmoidata/mise.json', import.meta.url))).mise;
for (const platform of ['linux', 'windows', 'android']) {
  test(platform + ' exposes exactly its supported tasks', { skip: !available }, () => {
    const config = render(platform);
    const names = [...config.matchAll(/\[tasks\."([^"]+)"\]/g)].map(match => match[1]);
    assert.deepEqual(names, catalog.tasks.filter(task => task.platforms.includes(platform)).map(task => task.name));
    assert.equal(names.length, { linux: 24, windows: 14, android: 11 }[platform]);
    assert.equal(names.includes('mpv:setup'), platform === 'linux');
    assert.equal(names.includes('cua:startup'), platform === 'linux');
    assert.equal(names.includes('crd:setup'), platform === 'linux');
    assert.equal(names.includes('t3code:setup'), platform !== 'windows');
    if (platform === 'linux') assert.ok(config.includes('/.config/t3code/setup-linux.sh'));
    if (platform === 'android') assert.ok(config.includes('/.config/t3code/setup.sh'));
    assert.equal(names.includes('codex:setup'), platform !== 'android');
    assert.equal(names.includes('openchamber:setup'), platform !== 'android');
  });
}

for (const [arch, termuxArch] of Object.entries({ arm64: 'aarch64', arm: 'arm', amd64: 'x86_64', '386': 'i686' })) {
  test('Termux GitHub CLI retains verified metadata for ' + arch, { skip: !available }, () => {
    const result = spawnSync(binary, ['execute-template', '--source', new URL('..', import.meta.url).pathname, '--override-data', JSON.stringify({ chezmoi: { os: 'android', arch } })], {
      input: template, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const gh = catalog.tools.find(tool => tool.package === 'gh');
    assert.ok(result.stdout.includes(`gh_${gh.version}_${termuxArch}.deb`));
    assert.ok(result.stdout.includes(`sha256:${gh.android.checksums[arch]}`));
  });
}

for (const [arch, termuxArch] of Object.entries({ arm64: 'aarch64', arm: 'arm', amd64: 'x86_64', '386': 'i686' })) {
  test('Termux Node and bundled npm retain verified metadata for ' + arch, { skip: !available }, () => {
    const result = spawnSync(binary, ['execute-template', '--source', new URL('..', import.meta.url).pathname, '--override-data', JSON.stringify({ chezmoi: { os: 'android', arch } })], { input: template, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const node = catalog.tools.find(tool => tool.package === 'node');
    assert.ok(result.stdout.includes(`nodejs_${node.version}_${termuxArch}.deb`));
    assert.ok(result.stdout.includes(`sha256:${node.android.checksums[arch]}`));
    assert.ok(result.stdout.includes(node.android.npm.checksum));
    assert.ok(result.stdout.includes(`"${node.android.npm.version}"`));
  });
}

for (const arch of ['arm64', 'amd64', 'arm', '386']) {
  test('Termux Codex architecture availability: ' + arch, { skip: !available }, () => {
    const result = spawnSync(binary, ['execute-template', '--source', new URL('..', import.meta.url).pathname, '--override-data', JSON.stringify({ chezmoi: { os: 'android', arch } })], { input: template, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const codex = catalog.tools.find(tool => tool.package === 'npm:@openai/codex');
    const checksum = codex.android.checksums[arch];
    assert.equal(result.stdout.includes('"http:codex" = '), Boolean(checksum));
    if (checksum) assert.ok(result.stdout.includes('sha256:' + checksum));
  });
}
