#!/usr/bin/env python3
"""Apply the Mint XFCE preset to a running XFCE session without restarting CRD."""
import os
from pathlib import Path
import shutil
import subprocess
import xml.etree.ElementTree as ET

home = Path.home()
preset = home / '.config/chrome-remote-desktop/mint-preset'
xfce = home / '.config/xfce4'
wallpaper = str(home / '.local/share/backgrounds/crd-mint/sele_ring.jpg')
env = os.environ.copy()
env.setdefault('DBUS_SESSION_BUS_ADDRESS', f'unix:path=/run/user/{os.getuid()}/bus')
env.setdefault('DISPLAY', ':20')
env.setdefault('XAUTHORITY', str(home / '.Xauthority'))

def set_property(channel, name, kind, values):
    if not values:
        return
    args = ['xfconf-query', '-c', channel, '-p', name, '-n']
    if kind == 'array':
        args.append('-a')
    for value_kind, value in values:
        args += ['-t', value_kind, '-s', value.replace('MINT_WALLPAPER_PATH', wallpaper)]
    subprocess.run(args, env=env, check=True, stdout=subprocess.DEVNULL)

def walk(channel, element, prefix=''):
    for prop in element.findall('property'):
        key = prefix + '/' + prop.attrib['name']
        kind = prop.get('type', 'empty')
        if kind == 'array':
            values = [(v.attrib['type'], v.attrib['value']) for v in prop.findall('value')]
            set_property(channel, key, kind, values)
        elif kind != 'empty' and 'value' in prop.attrib:
            set_property(channel, key, kind, [(kind, prop.attrib['value'])])
        walk(channel, prop, key)

if not Path(wallpaper).is_file():
    raise SystemExit('Mint wallpaper missing; run mint-assets.sh first.')
subprocess.run(['xfconf-query', '-c', 'xsettings', '-l'], env=env, check=True, stdout=subprocess.DEVNULL)
backup = home / '.local/state/crd-mint/xfce4-before-mint'
if not backup.exists():
    backup.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(xfce, backup)

# Stop only the panel while replacing its plugin configuration, not the desktop.
subprocess.run(['xfce4-panel', '--quit'], env=env, check=True)
try:
    for child in (preset / 'panel').iterdir():
        dest = xfce / 'panel' / child.name
        if child.is_dir():
            shutil.copytree(child, dest, dirs_exist_ok=True)
        else:
            shutil.copy2(child, dest)
    (xfce / 'terminal').mkdir(exist_ok=True)
    shutil.copy2(preset / 'terminalrc', xfce / 'terminal/terminalrc')
    # Removing the old panel tree prevents stale plugin properties from leaking
    # into new plugin IDs. The old configuration is backed up above.
    subprocess.run(['xfconf-query', '-c', 'xfce4-panel', '-p', '/plugins', '-r', '-R'], env=env, check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for channel in ['xsettings', 'xfwm4', 'xfce4-desktop', 'xfce4-notifyd', 'thunar', 'xfce4-panel']:
        root = ET.parse(preset / (channel + '.xml')).getroot()
        walk(channel, root)
    # Current XFCE uses output names and per-workspace settings, unlike Mint's
    # legacy monitor0 defaults. CRD's Xorg dummy output is called DUMMY0.
    for workspace in range(4):
        path = f'/backdrop/screen0/monitorDUMMY0/workspace{workspace}/last-image'
        set_property('xfce4-desktop', path, 'string', [('string', wallpaper)])
finally:
    subprocess.Popen(['xfce4-panel'], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
print('Mint XFCE settings applied; previous XFCE configuration backed up at', backup)
