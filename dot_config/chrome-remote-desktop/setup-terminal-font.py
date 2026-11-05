#!/usr/bin/python3
"""Set an installed fixed-width terminal font without resetting other settings."""
from pathlib import Path
import os
import re
import shutil
import subprocess

home = Path.home()
target = home / '.config/xfce4/terminal/terminalrc'
old = target.read_text() if target.exists() else ''
lines = old.splitlines(keepends=True)
values = {'FontName': 'Liberation Mono 10', 'FontUseSystem': 'FALSE'}
result = []
in_config = False
found = False
pending = dict(values)
for line in lines:
    section = re.match(r'\s*\[([^]]+)\]', line)
    if section:
        if in_config:
            result.extend(f'{key}={value}\n' for key, value in pending.items())
            pending.clear()
        in_config = section[1] == 'Configuration'
        found |= in_config
    key = line.split('=', 1)[0].strip()
    if in_config and key in values and '=' in line:
        if key in pending:
            result.append(f'{key}={pending.pop(key)}\n')
        continue
    result.append(line if line.endswith('\n') else line + '\n')
if not found:
    result.append('[Configuration]\n')
result.extend(f'{key}={value}\n' for key, value in pending.items())
new = ''.join(result)
if new != old:
    target.parent.mkdir(parents=True, exist_ok=True)
    backup = home / '.local/state/crd-mint/terminalrc-before-font'
    if target.exists() and not backup.exists():
        backup.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(target, backup)
    target.write_text(new)

# Current XFCE Terminal uses xfconf; terminalrc also covers initial migration
# and older versions. Do not require a graphical session for offline setup.
if shutil.which('xfconf-query') and (os.environ.get('DBUS_SESSION_BUS_ADDRESS') or os.environ.get('DISPLAY')):
    for prop, kind, value in [('font-name', 'string', values['FontName']), ('font-use-system', 'bool', 'false')]:
        args = ['xfconf-query', '-c', 'xfce4-terminal', '-p', '/' + prop]
        current = subprocess.run(args, capture_output=True, text=True)
        if current.returncode == 0 and current.stdout.strip() == value:
            continue
        subprocess.run(args + ['-n', '-t', kind, '-s', value], check=True)
print('XFCE Terminal font configured: Liberation Mono 10.')
