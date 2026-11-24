#!/bin/sh
set -eu

prefix=${PREFIX:-}
if [ -n "${TERMUX_VERSION:-}" ] || [ "$prefix" != "${prefix#/data/data/com.termux/}" ]; then
  echo 'crd:setup is not supported on Android/Termux.' >&2
  exit 1
fi
if [ "$(uname -s)" != Linux ] || [ "$(dpkg --print-architecture 2>/dev/null || :)" != amd64 ] || ! command -v apt-get >/dev/null 2>&1; then
  echo 'Chrome Remote Desktop setup requires Debian/Ubuntu on amd64.' >&2
  exit 1
fi
[ "$(id -u)" != 0 ] || { echo 'Run this task as the desktop user, not root.' >&2; exit 1; }

unit="chrome-remote-desktop@$(id -un).service"
if [ "$(dpkg-query -W -f='${db:Status-Status}' chrome-remote-desktop 2>/dev/null || :)" != installed ]; then
  command -v curl >/dev/null || { echo 'curl is required to download Chrome Remote Desktop.' >&2; exit 1; }
  tmpdir=$(mktemp -d)
  trap 'rm -f "$tmpdir/chrome-remote-desktop.deb"; rmdir "$tmpdir"' EXIT
  curl -fsSL https://dl.google.com/linux/direct/chrome-remote-desktop_current_amd64.deb -o "$tmpdir/chrome-remote-desktop.deb"
  chmod 755 "$tmpdir"
  chmod 644 "$tmpdir/chrome-remote-desktop.deb"
  sudo apt-get update
  sudo apt-get install -y --no-install-recommends --no-upgrade "$tmpdir/chrome-remote-desktop.deb"
fi

session_file="$HOME/.chrome-remote-desktop-session"
if { [ ! -e "$session_file" ] && [ ! -e /etc/chrome-remote-desktop-session ]; } ||
   printf '%s\n' 'exec /etc/X11/Xsession /usr/bin/xfce4-session' | cmp -s - "$session_file" ||
   cmp -s - "$session_file" <<'OLD_LAUNCHER'
# Start the XFCE desktop components without the crashing session manager.
unset SESSION_MANAGER
export XDG_CURRENT_DESKTOP=XFCE
exec dbus-run-session -- sh -c 'xfce4-panel & xfdesktop & exec xfwm4 --replace'
OLD_LAUNCHER
then
  cp -- "$(dirname -- "$0")/session.sh" "$session_file"
  echo 'Configured XFCE for the remote session.'
else
  echo 'Preserving existing Chrome Remote Desktop session configuration.'
fi

if systemctl is-active --quiet "$unit"; then
  echo 'Chrome Remote Desktop is already running; leaving the session unchanged.'
  exit 0
fi
for host in "$HOME"/.config/chrome-remote-desktop/host\#*.json; do
  if [ -f "$host" ]; then
    sudo systemctl start "$unit"
    if systemctl is-active --quiet "$unit"; then
      echo 'Chrome Remote Desktop is running. Connect at https://remotedesktop.google.com/access.'
      exit 0
    fi
    echo "Chrome Remote Desktop did not become active; check: systemctl status $unit" >&2
    exit 1
  fi
done

echo 'Register this host at https://remotedesktop.google.com/headless using the Debian Linux command.'
echo 'Run that command in an interactive terminal and choose a PIN when prompted.'
echo 'Run mise run desktop:setup separately to install and configure the shared XFCE desktop.'
