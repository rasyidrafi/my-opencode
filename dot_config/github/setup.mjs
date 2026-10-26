import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const quote = value => `'${value.replaceAll("'", "'\\''")}'`;

export function configure({ home = os.homedir(), env = process.env, platform = process.platform, execute = spawnSync } = {}) {
  const data = env.MISE_DATA_DIR || (platform === 'win32'
    ? path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'mise')
    : path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'mise'));
  const shim = ['gh', ...(platform === 'win32' ? ['gh.exe', 'gh.cmd'] : [])]
    .map(name => path.join(data, 'shims', name)).find(target => fs.existsSync(target) && fs.statSync(target).isFile());
  if (!shim) throw new Error('GitHub CLI Mise shim missing. Run mise install and mise reshim first.');
  const helper = `!${quote(shim.replaceAll('\\', '/'))} auth git-credential`;
  const run = args => execute('git', args, { env, encoding: 'utf8', timeout: 30_000 });
  const keys = ['github.com', 'gist.github.com'].map(host => `credential.https://${host}.helper`);
  // Validate both hosts before writing; do not silently replace custom helpers.
  const pending = keys.filter(key => {
    const result = run(['config', '--global', '--get-all', key]);
    if (result.error || ![0, 1].includes(result.status)) throw new Error('Cannot read Git credential helper configuration.');
    const values = result.status === 1 ? [] : result.stdout.replace(/\r?\n$/, '').split(/\r?\n/);
    if (values.some(value => value && value !== helper && !/^!.*(?:\/|\\|\s|')gh(?:\.exe)?(?:'|\s)/.test(value))) {
      throw new Error('Custom GitHub credential helper found; review it manually before setup.');
    }
    return values.length !== 2 || values[0] !== '' || values[1] !== helper;
  });
  for (const key of pending) {
    for (const args of [['config', '--global', '--replace-all', key, ''], ['config', '--global', '--add', key, helper]]) {
      const result = run(args);
      if (result.error || result.status !== 0) throw new Error('Cannot update GitHub credential helper configuration; rerun setup after resolving Git config access.');
    }
  }
  return { helper, changed: pending.length > 0 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length > 2) throw new Error('Usage: github:setup (no arguments)');
    configure();
    console.log('GitHub HTTPS credential helpers use the stable Mise shim.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
