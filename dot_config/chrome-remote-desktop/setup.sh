#!/bin/sh
set -eu

unit="chrome-remote-desktop@$(id -un).service"
if systemctl is-active --quiet "$unit"; then
  printf 'Chrome Remote Desktop is already running (%s); leaving it unchanged.\n' "$unit"
  exit 0
fi

if [ "$(uname -s)" != Linux ] || [ "$(dpkg --print-architecture 2>/dev/null || :)" != amd64 ] || ! command -v apt-get >/dev/null 2>&1; then
  echo 'Chrome Remote Desktop setup requires Debian/Ubuntu on amd64.' >&2
  exit 1
fi
if [ "$(id -u)" -eq 0 ]; then
  echo 'Run this task as the desktop user, not root.' >&2
  exit 1
fi

authenticate_sudo() {
  if ! sudo -n /usr/bin/true >/dev/null 2>&1; then
    echo 'Administrator access is needed; sudo may ask for your password.'
    sudo -v
  fi
}

missing=''
for package in chrome-remote-desktop xfce4 dbus-x11; do
  if [ "$(dpkg-query -W -f='${db:Status-Status}' "$package" 2>/dev/null || :)" != installed ]; then
    missing="$missing $package"
  fi
done
if [ -n "$missing" ]; then
  echo 'Installing missing Chrome Remote Desktop and XFCE packages (sudo required).'
  authenticate_sudo
  sudo apt-get update
  if ! dpkg-query -W -f='${db:Status-Status}' chrome-remote-desktop 2>/dev/null | grep -qx installed; then
    tmpdir=$(mktemp -d)
    trap 'rm -rf "$tmpdir"' EXIT HUP INT TERM
    curl -fsSL https://dl.google.com/linux/direct/chrome-remote-desktop_current_amd64.deb -o "$tmpdir/chrome-remote-desktop.deb"
    # The local package supplies Chrome Remote Desktop; apt resolves its dependencies.
    sudo apt-get install -y "$tmpdir/chrome-remote-desktop.deb" xfce4 dbus-x11
    rm -rf "$tmpdir"
    trap - EXIT HUP INT TERM
  else
    sudo apt-get install -y $missing
  fi
fi

session_file="$HOME/.chrome-remote-desktop-session"
if [ ! -e "$session_file" ] && [ ! -e /etc/chrome-remote-desktop-session ]; then
  printf '%s\n' 'exec /etc/X11/Xsession /usr/bin/xfce4-session' > "$session_file"
  echo 'Configured XFCE for the remote session.'
else
  echo 'Preserving existing Chrome Remote Desktop session configuration.'
fi

registered=false
for host in "$HOME"/.config/chrome-remote-desktop/host\#*.json; do
  if [ -f "$host" ]; then registered=true; break; fi
done
if [ "$registered" = true ]; then
  echo 'Starting the existing Chrome Remote Desktop service (sudo required).'
  authenticate_sudo
  sudo systemctl start "$unit"
else
  [ -t 0 ] || { echo 'First-time setup requires an interactive terminal.' >&2; exit 1; }
  printf '%s\n' 'Open https://remotedesktop.google.com/headless on another device and authorize access.'
  printf '%s\n' 'From the Debian Linux command, paste only the value after --code= (without quotes).'
  printf 'Authorization code: '
  stty -echo
  trap 'stty echo; printf "\n"' EXIT HUP INT TERM
  IFS= read -r code
  stty echo
  trap - EXIT HUP INT TERM
  printf '\n'
  case "$code" in 4/*) ;; *) echo 'Invalid authorization code; generate a new one and retry.' >&2; exit 1;; esac
  DISPLAY= /opt/google/chrome-remote-desktop/start-host --code="$code" --redirect-url='https://remotedesktop.google.com/_/oauthredirect' --name="$(hostname)"
  unset code
fi

if systemctl is-active --quiet "$unit"; then
  echo 'Chrome Remote Desktop is running. Connect at https://remotedesktop.google.com/access.'
else
  echo "Chrome Remote Desktop did not become active; check: systemctl status $unit" >&2
  exit 1
fi
