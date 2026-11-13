"""Root-only, narrowly scoped system service integration. Never print unit data."""
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
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


def managed_directives(text, fragment):
    lines = text.splitlines()
    if not lines or lines[0] != HEADER.rstrip('\n'):
        raise RuntimeError('Managed drop-in marker is missing; manual review required.')
    start = 2 if len(lines) >= 4 and lines[1] == '[Service]' else 1
    reset = [i for i, line in enumerate(lines) if line == 'ExecStart=']
    if len(reset) != 1 or reset[0] != len(lines) - 2 or not lines[-1].startswith('ExecStart='):
        raise RuntimeError('Managed drop-in was modified; manual review required.')
    old_binary, old_arguments = parse_start('[Service]\n' + lines[-1] + '\n')
    if old_arguments != parse_start(fragment)[1]:
        raise RuntimeError('Managed drop-in arguments differ from the original service; manual review required.')
    return [line + '\n' for line in lines[start:reset[0]]]


def render(fragment, binary, directives=()):
    if not re.fullmatch(r'/[^\s"\'\\%$]+', binary) or Path(binary).name != 'cloudflared':
        raise RuntimeError('Unsupported target executable path.')
    _, arguments = parse_start(fragment)
    # Prevent cloudflared self-update from changing a version-pinned installation.
    if not re.search(r'(^|\s)--no-autoupdate(?=\s|$)', arguments):
        raise RuntimeError('Existing service must specify --no-autoupdate; manual review required.')
    preserved = ''.join(directive + ('' if directive.endswith('\n') else '\n') for directive in directives)
    last_section = 'Service'
    if preserved:
        seen = {'Service'}
        kept = []
        for line in preserved.splitlines(keepends=True):
            match = re.fullmatch(r'\s*\[([^]]+)\]\s*\n?', line)
            if match:
                section = match[1]
                last_section = section
                if section in seen:
                    continue
                seen.add(section)
            kept.append(line)
        preserved = ''.join(kept)
    if last_section != 'Service':
        preserved += '[Service]\n'
    return HEADER + '[Service]\n' + preserved + 'ExecStart=\nExecStart=' + binary + arguments + '\n'


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


def load_dropins(info, fragment):
    paths = [Path(value) for value in info.get('DropInPaths', '').split()]
    safe_directory(DIRECTORY)
    local_paths = [path for path in paths if path.parent == DIRECTORY]
    external_paths = [path for path in paths if path.parent != DIRECTORY]
    actual = list(DIRECTORY.glob('*.conf')) if DIRECTORY.exists() else []
    if len(local_paths) != len(set(local_paths)) or set(actual) != set(local_paths):
        raise RuntimeError('Cloudflared drop-in inventory differs from systemd metadata; inspect masked, symlinked or unloaded files before retrying.')
    for path in local_paths:
        if path.is_symlink():
            raise RuntimeError('Refusing symlinked Cloudflared service drop-in.')
        metadata = path.stat()
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != OWNER or metadata.st_mode & 0o022:
            raise RuntimeError('Cloudflared service drop-ins must be root-owned regular files not writable by others.')
    DIRECTORY.mkdir(mode=0o755, exist_ok=True)
    backup = Path(tempfile.mkdtemp(prefix='.my-opencode-cloudflared-', dir=DIRECTORY))
    snapshots = []
    directives = []
    managed = False
    try:
        for index, path in enumerate(local_paths):
            metadata = path.stat()
            content = path.read_text()
            if content.startswith(HEADER):
                if managed:
                    raise RuntimeError('Multiple managed Cloudflared drop-ins found; manual review required.')
                directives.extend(managed_directives(content, fragment))
                managed = True
            elif path == OVERRIDE:
                raise RuntimeError('Refusing to replace an unmanaged drop-in.')
            else:
                directives.append(content if content.endswith('\n') else content + '\n')
            saved = backup / f'{index:04d}-{path.name}'
            shutil.copy2(path, saved, follow_symlinks=False)
            snapshots.append((saved, path))
        if external_paths:
            directives.append('# External drop-ins retained; consolidated from service-specific drop-ins only.\n')
        return backup, snapshots, directives
    except Exception:
        for saved, original in snapshots:
            if saved.exists():
                os.replace(saved, original)
        shutil.rmtree(backup, ignore_errors=True)
        raise


def restore_dropins(backup, snapshots):
    if OVERRIDE.exists():
        OVERRIDE.unlink()
    for saved, original in snapshots:
        if saved.exists():
            os.replace(saved, original)
    shutil.rmtree(backup, ignore_errors=True)


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
    fragment = fragment_path.read_text()
    backup, snapshots, directives = load_dropins(info, fragment)
    desired = render(fragment, binary, directives)
    target = Path(binary)
    if not target.is_file() or str(target.resolve()) != binary or not os.access(target, os.X_OK):
        restore_dropins(backup, snapshots)
        raise RuntimeError('Pinned executable is missing, symlinked or not executable.')
    attempted_restart = False
    try:
        write_override(desired)
        for _, path in snapshots:
            if path != OVERRIDE:
                path.unlink()
        systemctl('daemon-reload')
        running(state())
        if operation == 'setup':
            shutil.rmtree(backup)
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
        shutil.rmtree(backup)
        print(f'cloudflared.service restarted using pinned executable: {binary} (PID {pid}).')
    except Exception:
        try:
            restore_dropins(backup, snapshots)
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
