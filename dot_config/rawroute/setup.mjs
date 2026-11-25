import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { assertSafe, privateWrite } from '../shell/integration.mjs';
import { restrictWindowsDirectory } from '../secrets/windows.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
export const modes = {
  local: { urlEnv: 'RAWROUTE_LOCAL_BASE_URL', envKey: 'RAWROUTE_LOCAL_API_KEY' },
  default: { urlEnv: 'RAWROUTE_BASE_URL', envKey: 'RAWROUTE_API_KEY' },
};
const targets = ['.codex/config.toml', '.config/opencode/opencode.json'];
const sources = ['dot_codex/modify_config.toml', 'dot_config/opencode/modify_opencode.json'];

export function options(argv) {
  const mode = argv[0];
  if (!Object.hasOwn(modes, mode)) throw new Error('Expected local or default mode.');
  const result = { mode };
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--dry-run') result.dryRun = true;
    else if (argv[i] === '--source' && argv[i + 1] && !argv[i + 1].startsWith('--')) result.source = argv[++i];
    else throw new Error(`Unknown or incomplete option: ${argv[i]}`);
  }
  return result;
}

function invoke(command, args, options) {
  return spawnSync(command, args, { encoding: 'utf8', timeout: 60_000, ...options });
}

export function configure({ mode, home = os.homedir(), env = process.env, source, dryRun = false, chezmoi = 'chezmoi', execute = invoke, platform = process.platform }) {
  if (!['linux', 'darwin', 'win32', 'android'].includes(platform)) throw new Error('Rawroute switching supports Linux, macOS, Windows and Android.');
  if (!Object.hasOwn(modes, mode)) throw new Error('Expected local or default mode.');
  const { urlEnv, envKey } = modes[mode];
  const baseURL = env[urlEnv]?.trim();
  for (const name of [urlEnv, envKey]) {
    if (!env[name]?.trim()) throw new Error(`${name} is missing. Run secrets:setup separately, then use a new initialized shell.`);
  }
  let endpoint;
  try { endpoint = new URL(baseURL); }
  catch { throw new Error(`${urlEnv} must be an absolute HTTP or HTTPS URL.`); }
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
    throw new Error(`${urlEnv} must be an absolute HTTP or HTTPS URL without embedded credentials.`);
  }
  home = path.resolve(home);
  if (!source) {
    const stamp = path.join(directory, 'source.json');
    if (!fs.existsSync(stamp)) throw new Error('Apply the task assets first, or pass --source /absolute/path/to/checkout.');
    source = JSON.parse(fs.readFileSync(stamp, 'utf8')).sourceDir;
  }
  if (typeof source !== 'string' || !path.isAbsolute(source)) throw new Error('The chezmoi source must be an absolute path.');
  source = path.resolve(source);
  const paths = targets.map(name => path.join(home, name));
  const marker = path.join(home, '.config/rawroute/local-enabled');
  const legacyMarker = path.join(home, '.config/rawroute/rawroute-local-enabled');
  const managedPaths = [...paths, marker, legacyMarker];
  for (const target of managedPaths) assertSafe(home, target);
  const flags = ['--source', source, '--destination', home, '--no-tty', '--no-pager'];
  const cm = (args, input) => {
    const r = execute(chezmoi, [...flags, ...args], { env: { ...env, HOME: home, ...(platform === 'win32' ? { USERPROFILE: home } : {}) }, cwd: home, input });
    // Chezmoi errors/diffs can contain existing credentials; never forward them.
    if (r.error || r.status !== 0) throw new Error('Chezmoi command failed; output withheld because configuration may contain credentials.');
    return (r.stdout || '').trim();
  };
  for (let i = 0; i < paths.length; i++) {
    const expected = path.join(source, sources[i]);
    if (!fs.existsSync(expected) || path.resolve(cm(['source-path', paths[i]])) !== expected) throw new Error('Source ownership does not match the expected Codex/OpenCode targets.');
  }
  if (dryRun) return { mode, baseURL, envKey, dryRun: true, backup: null };

  const lock = path.join(home, '.config/rawroute/.switch.lock');
  assertSafe(home, lock);
  fs.mkdirSync(path.dirname(lock), { recursive: true, mode: 0o700 });
  let fd;
  try { fd = fs.openSync(lock, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('Another Rawroute switch is active, or a stale .switch.lock needs review.');
    throw error;
  }
  try {
    const snapshots = managedPaths.map(target => ({ target, exists: fs.existsSync(target), content: fs.existsSync(target) ? fs.readFileSync(target) : null, mode: fs.existsSync(target) ? fs.statSync(target).mode & 0o777 : null }));
    const backup = path.join(home, '.local/state/rawroute-backups', `${new Date().toISOString().replaceAll(':', '-')}-${process.pid}`);
    if (platform === 'win32') {
      fs.mkdirSync(backup, { recursive: true });
      restrictWindowsDirectory(backup);
    }
    for (const snapshot of snapshots) {
      if (snapshot.exists) privateWrite(home, path.join(backup, path.relative(home, snapshot.target)), snapshot.content);
    }
    privateWrite(home, path.join(backup, 'manifest.json'), JSON.stringify(snapshots.map(({ target, exists, mode }) => ({ path: path.relative(home, target), exists, mode })), null, 2) + '\n');
    try {
      if (mode === 'local') privateWrite(home, marker, '1\n');
      else if (fs.existsSync(marker)) fs.unlinkSync(marker);
      if (fs.existsSync(legacyMarker)) fs.unlinkSync(legacyMarker);
      for (const target of paths) fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      cm(['apply', '--force', ...paths]);
      const [codexPath, openCodePath] = paths;
      const query = '{{ $p := index (fromToml .chezmoi.stdin) "model_providers" "rawroute" }}{{ dict "baseURL" $p.base_url "envKey" $p.env_key | toJson }}';
      const codex = JSON.parse(cm(['execute-template', '--with-stdin', query], fs.readFileSync(codexPath, 'utf8')));
      const provider = JSON.parse(fs.readFileSync(openCodePath, 'utf8')).providers.rawroute;
      if (codex.baseURL !== baseURL || codex.envKey !== envKey ||
          provider.settings.baseURL !== baseURL || provider.env.length !== 1 || provider.env[0] !== envKey) {
        throw new Error('Rendered provider settings do not match the requested mode.');
      }
    } catch {
      let rollbackFailed = false;
      for (const snapshot of snapshots) {
        try {
          assertSafe(home, snapshot.target);
          if (snapshot.exists) {
            privateWrite(home, snapshot.target, snapshot.content);
            if (platform !== 'win32') fs.chmodSync(snapshot.target, snapshot.mode);
          } else if (fs.existsSync(snapshot.target)) fs.unlinkSync(snapshot.target);
        } catch { rollbackFailed = true; }
      }
      throw new Error(`Rawroute switch failed; ${rollbackFailed ? 'rollback incomplete—restore from private backup' : 'previous configs and marker restored'}. Backup: ${backup}. Sensitive output withheld.`);
    }
    return { mode, baseURL, envKey, dryRun: false, backup };
  } finally {
    fs.closeSync(fd);
    fs.unlinkSync(lock);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = configure(options(process.argv.slice(2)));
    console.log(`${result.dryRun ? 'Dry run; no changes' : 'Updated Codex and OpenCode'}: ${result.mode}, ${result.baseURL}, ${result.envKey}.`);
    if (result.backup) console.log(`Private backup: ${result.backup}. Restart existing applications/services separately if needed.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
