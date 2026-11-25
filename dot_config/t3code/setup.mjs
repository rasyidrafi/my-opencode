import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireTaskPlatform } from '../my-opencode/platform.mjs';

export function setup({ platform = process.platform, env = process.env, execute = spawnSync } = {}) {
  requireTaskPlatform('t3code:setup', ['linux', 'windows'], platform, env);
  const windows = platform === 'win32';
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 't3code-install-'));
  const installer = path.join(tempDir, windows ? 'install.ps1' : 'install.sh');
  const run = (command, args, options = {}) => {
    const result = execute(command, args, { stdio: 'inherit', env, ...options });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${command} failed with status ${result.status}.`);
  };
  try {
    run('curl', ['--fail', '--location', '--silent', '--show-error', '--max-time', '120', `https://t3.codes/install.${windows ? 'ps1' : 'sh'}`, '--output', installer]);
    if (windows) run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', installer], { timeout: 900_000 });
    else run('sh', [installer], { timeout: 900_000 });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { setup(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
