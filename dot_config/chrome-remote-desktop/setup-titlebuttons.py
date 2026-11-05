#!/usr/bin/python3
"""Maintain one GTK3 override block without replacing other user CSS."""
from pathlib import Path
import os
import shutil
import tempfile

home = Path.home()
config = home / '.config/chrome-remote-desktop'
target = home / '.config/gtk-3.0/gtk.css'
start = '/* BEGIN crd-managed PWA titlebuttons */'
end = '/* END crd-managed PWA titlebuttons */'
block = start + '\n' + (config / 'pwa-titlebuttons.css').read_text() + end + '\n'
old = target.read_text() if target.exists() else ''
if start in old or end in old:
    if old.count(start) != 1 or old.count(end) != 1 or old.index(start) > old.index(end):
        raise SystemExit('Malformed CRD titlebutton CSS markers; refusing to modify gtk.css.')
    first = old.index(start)
    last = old.index(end) + len(end)
    if old[last:last + 1] == '\n':
        last += 1
    new = old[:first] + block + old[last:]
else:
    new = old + ('\n' if old and not old.endswith('\n') else '') + block
if new != old:
    target.parent.mkdir(parents=True, exist_ok=True)
    # Follow an existing symlink rather than replacing the user's link.
    destination = target.resolve()
    backup = home / '.local/state/crd-mint/gtk.css-before-titlebuttons'
    if target.exists() and not backup.exists():
        backup.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(target, backup)
    fd, name = tempfile.mkstemp(prefix='.gtk.css-', dir=destination.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            stream.write(new)
        if destination.exists():
            shutil.copymode(destination, name)
        os.replace(name, destination)
    finally:
        if os.path.exists(name):
            os.unlink(name)
    print('GTK PWA titlebutton spacing configured; reopen Chrome/PWAs to load it.')
else:
    print('GTK PWA titlebutton spacing is already configured.')
