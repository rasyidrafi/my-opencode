#!/bin/sh
set -eu
[ "$(id -u)" != 0 ] || { echo 'Run as your desktop user, not root.' >&2; exit 1; }
command -v dpkg-query >/dev/null || { echo 'Requires a Debian/Ubuntu host.' >&2; exit 1; }
systemctl --user show-environment >/dev/null
unit=selkies-desktop.service
units=${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user
if systemctl --user list-unit-files "$unit" --no-legend | grep -q "^$unit "; then
  systemctl --user disable --now "$unit"
fi
status=$(dpkg-query -W -f='${db:Status-Status}' selkies 2>/dev/null) || status=not-installed
if [ "$status" != not-installed ]; then
  sudo dpkg --purge selkies
fi
rm -f -- "$units/$unit"
systemctl --user daemon-reload
rm -rf -- "$HOME/.local/share/selkies-desktop" "$HOME/.local/state/selkies-desktop"
legacy="${XDG_CONFIG_HOME:-$HOME/.config}/autostart/selkies-panel-scale.desktop"
if [ -f "$legacy" ] && grep -Fxq 'Exec=sh -c "exec sh $HOME/.config/selkies/panel-scale.sh"' "$legacy"; then
  rm -f -- "$legacy"
fi
echo 'Selkies removed. XFCE and shared desktop settings were preserved.'
