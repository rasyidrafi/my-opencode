#!/usr/bin/python3
"""Select XFCE Terminal as the default terminal emulator, preserving other helpers."""
from pathlib import Path

target = Path.home() / '.config/xfce4/helpers.rc'
old = target.read_text() if target.exists() else ''
result = []
found = False
for line in old.splitlines():
    if line.startswith('TerminalEmulator='):
        if not found:
            result.append('TerminalEmulator=xfce4-terminal')
            found = True
    else:
        result.append(line)
if not found:
    result.append('TerminalEmulator=xfce4-terminal')
new = '\n'.join(result) + '\n'
if new != old:
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(new)
print('XFCE default terminal configured: xfce4-terminal.')
