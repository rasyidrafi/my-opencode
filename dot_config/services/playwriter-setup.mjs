import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireTaskPlatform } from '../my-opencode/platform.mjs';

export function setup({ platform = process.platform, home = os.homedir(), env = process.env, execute = spawnSync } = {}) {
  requireTaskPlatform('playwriter:setup', ['linux', 'windows'], platform, env);
  const data = env.MISE_DATA_DIR || (platform === 'win32'
    ? path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'mise')
    : path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'mise'));
  const shimNames = platform === 'win32' ? ['playwriter.exe', 'playwriter.cmd', 'playwriter'] : ['playwriter'];
  const shim = shimNames.map(name => path.join(data, 'shims', name))
    .find(target => fs.existsSync(target) && fs.statSync(target).isFile());
  if (!shim) throw new Error('Playwriter Mise shim missing. Run mise install and mise reshim first.');

  const result = execute(shim, ['serve', 'restart'], { stdio: 'inherit', windowsHide: true });
  if (result.error || result.status !== 0) {
    throw new Error('playwriter:setup failed. Check the command output above.');
  }
  console.log('Playwriter relay is running in the background.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error('Usage: playwriter:setup (no arguments)');
    setup();
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
