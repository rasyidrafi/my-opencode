#!/usr/bin/env python3
"""Set up the XFCE Whisker Menu or region screenshot shortcut."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET

channel = 'xfce4-keyboard-shortcuts'
if sys.argv[1:] == ['--screenshot']:
    key = '<Primary><Shift>s'
    command = 'xfce4-screenshooter -r -c'
    label = 'Ctrl+Shift+S'
    action = 'the region-to-clipboard screenshot tool'
else:
    key = 'Super_L'
    command = 'xfce4-popup-whiskermenu'
    label = 'Super key'
    action = 'Whisker Menu'
override = '/commands/custom/override'

env = os.environ.copy()
if not env.get('DBUS_SESSION_BUS_ADDRESS'):
    bus = Path(f'/run/user/{os.getuid()}/bus')
    if bus.exists():
        env['DBUS_SESSION_BUS_ADDRESS'] = f'unix:path={bus}'
    else:
        env.pop('DBUS_SESSION_BUS_ADDRESS', None)

query_base = ['xfconf-query', '-c', channel, '-p']
live = False
try:
    # XFCE clones the defaults into custom bindings on first startup.
    enabled = subprocess.run(query_base + [override], env=env, text=True, capture_output=True, timeout=5)
    group = 'custom' if enabled.returncode == 0 and enabled.stdout.strip() == 'true' else 'default'
    query = query_base + [f'/commands/{group}/{key}']
    current = subprocess.run(query, env=env, text=True, capture_output=True, timeout=5)
    if current.returncode == 0 and current.stdout.rstrip('\n') == command:
        print(f'{label} already opens {action}.')
        raise SystemExit(0)
    args = query.copy()
    if current.returncode != 0:
        args += ['-n', '-t', 'string']
    args += ['-s', command]
    live = subprocess.run(args, env=env, capture_output=True, timeout=5).returncode == 0
except (FileNotFoundError, OSError, subprocess.TimeoutExpired):
    pass

if live:
    print(f'Configured {label} to open {action}.')
    raise SystemExit(0)

# A running xfconf session is not always available during CRD setup (for
# example, on first install over SSH). Keep the persistent setting correct so
# XFCE loads it at the next login instead of failing the whole setup task.
config = Path(os.environ.get('XDG_CONFIG_HOME') or Path.home() / '.config')
target = config / 'xfce4/xfconf/xfce-perchannel-xml' / f'{channel}.xml'
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
enabled = commands.find("./property[@name='custom']/property[@name='override']")
group = 'custom' if enabled is not None and enabled.get('value') == 'true' else 'default'
binding = property_child(property_child(commands, group, 'empty'), key, 'string')
changed = binding.get('type') != 'string' or binding.get('value') != command
binding.set('type', 'string')
binding.set('value', command)
if not changed:
    print(f'{label} shortcut is already configured for the next XFCE login.')
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
print(f'Configured {label} to open {action} at the next XFCE login.')
