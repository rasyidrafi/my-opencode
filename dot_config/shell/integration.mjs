import fs from 'node:fs';
import path from 'node:path';

export const start = '# >>> my-opencode shell v1 >>>';
export const end = '# <<< my-opencode shell v1 <<<';
export const pathStart = '# >>> my-opencode shell path v1 >>>';
export const pathEnd = '# <<< my-opencode shell path v1 <<<';
export const loader = '[ ! -r "$HOME/.config/shell/env.sh" ] || . "$HOME/.config/shell/env.sh"';
export const pathLoader = '[ ! -r "$HOME/.config/shell/path.sh" ] || . "$HOME/.config/shell/path.sh"';

export function read(target) {
  try { return fs.readFileSync(target, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
}

// An installed asset or a prose comment is not evidence of active integration.
export function centralized(home) {
  const rc = read(path.join(home, '.bashrc'));
  const login = ['.bash_profile', '.bash_login', '.profile'].find(name => fs.existsSync(path.join(home, name)));
  return read(path.join(home, '.config/shell/installed-v1')) === '1\n'
    && rc.startsWith(`${start}\n${loader}\n`)
    && !!login && read(path.join(home, login)).startsWith(`${start}\n${loader}\n`)
    && fs.existsSync(path.join(home, '.config/shell/env.sh'));
}

export function assertSafe(home, target) {
  const relative = path.relative(home, target);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Refusing a target outside the user home: ${target}`);
  }
  let current = home;
  for (const component of relative.split(path.sep)) {
    current = path.join(current, component);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Refusing to replace or traverse a symlink: ${current}`);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (fs.existsSync(target) && !fs.statSync(target).isFile()) throw new Error(`Expected a regular file: ${target}`);
}

export function privateWrite(home, target, content) {
  assertSafe(home, target);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.writeFileSync(target, content, { mode: 0o600 });
  fs.chmodSync(target, 0o600);
}
