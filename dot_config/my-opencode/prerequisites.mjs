import { execFileSync } from 'node:child_process';

// Privileged helpers and systemd units intentionally use the OS interpreter.
export function requireSystemPython(task, execute = execFileSync) {
  try {
    execute('/usr/bin/python3', ['--version'], { stdio: 'ignore', timeout: 10_000 });
  } catch {
    throw new Error(`${task} requires a working system Python 3 at /usr/bin/python3. Install your distribution's python3 package (Debian/Ubuntu: sudo apt install python3), then rerun the task.`);
  }
}
