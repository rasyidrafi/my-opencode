#!/usr/bin/python3
"""Republish XFCE panel reservations after CRD changes the X11 screen size."""
import fcntl
import hashlib
import os
from pathlib import Path
import subprocess
import time


def query(*args):
    return subprocess.check_output(args, text=True, stderr=subprocess.DEVNULL).strip()


def refresh():
    channel = ['xfconf-query', '-c', 'xfce4-panel']
    properties = query(*channel, '-l').splitlines()
    for prop in properties:
        if not prop.startswith('/panels/panel-') or not prop.endswith('/size'):
            continue
        size = int(query(*channel, '-p', prop))
        # A changed value forces the panel to publish fresh struts. Restore the
        # user's size, rather than assuming a pixel height or DPI setting.
        try:
            subprocess.run(channel + ['-p', prop, '-s', str(size + 1)], check=True)
            time.sleep(0.2)
        finally:
            subprocess.run(channel + ['-p', prop, '-s', str(size)], check=True)


def main():
    if not os.environ.get('DISPLAY'):
        return
    state = Path(os.environ.get('XDG_RUNTIME_DIR', f'/run/user/{os.getuid()}'))
    display_id = hashlib.sha256(os.environ['DISPLAY'].encode()).hexdigest()[:16]
    with (state / f'crd-panel-workarea-{display_id}.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        previous = None
        while True:
            try:
                geometry = query('xprop', '-root', '_NET_DESKTOP_GEOMETRY')
                if ' = ' in geometry and geometry != previous:
                    # Allow the panel and window manager to finish resizing.
                    time.sleep(1)
                    refresh()
                    previous = geometry
            except (subprocess.SubprocessError, ValueError):
                pass  # Retry if the panel/window manager is still starting.
            time.sleep(2)


if __name__ == '__main__':
    main()
