#!/usr/bin/env python3
"""Seed the same Mint XFCE profile once, preserving an existing profile backup."""
import os
from pathlib import Path
import shutil
from xml.sax.saxutils import escape

home = Path.home()
preset = home / '.config/chrome-remote-desktop/mint-preset'
xfce = home / '.config/xfce4'
state = home / '.local/state/crd-mint'
marker = state / 'preset-v1-complete'
if marker.exists():
    print('Mint XFCE preset was already initialized; keeping current settings.')
    raise SystemExit(0)

variant = os.environ.get('CRD_MINT_THEME', 'dark')
if variant not in ('dark', 'light'):
    raise SystemExit('CRD_MINT_THEME must be dark or light.')
theme_name = 'Mint-Y-Aqua' if variant == 'light' else 'Mint-Y-Dark-Aqua'
wallpaper = home / '.local/share/backgrounds/crd-mint/sele_ring.jpg'
theme = home / '.local/share/themes' / theme_name / 'gtk-3.0/gtk.css'
if not wallpaper.is_file() or not theme.is_file():
    raise SystemExit('Mint theme or wallpaper is missing; run mint-assets.sh first.')

state.mkdir(parents=True, exist_ok=True)
backup = state / 'xfce4-before-mint'
if xfce.exists() and not backup.exists():
    # A temporary directory prevents a failed copy being mistaken for a backup.
    staging = state / 'xfce4-before-mint.partial'
    if staging.exists():
        shutil.rmtree(staging)
    shutil.copytree(xfce, staging, symlinks=True)
    staging.rename(backup)

channels = xfce / 'xfconf/xfce-perchannel-xml'
channels.mkdir(parents=True, exist_ok=True)
for src in preset.glob('*.xml'):
    data = src.read_text(encoding='utf-8').replace('MINT_WALLPAPER_PATH', escape(str(wallpaper), {'"': '&quot;'}))
    if src.name in ('xsettings.xml', 'xfwm4.xml'):
        data = data.replace('Mint-Y-Dark-Aqua', theme_name)
    (channels / src.name).write_text(data, encoding='utf-8')
shutil.copytree(preset / 'panel', xfce / 'panel', dirs_exist_ok=True)
(xfce / 'terminal').mkdir(parents=True, exist_ok=True)
shutil.copy2(preset / 'terminalrc', xfce / 'terminal/terminalrc')
tmp = marker.with_suffix('.partial')
tmp.write_text('Mint XFCE preset v1\n', encoding='utf-8')
os.replace(tmp, marker)
print('Mint XFCE preset initialized.' + (f' Previous profile backed up at {backup}.' if backup.exists() else ''))
