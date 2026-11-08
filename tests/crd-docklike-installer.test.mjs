import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { test } from 'node:test';

const installerPath = new URL('../dot_config/chrome-remote-desktop/install-docklike-fork.sh', import.meta.url);
const sourceText = fs.readFileSync(installerPath, 'utf8');
const commit = '0123456789abcdef0123456789abcdef01234567';

function executable(file, contents) {
  fs.writeFileSync(file, contents);
  fs.chmodSync(file, 0o755);
}

function fixture(t, { foreignDiversion = false, unownedTarget = false, managedInstall = false, unsafeLock = '' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crd-docklike-installer-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const target = path.join(root, 'usr/lib/x86_64-linux-gnu/xfce4/panel/plugins/libdocklike.so');
  const diverted = `${target}.crd-docklike-fork.distrib`;
  const stateDir = path.join(root, 'var/lib/crd-docklike-fork');
  const lockDir = path.join(root, 'lock-dir');
  const lockFile = path.join(lockDir, 'crd-docklike-fork.lock');
  const diversionState = path.join(root, 'diversion-state');
  const log = path.join(root, 'commands.log');
  fs.writeFileSync(log, '');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, 'distro-plugin');
  if (foreignDiversion) fs.writeFileSync(diversionState, `OTHER ${path.join(root, 'foreign.so')}\n`);
  if (managedInstall) {
    const previousPlugin = 'previous fork plugin';
    fs.writeFileSync(diverted, 'distro-plugin');
    fs.writeFileSync(target, previousPlugin);
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, 'manifest'), `commit=abcdef0123456789abcdef0123456789abcdef01\nsha256=${crypto.createHash('sha256').update(previousPlugin).digest('hex')}\n`);
    fs.writeFileSync(diversionState, `LOCAL ${diverted}\n`);
  }
  fs.mkdirSync(lockDir, { mode: unsafeLock === 'dir-writable' ? 0o777 : 0o755 });
  if (unsafeLock === 'symlink') fs.symlinkSync(path.join(root, 'elsewhere'), lockFile);
  if (unsafeLock === 'user-owned') fs.writeFileSync(lockFile, '');
  if (unsafeLock === 'wrong-mode') fs.writeFileSync(lockFile, '');
  if (unsafeLock === 'wrong-mode') fs.chmodSync(lockFile, 0o600);

  executable(path.join(bin, 'id'), '#!/bin/sh\necho 1000\n');
  executable(path.join(bin, 'sudo'), `#!/bin/sh
printf 'sudo %s\\n' "$*" >> '${log}'
[ "${'${SUDO_FAIL:-}'}" != 1 ] || exit 42
exec "$@"
`);
  executable(path.join(bin, 'dpkg'), '#!/bin/sh\n[ "$1" = --print-architecture ] && { echo amd64; exit 0; }\nexit 1\n');
executable(path.join(bin, 'stat'), `#!/bin/sh
if [ "$1" = -c ] && [ "$2" = %u ]; then
  case "$3" in '${lockFile}') [ -e "$3" ] && echo "${unsafeLock === 'user-owned' ? 1000 : 0}" ;; *) echo 0 ;; esac
elif [ "$1" = -c ] && [ "$2" = %a ]; then
  case "$3" in '${lockDir}') echo "${unsafeLock === 'dir-writable' ? 777 : 755}" ;; '${lockFile}') echo "${unsafeLock === 'wrong-mode' ? 600 : 644}" ;; *) echo 644 ;; esac
else exec /usr/bin/stat "$@"; fi
`);
  executable(path.join(bin, 'flock'), `#!/bin/sh
printf 'flock\\n' >> '${log}'
exec /usr/bin/flock "$@"
`);
  executable(path.join(bin, 'dpkg-query'), `#!/bin/sh
if [ "$1" = -W ]; then echo installed; exit 0; fi
if [ "$1" = -S ]; then echo "${unownedTarget ? 'other-package' : 'xfce4-docklike-plugin'}: ${target}"; exit 0; fi
exit 1
`);
  executable(path.join(bin, 'dpkg-divert'), `#!/bin/sh
state='${diversionState}'
target='${target}'
diverted='${diverted}'
case "$1" in
  --listpackage)
    if [ -f "$state" ]; then awk '{print $1}' "$state"; fi
    ;;
  --truename)
    if [ -f "$state" ]; then awk '{print $2}' "$state"; else echo "$target"; fi
    ;;
  --add)
    /bin/mv "$target" "$diverted"
    printf 'LOCAL %s\\n' "$diverted" > "$state"
    ;;
  --remove)
    /bin/mv "$diverted" "$target"
    rm -f "$state"
    ;;
  *) exit 2 ;;
esac
`);
  executable(path.join(bin, 'apt-get'), `#!/bin/sh\nprintf 'apt-get %s\\n' "$*" >> '${log}'\n`);
  executable(path.join(bin, 'install'), `#!/bin/sh
directory=false
[ "$1" = -d ] && { directory=true; shift; }
while [ "$1" = -o ] || [ "$1" = -g ] || [ "$1" = -m ]; do shift 2; done
if [ "$directory" = true ]; then mkdir -p "$@"; else cp "$@"; fi
`);
  executable(path.join(bin, 'git'), `#!/bin/sh
printf 'git %s\\n' "$*" >> '${log}'
if [ "$1" = -C ]; then cd "$2"; shift 2; fi
case "$1" in
  checkout)
    cat > autogen.sh <<'AUTOGEN'
#!/bin/sh
printf 'autogen %s\\n' "$*" >> "$DOCKLIKE_LOG"
cat > configure <<'CONFIGURE'
#!/bin/sh
printf 'configure %s\\n' "$*" >> "$DOCKLIKE_LOG"
case " $* " in *--enable-x11*--disable-wayland*) ;; *) exit 18 ;; esac
CONFIGURE
chmod +x configure
./configure "$@"
AUTOGEN
    chmod +x autogen.sh
    ;;
  rev-parse) echo '${commit}' ;;
esac
`);
executable(path.join(bin, 'make'), `#!/bin/sh
printf 'make %s\\n' "$*" >> '${log}'
case " $* " in *' install '*) ;; *)
  if [ "${'${BLOCK_BUILD:-}'}" = 1 ]; then
    : > "$BUILD_MARKER"
    while [ ! -e "$BUILD_RELEASE" ]; do sleep 0.01; done
  fi
  ;;
esac
[ "${'${MAKE_FAIL:-}'}" != 1 ] || exit 19
for arg do case "$arg" in DESTDIR=*) stage=\${arg#DESTDIR=};; esac; done
case " $* " in *' install '*) mkdir -p "$stage${path.dirname(target)}"; printf 'staged fork plugin\\n' > "$stage${target}";; esac
`);
  executable(path.join(bin, 'readelf'), '#!/bin/sh\necho "  Type: DYN (Shared object file)"\n');
  executable(path.join(bin, 'ldd'), `#!/bin/sh
if [ "${'${LDD_MISSING:-}'}" = 1 ]; then echo 'libmissing.so => not found'; else echo 'libfixture.so => /lib/libfixture.so'; fi
`);
executable(path.join(bin, 'mv'), `#!/bin/sh
if [ "${'${FAIL_INSTALL_MV:-}'}" = 1 ]; then
  case "$*" in *'${target}.crd-docklike-fork.'*) exit 20 ;; esac
fi
if [ "${'${FAIL_MANIFEST_MV:-}'}" = 1 ]; then
  case "$*" in *'${stateDir}/manifest.crd-docklike-fork.'*) exit 21 ;; esac
fi
if [ "${'${FAIL_RESTORE:-}'}" = 1 ]; then
  case "$*" in *'.crd-docklike-fork-restore.'*) exit 22 ;; esac
fi
exec /bin/mv "$@"
`);

  const script = sourceText
    .replace(/^DOCKLIKE_COMMIT=.*$/m, `DOCKLIKE_COMMIT=${commit}`)
    .replace('TARGET=/usr/lib/x86_64-linux-gnu/xfce4/panel/plugins/libdocklike.so', `TARGET=${target}`)
    .replace('STATE_DIR=/var/lib/crd-docklike-fork', `STATE_DIR=${stateDir}`)
    .replace('LOCK_DIR=/var/lib', `LOCK_DIR=${lockDir}`)
    .replace('LOCK_FILE="$LOCK_DIR/crd-docklike-fork.lock"', `LOCK_FILE=${lockFile}`);
  const runnable = path.join(root, 'installer.sh');
  fs.writeFileSync(runnable, script);
  const env = {
    ...process.env,
    PATH: `${bin}:/usr/bin:/bin`,
    DOCKLIKE_LOG: log,
    MAKE_FAIL: '',
  };
  const run = (extraEnv = {}) => spawnSync('/bin/sh', [runnable], { env: { ...env, ...extraEnv }, encoding: 'utf8' });
  const start = (extraEnv = {}) => spawn('/bin/sh', [runnable], { env: { ...env, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
  return { root, log, target, diverted, stateDir, diversionState, lockDir, lockFile, run, start };
}

function collect(child) {
  return new Promise(resolve => {
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', status => resolve({ status, stdout, stderr }));
  });
}

async function waitFor(check) {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('timed out waiting for installer fixture state');
}

test('installer pins the fork commit and passes shell syntax validation', () => {
  assert.match(sourceText, /^DOCKLIKE_COMMIT=(?:REPLACE_WITH_FORK_COMMIT|[0-9a-f]{40})$/m);
  assert.match(sourceText, /autoconf-archive/);
  assert.match(sourceText, /autopoint/);
  const result = spawnSync('/bin/sh', ['-n', installerPath.pathname], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('build completes in staging before the distro module is diverted and replaced, then verifies idempotently', t => {
  const f = fixture(t);
  const distro = fs.readFileSync(f.target);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(f.diverted, 'utf8'), distro.toString());
  const plugin = fs.readFileSync(f.target);
  assert.match(plugin.toString(), /staged fork plugin/);
  assert.equal(fs.readFileSync(path.join(f.stateDir, 'manifest'), 'utf8'), `commit=${commit}\nsha256=${crypto.createHash('sha256').update(plugin).digest('hex')}\n`);
  const buildLog = fs.readFileSync(f.log, 'utf8');
  assert.match(buildLog, /autogen .*--enable-x11 --disable-wayland/);
  assert.match(buildLog, /configure .*--enable-x11 --disable-wayland/);

  const logBeforeRepeat = buildLog;
  const repeat = f.run();
  assert.equal(repeat.status, 0, repeat.stderr);
  assert.match(repeat.stdout, /already installed and verified/);
  assert.equal((fs.readFileSync(f.log, 'utf8').match(/git /g) || []).length, (logBeforeRepeat.match(/git /g) || []).length);
  assert.equal((fs.readFileSync(f.log, 'utf8').match(/autogen /g) || []).length, 1);
});

test('verified installed rerun validates existing root lock without sudo', t => {
  const f = fixture(t);
  const install = f.run();
  assert.equal(install.status, 0, install.stderr);
  const sudoCount = (fs.readFileSync(f.log, 'utf8').match(/sudo /g) || []).length;
  const rerun = f.run({ SUDO_FAIL: '1' });
  assert.equal(rerun.status, 0, rerun.stderr);
  assert.match(rerun.stdout, /already installed and verified/);
  assert.equal((fs.readFileSync(f.log, 'utf8').match(/sudo /g) || []).length, sudoCount);
});

test('unsafe existing lock objects fail closed without sudo', t => {
  for (const unsafeLock of ['dir-writable', 'symlink', 'user-owned', 'wrong-mode']) {
    const f = fixture(t, { unsafeLock });
    const result = f.run({ SUDO_FAIL: '1' });
    assert.notEqual(result.status, 0, unsafeLock);
    assert.match(result.stderr, /unsafe lock directory|group\/world writable|lock file is|lock file must/);
    assert.equal((fs.readFileSync(f.log, 'utf8').match(/sudo /g) || []).length, 0, unsafeLock);
    assert.doesNotMatch(fs.readFileSync(f.log, 'utf8'), /git /);
  }
});

test('a build failure leaves the distro plugin and diversion table unchanged', t => {
  const f = fixture(t);
  const result = f.run({ MAKE_FAIL: '1' });
  assert.notEqual(result.status, 0);
  assert.equal(fs.readFileSync(f.target, 'utf8'), 'distro-plugin');
  assert.equal(fs.existsSync(f.diverted), false);
  assert.equal(fs.existsSync(f.diversionState), false);
  assert.equal(fs.existsSync(f.stateDir), false);
});

test('a replacement failure after diversion rolls back to the distro plugin', t => {
  const f = fixture(t);
  const result = f.run({ FAIL_INSTALL_MV: '1' });
  assert.notEqual(result.status, 0);
  assert.equal(fs.readFileSync(f.target, 'utf8'), 'distro-plugin');
  assert.equal(fs.existsSync(f.diverted), false);
  assert.equal(fs.existsSync(f.diversionState), false);
  assert.equal(fs.existsSync(f.stateDir), false);
});

test('an update atomically replaces the managed plugin and preserves the distro diversion', t => {
  const f = fixture(t, { managedInstall: true });
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(fs.readFileSync(f.target, 'utf8'), /staged fork plugin/);
  assert.equal(fs.readFileSync(f.diverted, 'utf8'), 'distro-plugin');
  assert.equal(fs.readFileSync(path.join(f.stateDir, 'manifest'), 'utf8').split('\n')[0], `commit=${commit}`);
  assert.equal(fs.readdirSync(path.dirname(f.target)).some(name => name.includes('docklike-fork-backup')), false);
  assert.equal(fs.readdirSync(f.stateDir).some(name => name.includes('docklike-fork-backup')), false);
});

test('an update retains and reports recovery backups when rollback replacement fails', t => {
  const f = fixture(t, { managedInstall: true });
  const result = f.run({ FAIL_MANIFEST_MV: '1', FAIL_RESTORE: '1' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /recovery backup retained at .*libdocklike\.so\.crd-docklike-fork-backup\./);
  assert.match(result.stderr, /recovery backup retained at .*manifest\.crd-docklike-fork-backup\./);
  const pluginBackup = fs.readdirSync(path.dirname(f.target)).find(name => name.includes('libdocklike.so.crd-docklike-fork-backup.'));
  const manifestBackup = fs.readdirSync(f.stateDir).find(name => name.includes('manifest.crd-docklike-fork-backup.'));
  assert.ok(pluginBackup);
  assert.ok(manifestBackup);
  assert.equal(fs.readFileSync(path.join(path.dirname(f.target), pluginBackup), 'utf8'), 'previous fork plugin');
  assert.equal(fs.readFileSync(path.join(f.stateDir, manifestBackup), 'utf8').split('\n')[0], 'commit=abcdef0123456789abcdef0123456789abcdef01');
  assert.match(fs.readFileSync(f.target, 'utf8'), /staged fork plugin/);
});

test('concurrent installer invocations serialize across install and state inspection', async t => {
  const f = fixture(t);
  const marker = path.join(f.root, 'build-started');
  const release = path.join(f.root, 'release-build');
  const first = f.start({ BLOCK_BUILD: '1', BUILD_MARKER: marker, BUILD_RELEASE: release });
  const firstDone = collect(first);
  await waitFor(() => fs.existsSync(marker));

  const second = f.start({ BLOCK_BUILD: '1', BUILD_MARKER: marker, BUILD_RELEASE: release });
  const secondDone = collect(second);
  await waitFor(() => (fs.readFileSync(f.log, 'utf8').match(/flock/g) || []).length === 2);
  assert.equal(fs.readFileSync(f.log, 'utf8').match(/git /g).length, 5);

  fs.writeFileSync(release, 'continue');
  const firstResult = await firstDone;
  const secondResult = await secondDone;
  assert.equal(firstResult.status, 0, firstResult.stderr);
  assert.equal(secondResult.status, 0, secondResult.stderr);
  assert.match(secondResult.stdout, /already installed and verified/);
  assert.equal(fs.readFileSync(f.log, 'utf8').match(/autogen /g).length, 1);
});

test('unresolved runtime dependencies fail before the distro plugin is diverted', t => {
  const f = fixture(t);
  const result = f.run({ LDD_MISSING: '1' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unresolved runtime library dependencies/);
  assert.equal(fs.readFileSync(f.target, 'utf8'), 'distro-plugin');
  assert.equal(fs.existsSync(f.diverted), false);
  assert.equal(fs.existsSync(f.diversionState), false);
});

test('installer refuses a non-package-owned plugin without fetching or changing it', t => {
  const f = fixture(t, { unownedTarget: true });
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not owned by xfce4-docklike-plugin/);
  assert.equal(fs.readFileSync(f.target, 'utf8'), 'distro-plugin');
  assert.doesNotMatch(fs.readFileSync(f.log, 'utf8'), /git /);
});

test('idempotency refuses an installed module whose recorded hash no longer matches', t => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  fs.writeFileSync(f.target, 'externally modified plugin');
  const repeat = f.run();
  assert.notEqual(repeat.status, 0);
  assert.match(repeat.stderr, /hash differs from its manifest/);
  assert.equal(fs.readFileSync(f.target, 'utf8'), 'externally modified plugin');
});

test('a foreign dpkg diversion is rejected before source fetch or file changes', t => {
  const f = fixture(t, { foreignDiversion: true });
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /conflicting dpkg diversion/);
  assert.equal(fs.readFileSync(f.target, 'utf8'), 'distro-plugin');
  assert.doesNotMatch(fs.readFileSync(f.log, 'utf8'), /git /);
});
