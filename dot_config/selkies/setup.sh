#!/bin/sh
set -eu
dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
case "${TERMUX_VERSION:-}:${PREFIX:-}:$(uname -o 2>/dev/null)" in
  ?*:*:*|*:/data/data/com.termux/*:*|*:*:Android)
    exec sh "$dir/termux.sh" ;;
esac

. /etc/os-release
case "$ID:$VERSION_ID" in
  debian:12|debian:13) distro=debian$VERSION_CODENAME ;;
  ubuntu:24.04|ubuntu:26.04) distro=ubuntu$VERSION_ID ;;
  *) echo 'Requires Debian 12/13 or Ubuntu 24.04/26.04.' >&2; exit 1 ;;
esac
arch=$(dpkg --print-architecture)
case "$arch" in amd64|arm64) ;; *) echo "Unsupported architecture: $arch" >&2; exit 1 ;; esac
guest=false
case "${1:-}" in
  '') systemctl --user show-environment >/dev/null ;;
  packages)
    [ "${container:-}" = proot-distro ] && [ "$(id -u)" -eq 0 ] || exit 1
    install -d -m 1777 /tmp/.X11-unix
    guest=true ;;
  *) exit 1 ;;
esac
if [ "$guest" = false ]; then
  if [ ! -f "$HOME/.local/state/crd-mint/preset-v1-complete" ] && systemctl --user is-active --quiet selkies-desktop.service; then
    echo 'Save your work, stop the existing desktop with systemctl --user stop selkies-desktop.service, then rerun setup to initialize the XFCE preset.' >&2
    exit 1
  fi
  sh "$dir/../desktop/setup.sh"
fi

if ! command -v selkies >/dev/null; then
  version=2.2.1
  pkg="selkies-$version-$distro-$arch.deb"
  if [ "$guest" = true ]; then
    tmp=/var/cache/selkies-desktop
    mkdir -p "$tmp"
  else
    tmp=$(mktemp -d)
    trap 'rm -f "$tmp/$pkg"; rmdir "$tmp"' EXIT
  fi
  verify_package() {
    awk -v pkg="$pkg" '$2 == pkg { print }' "$dir/SHA256SUMS" |
      (cd "$tmp" && sha256sum --check --strict -)
  }
  if ! verify_package >/dev/null 2>&1; then
    rm -f "$tmp/$pkg"
    curl -fLsS --retry 3 "https://github.com/selkies-project/selkies/releases/download/$version/$pkg" -o "$tmp/$pkg"
    verify_package
  fi
  if [ "$guest" = true ]; then
    apt-get update
    apt-get install -y --no-install-recommends "$tmp/$pkg"
  else
    sudo apt-get install -y --no-install-recommends "$tmp/$pkg"
  fi
fi

[ "$guest" = false ] || exit 0

units=${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user
mkdir -p "$units"
if ! cmp -s "$dir/selkies-desktop.service" "$units/selkies-desktop.service"; then
  install -m 644 "$dir/selkies-desktop.service" "$units/selkies-desktop.service"
  systemctl --user daemon-reload
  systemctl --user try-restart selkies-desktop.service
fi
systemctl --user enable --now selkies-desktop.service
echo 'Selkies: http://127.0.0.1:8443 (localhost only, no login)'
