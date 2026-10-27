import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repository = fileURLToPath(new URL('../', import.meta.url));
const located = spawnSync('mise', ['which', 'chezmoi'], { encoding: 'utf8' });
const chezmoi = process.env.CHEZMOI_TEST_BINARY || (located.status === 0 ? located.stdout.trim() : 'chezmoi');
const managed = name => JSON.parse(fs.readFileSync(path.join(repository, '.chezmoitemplates/openchamber', name), 'utf8'));
const preferences = managed('preferences.json');
const settings = managed('settings.json');

test('OpenChamber no longer manages a redundant model denylist', () => {
  assert.ok(!Object.hasOwn(preferences, 'hiddenModels'));
  assert.ok(!Object.hasOwn(settings, 'hiddenModels'));
});

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-config-test-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const directory = path.join(home, '.config/openchamber');
  fs.mkdirSync(directory, { recursive: true });
  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), XDG_DATA_HOME: path.join(home, '.local/share'), XDG_CACHE_HOME: path.join(home, '.cache') };
  const run = names => spawnSync(chezmoi, ['--source', repository, '--destination', home,
    '--config', path.join(home, 'chezmoi.toml'), '--persistent-state', path.join(home, 'state.boltdb'),
    '--no-tty', 'apply', '--force', ...names.map(name => path.join(directory, name))], { env, encoding: 'utf8' });
  const read = name => fs.readFileSync(path.join(directory, name), 'utf8');
  const put = (name, value) => fs.writeFileSync(path.join(directory, name), JSON.stringify(value));
  const apply = () => {
    const result = run(['settings.json', 'preferences.json']);
    assert.equal(result.status, 0, result.stderr);
    return [read('settings.json'), read('preferences.json')];
  };
  return { directory, put, read, run, apply };
}

test('fresh installs seed only approved values and private files without theme overrides; reapply is stable', t => {
  const { directory, read, apply } = fixture(t);
  const before = Date.now();
  const first = apply();
  assert.deepEqual(JSON.parse(read('settings.json')), settings);
  assert.ok(!Object.hasOwn(settings, 'pwaAppName'));
  const config = JSON.parse(read('preferences.json'));
  assert.equal(config.version, 1);
  assert.deepEqual(Object.keys(config.fields).sort(), Object.keys(preferences).sort());
  for (const [key, value] of Object.entries(preferences)) {
    assert.deepEqual(config.fields[key].value, value);
    assert.ok(config.fields[key].updatedAt >= before);
    assert.ok(config.fields[key].updatedAt <= Date.now());
  }
  assert.equal(config.fields.showReasoningTraces.value, true);
  assert.ok(!Object.hasOwn(config.fields, 'lightThemeId'));
  assert.ok(!Object.hasOwn(config.fields, 'darkThemeId'));
  assert.ok(!Object.hasOwn(config.fields, 'sidebarProjectSortOrder'));
  for (const key of ['smallModelUseDefault', 'smallModelOverride', 'smallModelVariant']) {
    assert.ok(!Object.hasOwn(config.fields, key));
  }
  if (process.platform !== 'win32') {
    for (const name of ['settings.json', 'preferences.json']) assert.equal(fs.statSync(path.join(directory, name)).mode & 0o777, 0o600);
  }
  assert.deepEqual(apply(), first);
});

test('managed preferences replace only their values, retain unchanged timestamps and preserve local state', t => {
  const { put, read, apply } = fixture(t);
  const untouched = { value: { completion: { title: '', message: '' } }, updatedAt: 12 };
  put('preferences.json', {
    version: 1,
    extraMetadata: 'keep',
    fields: {
      reportUsage: { value: true, updatedAt: 1 },
      showReasoningTraces: { value: false, updatedAt: 1 },
      defaultModel: { value: preferences.defaultModel, updatedAt: 2, extra: 'keep' },
      hiddenModels: { value: [{ providerID: 'custom', modelID: 'old' }], updatedAt: 3 },
      recentModels: { value: [{ providerID: 'custom', modelID: 'recent' }], updatedAt: 4 },
      notificationTemplates: untouched,
      responseStyleCustomInstructions: { value: '', updatedAt: 5 },
      sidebarProjectSortOrder: { value: 'manual', updatedAt: 6 },
    },
  });
  const local = {
    projects: [{ id: 'local', path: '/local/project' }],
    permissionAutoAccept: { sessions: { local: 'ask' }, revision: 1 },
    desktopUiPassword: 'synthetic-local-secret',
    defaultModel: 'legacy/profile-copy',
    unknownFutureSetting: { keep: true },
    permissionDefaultMode: 'ask',
  };
  put('settings.json', local);
  const first = apply();
  const config = JSON.parse(read('preferences.json'));
  assert.equal(config.extraMetadata, 'keep');
  assert.equal(config.fields.reportUsage.value, false);
  assert.ok(config.fields.reportUsage.updatedAt > 1);
  assert.equal(config.fields.showReasoningTraces.value, true);
  assert.ok(config.fields.showReasoningTraces.updatedAt > 1);
  assert.deepEqual(config.fields.defaultModel, { value: preferences.defaultModel, updatedAt: 2, extra: 'keep' });
  assert.ok(!Object.hasOwn(config.fields, 'hiddenModels'));
  assert.deepEqual(config.fields.recentModels, { value: [{ providerID: 'custom', modelID: 'recent' }], updatedAt: 4 });
  assert.deepEqual(config.fields.notificationTemplates, untouched);
  assert.deepEqual(config.fields.responseStyleCustomInstructions, { value: '', updatedAt: 5 });
  assert.deepEqual(config.fields.sidebarProjectSortOrder, { value: 'manual', updatedAt: 6 });
  assert.deepEqual(JSON.parse(read('settings.json')), { ...local, ...settings });
  assert.deepEqual(apply(), first);
});

test('applying removes hiddenModels from both documents and preserves unrelated values', t => {
  const { put, read, apply } = fixture(t);
  const hiddenModels = [{ providerID: 'openai', modelID: 'legacy' }];
  const untouched = { value: 'keep', updatedAt: 123 };
  put('preferences.json', { version: 1, fields: { hiddenModels: { value: hiddenModels, updatedAt: 1 }, custom: untouched } });
  put('settings.json', { hiddenModels, custom: 'keep' });
  const first = apply();
  const profile = JSON.parse(read('preferences.json'));
  const instance = JSON.parse(read('settings.json'));
  assert.ok(!Object.hasOwn(profile.fields, 'hiddenModels'));
  assert.ok(!Object.hasOwn(instance, 'hiddenModels'));
  assert.deepEqual(profile.fields.custom, untouched);
  assert.equal(instance.custom, 'keep');
  assert.deepEqual(apply(), first);
});

test('every managed value overrides conflicting local edits regardless of timestamps on every apply', t => {
  const { put, read, apply } = fixture(t);
  const conflicting = value => {
    if (typeof value === 'boolean') return !value;
    if (Array.isArray(value)) return [{ providerID: 'custom', modelID: 'local-only' }];
    return 'local-override';
  };
  const futureStamp = Date.now() + 86_400_000;
  const localProfile = Object.fromEntries(Object.entries(preferences).map(([key, value]) => [key, {
    value: conflicting(value), updatedAt: futureStamp,
  }]));
  const legacyCopies = Object.fromEntries(Object.entries(preferences).map(([key, value]) => [key, conflicting(value)]));
  const localInstance = Object.fromEntries(Object.entries(settings).map(([key, value]) => [key, conflicting(value)]));

  // Simulate conflicting settings on an existing install, then fresh UI edits
  // after an apply. Neither local values nor newer timestamps take priority.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    put('preferences.json', { version: 1, fields: {
      ...localProfile,
      sidebarProjectSortOrder: { value: 'manual', updatedAt: futureStamp },
    } });
    put('settings.json', { ...legacyCopies, ...localInstance, keepLocal: 'untouched' });
    const first = apply();
    const fields = JSON.parse(read('preferences.json')).fields;
    const instance = JSON.parse(read('settings.json'));
    for (const [key, value] of Object.entries(preferences)) {
      assert.deepEqual(fields[key].value, value, `repo must override profile key ${key}`);
      assert.notEqual(fields[key].updatedAt, futureStamp, `newer local timestamp must not win for ${key}`);
    }
    for (const [key, value] of Object.entries(settings)) {
      assert.deepEqual(instance[key], value, `repo must override instance key ${key}`);
    }
    // OpenChamber's effective read overlays preferences on legacy settings.
    const effective = { ...instance, ...Object.fromEntries(Object.entries(fields).map(([key, entry]) => [key, entry.value])) };
    for (const [key, value] of Object.entries({ ...preferences, ...settings })) assert.deepEqual(effective[key], value);
    assert.equal(instance.keepLocal, 'untouched');
    assert.deepEqual(fields.sidebarProjectSortOrder, { value: 'manual', updatedAt: futureStamp });
    assert.deepEqual(apply(), first);
  }
});

test('retired small-model overrides and legacy copies are removed so the default takes effect', t => {
  const { put, read, apply } = fixture(t);
  const legacy = { smallModelUseDefault: false, smallModelOverride: 'custom/model', smallModelVariant: 'high' };
  put('preferences.json', { version: 1, fields: Object.fromEntries(
    Object.entries(legacy).map(([key, value]) => [key, { value, updatedAt: 1 }]),
  ) });
  put('settings.json', { ...legacy, keepLocal: true });
  const first = apply();
  const fields = JSON.parse(read('preferences.json')).fields;
  const config = JSON.parse(read('settings.json'));
  for (const key of Object.keys(legacy)) {
    assert.ok(!Object.hasOwn(fields, key));
    assert.ok(!Object.hasOwn(config, key));
  }
  assert.equal(config.keepLocal, true);
  assert.deepEqual(apply(), first);
});

test('PWA app names remain machine-local across applies and local edits', t => {
  const { put, read, apply } = fixture(t);
  for (const pwaAppName of ['Chamber: This Machine', 'My Local Chamber']) {
    put('settings.json', { pwaAppName });
    const first = apply();
    assert.equal(JSON.parse(read('settings.json')).pwaAppName, pwaAppName);
    assert.deepEqual(apply(), first);
  }
});

test('existing theme choices and timestamps are left entirely unmanaged', t => {
  const { put, read, apply } = fixture(t);
  put('preferences.json', { version: 1, fields: {
    lightThemeId: { value: 'local-base', updatedAt: 11, surfaces: {
      web: { value: 'old-web', updatedAt: 12 },
      desktop: { value: 'desktop-theme', updatedAt: 13 },
      mobile: { value: 'mobile-theme', updatedAt: 14 },
    } },
  } });
  const first = apply();
  const theme = JSON.parse(read('preferences.json')).fields.lightThemeId;
  assert.equal(theme.value, 'local-base');
  assert.equal(theme.updatedAt, 11);
  assert.deepEqual(theme.surfaces.web, { value: 'old-web', updatedAt: 12 });
  assert.deepEqual(theme.surfaces.desktop, { value: 'desktop-theme', updatedAt: 13 });
  assert.deepEqual(theme.surfaces.mobile, { value: 'mobile-theme', updatedAt: 14 });
  assert.deepEqual(apply(), first);
});

test('malformed or future preferences are refused without overwriting them', t => {
  const { directory, put, read, run } = fixture(t);
  for (const value of [{ version: 2, fields: {} }, { version: 1, fields: [] }, null, [], { version: 1, fields: { defaultModel: 'invalid' } }]) {
    put('preferences.json', value);
    const before = read('preferences.json');
    assert.notEqual(run(['preferences.json']).status, 0);
    assert.equal(read('preferences.json'), before);
  }
  fs.writeFileSync(path.join(directory, 'preferences.json'), '{broken');
  assert.notEqual(run(['preferences.json']).status, 0);
  assert.equal(read('preferences.json'), '{broken');
});

test('malformed settings are refused without overwriting them', t => {
  const { directory, put, read, run } = fixture(t);
  for (const value of [null, [], 'invalid']) {
    put('settings.json', value);
    const before = read('settings.json');
    assert.notEqual(run(['settings.json']).status, 0);
    assert.equal(read('settings.json'), before);
  }
  fs.writeFileSync(path.join(directory, 'settings.json'), '{broken');
  assert.notEqual(run(['settings.json']).status, 0);
  assert.equal(read('settings.json'), '{broken');
});
