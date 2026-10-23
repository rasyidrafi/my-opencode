"""Root-only, narrowly scoped system service integration. Never print unit data."""
import fcntl
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile

UNIT = 'cloudflared.service'
DIRECTORY = Path('/etc/systemd/system/cloudflared.service.d')
OVERRIDE = DIRECTORY / '90-my-opencode.conf'
HEADER = '# Managed by my-opencode cloudflared:setup\n'
OWNER = 0


def systemctl(*args):
    result = subprocess.run(['systemctl', *args], capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError('systemctl operation failed; inspect service health locally (logs may contain credentials).')
    return result.stdout


def state():
    return dict(line.split('=', 1) for line in systemctl(
        'show', UNIT, '--property=LoadState,ActiveState,SubState,MainPID,FragmentPath,DropInPaths', '--no-pager'
    ).splitlines() if '=' in line)


def running(info):
    if (info.get('LoadState'), info.get('ActiveState'), info.get('SubState')) != ('loaded', 'active', 'running'):
        raise RuntimeError('cloudflared.service must already be installed and running.')


def parse_start(text):
    section = None
    starts = []
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith(('#', ';')):
            continue
        if stripped.startswith('['):
            section = stripped
        elif section == '[Service]' and re.match(r'^ExecStart\s*=', stripped):
            starts.append(stripped.split('=', 1)[1].strip())
    if len(starts) != 1:
        raise RuntimeError('Unsupported ExecStart: expected one direct cloudflared command.')
    match = re.fullmatch(r'(/[^\s"\'\\%$]+)([ \t]+[^\r\n]*)?', starts[0])
    if not match or Path(match[1]).name != 'cloudflared' or starts[0].endswith('\\'):
        raise RuntimeError('Unsupported ExecStart syntax; manual review required.')
    return match[1], match[2] or ''


def render(fragment, binary):
    if not re.fullmatch(r'/[^\s"\'\\%$]+', binary) or Path(binary).name != 'cloudflared':
        raise RuntimeError('Unsupported target executable path.')
    _, arguments = parse_start(fragment)
    # Prevent cloudflared self-update from changing a version-pinned installation.
    if not re.search(r'(^|\s)--no-autoupdate(?=\s|$)', arguments):
        raise RuntimeError('Existing service must specify --no-autoupdate; manual review required.')
    return HEADER + '[Service]\nExecStart=\nExecStart=' + binary + arguments + '\n'


def safe_directory(path):
    for parent in [*reversed(path.parents), path]:
        if parent.is_symlink():
            raise RuntimeError('Refusing symlinked system configuration path.')
        if parent.exists():
            info = parent.stat()
            if not stat.S_ISDIR(info.st_mode) or info.st_uid != OWNER or info.st_mode & 0o022:
                raise RuntimeError('System configuration directory must be root-owned and not writable by others.')


def write_override(content):
    safe_directory(DIRECTORY)
    DIRECTORY.mkdir(mode=0o755, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix='.my-opencode-', dir=DIRECTORY)
    try:
        with os.fdopen(fd, 'w') as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, OVERRIDE)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def manage(request):
    operation, binary = request['operation'], request['binary']
    if operation not in ('setup', 'restart'):
        raise RuntimeError('Unsupported operation.')
    info = state()
    running(info)
    fragment_path = Path(info.get('FragmentPath', ''))
    if not fragment_path.is_absolute() or not fragment_path.is_file():
        raise RuntimeError('Cannot locate service fragment.')
    fragment_meta = fragment_path.stat()
    if fragment_meta.st_uid != OWNER or fragment_meta.st_mode & 0o022:
        raise RuntimeError('Service fragment must be root-owned and not writable by others.')
    if any(path != str(OVERRIDE) for path in info.get('DropInPaths', '').split()):
        raise RuntimeError('Unrelated service drop-ins require manual review before integration.')
    safe_directory(DIRECTORY)
    previous = None
    if OVERRIDE.is_symlink():
        raise RuntimeError('Refusing symlinked drop-in.')
    if OVERRIDE.exists():
        meta = OVERRIDE.stat()
        if not stat.S_ISREG(meta.st_mode) or meta.st_uid != OWNER or meta.st_mode & 0o077:
            raise RuntimeError('Managed drop-in must be a private root-owned file.')
        previous = OVERRIDE.read_text()
        if not previous.startswith(HEADER):
            raise RuntimeError('Refusing to replace an unmanaged drop-in.')
    if operation == 'restart' and previous is None:
        raise RuntimeError('Run mise run cloudflared:setup first.')
    fragment = fragment_path.read_text()
    desired = render(fragment, binary)
    if previous is not None:
        # Our existing file must contain only the expected override structure.
        lines = previous.splitlines()
        if len(lines) != 4 or lines[1:3] != ['[Service]', 'ExecStart='] or not lines[3].startswith('ExecStart='):
            raise RuntimeError('Managed drop-in was modified; manual review required.')
        if previous != render(fragment, lines[3][len('ExecStart='):].split()[0]):
            raise RuntimeError('Managed drop-in arguments differ from the original service; manual review required.')
    target = Path(binary)
    if not target.is_file() or str(target.resolve()) != binary or not os.access(target, os.X_OK):
        raise RuntimeError('Pinned executable is missing, symlinked or not executable.')
    changed = previous != desired
    attempted_restart = False
    try:
        if changed:
            write_override(desired)
        systemctl('daemon-reload')
        running(state())
        if operation == 'setup':
            print('Cloudflared Mise drop-in installed. Run cloudflared:restart to switch the running process.')
            return
        attempted_restart = True
        systemctl('try-restart', '--job-mode=fail', UNIT)
        updated = state()
        running(updated)
        pid = int(updated.get('MainPID', '0'))
        if pid <= 0 or os.readlink(f'/proc/{pid}/exe') != binary:
            raise RuntimeError('Restarted service is not using the pinned executable path.')
        if not os.path.samestat(os.stat(f'/proc/{pid}/exe'), target.stat()):
            raise RuntimeError('Restarted service executable identity differs from the pinned binary.')
        print(f'cloudflared.service restarted using pinned executable: {binary} (PID {pid}).')
    except Exception:
        try:
            if changed:
                if previous is None:
                    OVERRIDE.unlink()
                else:
                    write_override(previous)
            systemctl('daemon-reload')
            if attempted_restart:
                systemctl('restart', UNIT)
        except Exception:
            raise RuntimeError('Operation failed and recovery failed; manually inspect cloudflared.service.') from None
        raise RuntimeError('Operation failed; previous drop-in restored and service recovery attempted.') from None


if __name__ == '__main__':
    try:
        if os.geteuid() != 0:
            raise RuntimeError('Root access required.')
        # A root-owned lock serializes setup/restart across all users.
        lock_path = '/run/lock/my-opencode-cloudflared.lock'
        fd = os.open(lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'w') as lock:
            if os.fstat(lock.fileno()).st_uid != 0:
                raise RuntimeError('Unsafe cloudflared integration lock.')
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            manage(json.load(sys.stdin))
    except Exception as error:
        # Do not leak raw OS/subprocess exceptions or file contents.
        print(str(error) if isinstance(error, RuntimeError) else 'Cloudflared integration failed safely; inspect local permissions/state.', file=sys.stderr)
        sys.exit(1)
