"""Read-only root /proc scan. Never emit process arguments or environments."""
import errno
import json
import os
import sys


def scan(targets, proc='/proc'):
    identities = {}
    for target in targets:
        st = os.stat(target['path'])
        identities[(st.st_dev, st.st_ino)] = target['id']
    hits = set()

    def inspect(pid, path, kind, namespace=True):
        if not path.startswith('/'):
            return
        # Resolve through the process root: inode matching also handles nspawn
        # bind mounts whose guest path differs from the host install path.
        path = path.removesuffix(' (deleted)')
        prefix = f'{proc}/{pid}/root' if namespace else ''
        while path != '/':
            try:
                st = os.stat(prefix + path)
                tool = identities.get((st.st_dev, st.st_ino))
                if tool:
                    hits.add((tool, int(pid), kind))
                    return
            except OSError as error:
                if error.errno not in (errno.ENOENT, errno.ESRCH, errno.ENOTDIR):
                    raise
            path = os.path.dirname(path)

    for pid in os.listdir(proc):
        if not pid.isdigit():
            continue
        base = f'{proc}/{pid}'
        try:
            for name in ('exe', 'cwd'):
                try:
                    inspect(pid, os.readlink(f'{base}/{name}'), name)
                except OSError as error:
                    if error.errno not in (errno.ENOENT, errno.ESRCH):
                        raise
            with open(f'{base}/cmdline', 'rb') as stream:
                for arg in stream.read().split(b'\0'):
                    inspect(pid, os.fsdecode(arg), 'argument')
            with open(f'{base}/maps') as stream:
                for line in stream:
                    fields = line.rstrip('\n').split(None, 5)
                    if len(fields) == 6:
                        inspect(pid, fields[5], 'mapped file')
            for fd in os.listdir(f'{base}/fd'):
                try:
                    inspect(pid, os.readlink(f'{base}/fd/{fd}'), 'open file')
                except OSError as error:
                    if error.errno not in (errno.ENOENT, errno.ESRCH):
                        raise
        except OSError as error:
            if error.errno not in (errno.ENOENT, errno.ESRCH):
                raise
    return [dict(id=tool, pid=pid, kind=kind) for tool, pid, kind in sorted(hits)]


if __name__ == '__main__':
    if os.geteuid() != 0:
        raise SystemExit('Root access required to inspect all host and guest processes')
    print(json.dumps(scan(json.load(sys.stdin))))
