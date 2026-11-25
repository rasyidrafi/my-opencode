import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireTaskPlatform } from '../my-opencode/platform.mjs';

export function setup({ platform = process.platform, env = process.env, execute = spawnSync } = {}) {
  requireTaskPlatform('t3code:setup', ['linux'], platform, env);
  const run = (args) => {
    const result = execute('systemctl', ['--user', ...args], { stdio: 'inherit', env });
    if (result.error || result.status !== 0) throw new Error(`systemctl ${args.join(' ')} failed.`);
  };
  const unit = path.join(env.HOME, '.config/systemd/user/t3code.service');
  if (!fs.existsSync(unit)) throw new Error('T3 service is not installed. Run t3 up first to configure access and install it.');
  const directory = `${unit}.d`;
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'my-opencode.conf'), '[Service]\nExecStart=\nExecStart=/bin/sh %h/.config/t3code/service.sh\n');
  run(['daemon-reload']);
  run(['restart', 't3code.service']);
  console.log('T3 service restarted with the managed shell environment. Run t3 pair separately when needed.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { setup(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
