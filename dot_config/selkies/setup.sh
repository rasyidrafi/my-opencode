#!/bin/sh
set -eu

. /etc/os-release
case "$ID:$VERSION_ID" in
  debian:12|debian:13) distro=debian$VERSION_CODENAME ;;
  ubuntu:24.04|ubuntu:26.04) distro=ubuntu$VERSION_ID ;;
  *) echo 'Requires Debian 12/13 or Ubuntu 24.04/26.04.' >&2; exit 1 ;;
esac
arch=$(dpkg --print-architecture)
case "$arch" in amd64|arm64) ;; *) echo "Unsupported architecture: $arch" >&2; exit 1 ;; esac
systemctl --user show-environment >/dev/null

dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
if ! command -v selkies >/dev/null; then
  version=2.2.1
  pkg="selkies-$version-$distro-$arch.deb"
  tmp=$(mktemp -d)
  trap 'rm -f "$tmp/$pkg"; rmdir "$tmp"' EXIT
  curl -fLsS "https://github.com/selkies-project/selkies/releases/download/$version/$pkg" -o "$tmp/$pkg"
  (cd "$tmp" && sha256sum --check --ignore-missing "$dir/SHA256SUMS")
  sudo apt-get install -y --no-install-recommends "$tmp/$pkg"
fi

if [ ! -f "$HOME/.local/state/crd-mint/preset-v1-complete" ] && systemctl --user is-active --quiet selkies-desktop.service; then
  echo 'Save your work, stop the existing desktop with systemctl --user stop selkies-desktop.service, then rerun setup to initialize the XFCE preset.' >&2
  exit 1
fi
sh "$dir/setup-xfce.sh"

autostart=${XDG_CONFIG_HOME:-$HOME/.config}/autostart
mkdir -p "$autostart"
install -m 644 "$dir/selkies-panel-scale.desktop" "$autostart/selkies-panel-scale.desktop"

units=${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user
mkdir -p "$units"
if ! cmp -s "$dir/selkies-desktop.service" "$units/selkies-desktop.service"; then
  install -m 644 "$dir/selkies-desktop.service" "$units/selkies-desktop.service"
  systemctl --user daemon-reload
  systemctl --user try-restart selkies-desktop.service
fi
systemctl --user enable --now selkies-desktop.service
echo 'Selkies: http://127.0.0.1:8443 (localhost only, no login)'
