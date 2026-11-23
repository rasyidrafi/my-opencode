#!/bin/sh
set -eu

prefix=${PREFIX:-}
if [ -n "${TERMUX_VERSION:-}" ] || [ "$prefix" != "${prefix#/data/data/com.termux/}" ]; then
  echo 'cua:setup is not supported on Android/Termux.' >&2
  exit 1
fi
if [ "$(uname -s)" != Linux ]; then
  echo 'cua:setup requires Linux with systemd.' >&2
  exit 1
fi
if ! command -v systemctl >/dev/null 2>&1 || ! systemctl --user show-environment >/dev/null 2>&1; then
  echo "A running systemd user manager is required." >&2
  exit 1
fi
if command -v dpkg-query >/dev/null 2>&1 && command -v apt-get >/dev/null 2>&1 &&
  [ "$(dpkg-query -W -f='${db:Status-Status}' at-spi2-core 2>/dev/null || :)" != installed ]; then
  echo 'Installing AT-SPI accessibility support; sudo may ask for your password.'
  sudo apt-get update
  sudo apt-get install -y --no-install-recommends at-spi2-core
elif ! command -v dpkg-query >/dev/null 2>&1; then
  echo 'On non-Debian Linux, install your distribution’s AT-SPI accessibility service if needed.' >&2
fi

if ! command -v cua-driver >/dev/null 2>&1 && [ ! -x "$HOME/.local/bin/cua-driver" ]; then
  command -v curl >/dev/null 2>&1 || { echo 'curl is required to install Cua Driver.' >&2; exit 1; }
  installer=$(mktemp)
  trap 'rm -f "$installer"' EXIT HUP INT TERM
  curl -fsSL https://cua.ai/driver/install.sh -o "$installer"
  /bin/bash "$installer" --no-modify-path --no-connect --no-test
  rm -f "$installer"
  trap - EXIT HUP INT TERM
fi

driver=$(command -v cua-driver || :)
if [ -z "$driver" ] && [ -x "$HOME/.local/bin/cua-driver" ]; then
  driver="$HOME/.local/bin/cua-driver"
fi
[ -n "$driver" ] || { echo 'Cua Driver installer finished but the executable was not found.' >&2; exit 1; }
case "$driver" in
  /*) ;;
  *) echo "cua-driver must resolve to an absolute path." >&2; exit 1 ;;
esac
unit_dir=${XDG_CONFIG_HOME:-"$HOME/.config"}/systemd/user
unit=$unit_dir/cua-driver.service
mkdir -p "$unit_dir"
tmp=$(mktemp "$unit_dir/.cua-driver.service.XXXXXX")
trap 'rm -f "$tmp"' EXIT HUP INT TERM
escaped_driver=$(printf '%s' "$driver" | sed 's/[%]/%%/g; s/\\/\\\\/g; s/"/\\"/g')
case "$escaped_driver" in
  *[!a-zA-Z0-9_./-]*) escaped_driver="\"$escaped_driver\"" ;;
esac
cat > "$tmp" <<EOF
[Unit]
Description=Cua Driver daemon
After=graphical-session.target

[Service]
ExecStart=$escaped_driver serve
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
EOF
if [ -e "$unit" ] && ! cmp -s "$tmp" "$unit"; then
  echo "Existing service differs: $unit. Review it before replacing it." >&2
  exit 1
fi
if [ ! -e "$unit" ]; then
  mv "$tmp" "$unit"
fi
systemctl --user daemon-reload
systemctl --user enable cua-driver.service
autostart=${XDG_CONFIG_HOME:-"$HOME/.config"}/autostart/cua-driver-session.desktop
mkdir -p "$(dirname "$autostart")"
cat > "$tmp" <<'EOF'
[Desktop Entry]
Type=Application
Name=Cua Driver graphical session
Exec=sh -c "systemctl --user import-environment DISPLAY XAUTHORITY WAYLAND_DISPLAY XDG_CURRENT_DESKTOP; systemctl --user restart cua-driver.service"
OnlyShowIn=XFCE;
Terminal=false
EOF
if [ -e "$autostart" ] && ! cmp -s "$tmp" "$autostart"; then
  echo "Existing autostart differs: $autostart. Review it before replacing it." >&2
  exit 1
fi
if [ ! -e "$autostart" ]; then
  install -m 644 "$tmp" "$autostart"
fi
if [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
  systemctl --user import-environment DISPLAY XAUTHORITY WAYLAND_DISPLAY XDG_CURRENT_DESKTOP
fi
systemctl --user restart cua-driver.service
echo "Cua Driver service enabled and restarted. Check: cua-driver status"
