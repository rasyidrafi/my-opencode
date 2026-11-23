#!/bin/sh
set -eu

case "${TERMUX_VERSION:-}:${PREFIX:-}:$(uname -o 2>/dev/null)" in
  ?*:*:*|*:/data/data/com.termux/*:*|*:*:Android) ;;
  *) echo 'termux:xfce:setup requires Android/Termux.' >&2; exit 1 ;;
esac

dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
desktop=$(CDPATH='' cd -- "$dir/../chrome-remote-desktop" && pwd)
guest=my-opencode-xfce
user=desktop
guest_login() {
  proot-distro login --isolated --bind "$dir:/mnt/desktop-setup" \
    --bind "$desktop:/mnt/desktop" "$@"
}

guest_exists() {
  command -v proot-distro >/dev/null && proot-distro list --quiet |
    grep -Fxq "$guest"
}

case "$(uname -m)" in
  aarch64|x86_64) ;;
  *) echo 'XFCE setup requires an ARM64 or x86-64 Termux installation.' >&2; exit 1 ;;
esac
if ! command -v proot-distro >/dev/null; then
  pkg install -y proot-distro
fi
if ! guest_exists; then
  proot-distro install --name "$guest" debian:13
fi
guest_login "$guest" -- env DEBIAN_FRONTEND=noninteractive sh -ec '
  . /etc/os-release
  if [ "$ID:$VERSION_ID" != debian:13 ]; then
    echo "Expected Debian 13 in $PD_CONTAINER, found $ID:$VERSION_ID." >&2
    exit 1
  fi
  if ! command -v curl >/dev/null || [ ! -e /usr/share/zoneinfo/Asia/Jakarta ]; then
    apt-get update
    apt-get install -y --no-install-recommends ca-certificates curl tzdata
  fi
  # The Debian OCI image uses HTTP mirrors. Use TLS for subsequent downloads.
  sources=/etc/apt/sources.list.d/debian.sources
  if [ -f "$sources" ] && grep -q http://deb.debian.org/ "$sources"; then
    sed -i "s|http://deb.debian.org/|https://deb.debian.org/|g" "$sources"
  fi
  id desktop >/dev/null 2>&1 || useradd -m -s /bin/bash desktop
  if ! command -v Xvfb >/dev/null || ! command -v xauth >/dev/null || ! command -v pulseaudio >/dev/null; then
    apt-get update
    apt-get install -y --no-install-recommends xvfb xauth pulseaudio
  fi
  sh /mnt/desktop-setup/setup.sh packages
'
guest_login --user "$user" --env "CRD_MINT_THEME=${CRD_MINT_THEME:-dark}" "$guest" -- sh -ec '
  config="$HOME/.config/chrome-remote-desktop"
  mkdir -p "$config"
  cd /mnt/desktop
  cp -R mint-preset "$config/"
  install -m 644 crd-panel-workarea.desktop mint-assets.sh panel-workarea.py \
    pwa-titlebuttons.css seed-mint.py setup-terminal-font.py setup-terminal-helper.py \
    setup-titlebuttons.py setup-whisker-shortcut.py "$config/"
  sh /mnt/desktop-setup/setup.sh profile
'
echo "Debian XFCE is ready. Run mise run selkies:setup to open it in a browser."
