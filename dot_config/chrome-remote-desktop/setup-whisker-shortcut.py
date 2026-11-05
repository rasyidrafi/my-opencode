#!/usr/bin/env python3
"""Ensure the left Super key opens Whisker Menu in the current XFCE session."""
import os
from pathlib import Path
import subprocess
import tempfile
import xml.etree.ElementTree as ET

channel = 'xfce4-keyboard-shortcuts'
shortcut = '/commands/custom/Super_L'
command = 'xfce4-popup-whiskermenu'

env = os.environ.copy()
if not env.get('DBUS_SESSION_BUS_ADDRESS'):
    bus = Path(f'/run/user/{os.getuid()}/bus')
    if bus.exists():
        env['DBUS_SESSION_BUS_ADDRESS'] = f'unix:path={bus}'
    else:
        env.pop('DBUS_SESSION_BUS_ADDRESS', None)

query = ['xfconf-query', '-c', channel, '-p', shortcut]
live = False
try:
    current = subprocess.run(query, env=env, text=True, capture_output=True, timeout=5)
    if current.returncode == 0 and current.stdout.rstrip('\n') == command:
        print('Super key already opens Whisker Menu.')
        raise SystemExit(0)
    args = query.copy()
    if current.returncode != 0:
        args += ['-n', '-t', 'string']
    args += ['-s', command]
    live = subprocess.run(args, env=env, capture_output=True, timeout=5).returncode == 0
except (FileNotFoundError, OSError, subprocess.TimeoutExpired):
    pass

if live:
    print('Configured Super key to open Whisker Menu.')
    raise SystemExit(0)

# A running xfconf session is not always available during CRD setup (for
# example, on first install over SSH). Keep the persistent setting correct so
# XFCE loads it at the next login instead of failing the whole setup task.
target = Path.home() / '.config/xfce4/xfconf/xfce-perchannel-xml' / f'{channel}.xml'
parser = ET.XMLParser(target=ET.TreeBuilder(insert_comments=True))
if target.exists():
    resolved = target.resolve()
    tree = ET.parse(resolved, parser=parser)
    root = tree.getroot()
else:
    resolved = target
    root = ET.Element('channel', {'name': channel, 'version': '1.0'})
    tree = ET.ElementTree(root)

def property_child(parent, name, kind):
    for prop in parent.findall('property'):
        if prop.get('name') == name:
            return prop
    return ET.SubElement(parent, 'property', {'name': name, 'type': kind})

commands = property_child(root, 'commands', 'empty')
custom = property_child(commands, 'custom', 'empty')
binding = property_child(custom, 'Super_L', 'string')
changed = binding.get('type') != 'string' or binding.get('value') != command
binding.set('type', 'string')
binding.set('value', command)
if not changed:
    print('Super key shortcut is already configured for the next XFCE login.')
    raise SystemExit(0)

ET.indent(tree, space='  ')
resolved.parent.mkdir(parents=True, exist_ok=True)
fd, temporary = tempfile.mkstemp(prefix=f'.{channel}-', dir=resolved.parent)
try:
    with os.fdopen(fd, 'wb') as stream:
        tree.write(stream, encoding='utf-8', xml_declaration=True)
    if resolved.exists():
        os.chmod(temporary, resolved.stat().st_mode & 0o777)
    os.replace(temporary, resolved)
finally:
    if os.path.exists(temporary):
        os.unlink(temporary)
print('Configured Super key for Whisker Menu at the next XFCE login.')
