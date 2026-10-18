import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function install(home) {
  // A task cannot change its parent shell. Install a loader for future shells.
  const loader = '[ ! -r "$HOME/.config/azure-mnt-cache/cache.sh" ] || . "$HOME/.config/azure-mnt-cache/cache.sh"';
  for (const name of ['.bashrc', '.profile', '.zshrc', '.zprofile']) {
    const target = path.join(home, name);
    const previous = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
    if (!previous.split(/\r?\n/).includes(loader)) {
      fs.appendFileSync(target, `${previous.endsWith('\n') || !previous ? '' : '\n'}\n# Managed by mise azure-mnt-cache:setup\n${loader}\n`, { mode: 0o600 });
    }
  }
  // Bash skips .profile when one of these existing login files is present.
  for (const name of ['.bash_profile', '.bash_login']) {
    const target = path.join(home, name);
    if (!fs.existsSync(target)) continue;
    const previous = fs.readFileSync(target, 'utf8');
    if (!previous.split(/\r?\n/).includes(loader)) {
      fs.appendFileSync(target, `${previous.endsWith('\n') ? '' : '\n'}\n# Managed by mise azure-mnt-cache:setup\n${loader}\n`);
    }
    break;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.platform !== 'linux') throw new Error('This task supports Linux only.');
    install(os.homedir());
    console.log('Installed cache loader for new Bash/Zsh shells. Existing caches were not moved or deleted.');
    console.log('Activate in this shell: . "$HOME/.config/azure-mnt-cache/cache.sh"');
    console.log('Uses /mnt only when mounted and writable; otherwise uses home defaults.');
    console.log('If /mnt/cache is not writable, ask an administrator to create /mnt/cache/<your-user> owned by you.');
    console.log('Files stored on an Azure temporary disk can disappear when that disk is reset.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
