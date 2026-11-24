#!/bin/sh
set -eu
[ "$(id -u)" != 0 ] || { echo 'Run as your desktop user, not root.' >&2; exit 1; }
command -v dpkg-query >/dev/null || { echo 'Requires a Debian/Ubuntu host.' >&2; exit 1; }
pkg=chrome-remote-desktop
status=$(dpkg-query -W -f='${db:Status-Status}' "$pkg" 2>/dev/null) || status=not-installed
if [ "$status" != not-installed ]; then
  # dpkg invokes the package's service-stop and purge hooks. Unlike apt
  # autoremove it will never remove other packages to satisfy this request.
  unit="$pkg@$(id -un).service"
  if systemctl is-enabled --quiet "$unit"; then sudo systemctl disable --now "$unit"; fi
  sudo dpkg --purge "$pkg"
fi
config=$HOME/.config/chrome-remote-desktop
rm -f -- "$config"/host\#*.json "$config"/paired-clients/*.json
if [ -d "$config/paired-clients" ]; then rmdir --ignore-fail-on-non-empty -- "$config/paired-clients"; fi
session=$HOME/.chrome-remote-desktop-session
if cmp -s "$(dirname -- "$0")/session.sh" "$session" ||
   printf '%s\n' 'exec /etc/X11/Xsession /usr/bin/xfce4-session' | cmp -s - "$session"; then
  rm -- "$session"
fi
echo 'Chrome Remote Desktop removed locally. Selkies and shared XFCE settings were preserved.'
