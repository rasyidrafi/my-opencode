#!/bin/sh
# XFCE launches this on the desktop's own display and session bus.
[ "${SELKIES_SCALE_XFCE_PANEL:-}" = 1 ] || exit 0

# The monitor emits an initial banner, then one line per change. Reading
# the current DPI on either handles login as well as subsequent changes.
LC_ALL=C stdbuf -oL xfconf-query -c xsettings -p /Xft/DPI -m |
  while IFS= read -r event; do /usr/bin/python3 "$(dirname "$0")/scale-desktop.py"; done
