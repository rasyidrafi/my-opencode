#!/bin/sh
set -eu

prefix=${PREFIX:-}
if [ -n "${TERMUX_VERSION:-}" ] || [ "$prefix" != "${prefix#/data/data/com.termux/}" ]; then
  echo 'cua:startup is not supported on Android/Termux.' >&2
  exit 1
fi
if [ "$(uname -s)" != Linux ]; then
  echo 'cua:startup requires Linux with systemd.' >&2
  exit 1
fi
if ! command -v cua-driver >/dev/null 2>&1; then
  echo "cua-driver is not installed or not on PATH. Install it first: https://cua.ai/docs/cua-driver" >&2
  exit 1
fi
if ! command -v systemctl >/dev/null 2>&1 || ! systemctl --user show-environment >/dev/null 2>&1; then
  echo "A running systemd user manager is required." >&2
  exit 1
fi

driver=$(command -v cua-driver)
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
systemctl --user restart cua-driver.service
echo "Cua Driver service enabled and restarted. Check: cua-driver status"
