#!/bin/sh
# No downloads, sudo or user-session changes on unrelated machines.
set -eu
d=/sys/class/dmi/id
[ "$(cat "$d/sys_vendor" 2>/dev/null || :)" = Infinix ] || exit 0
[ "$(awk '{$1=$1;print}' "$d/product_name" 2>/dev/null || :)" = 'Infinix INBOOK X2' ] || exit 0
[ "$(cat "$d/board_name" 2>/dev/null || :)" = 'EM_IC325_200B_V1.0 20211012' ] || exit 0
[ -e /sys/bus/acpi/devices/ESSX8326:00 ] || exit 0
. /etc/os-release
abi=6.12.118+deb13-amd64
if [ "$ID:${VERSION_ID:-}:$(uname -m):$(uname -r)" != "debian:13:x86_64:$abi" ]; then
  echo "Skipping Inbook audio: release requires Debian 13 amd64 with kernel $abi." >&2; exit 0
fi
if [ -d /sys/firmware/efi ]; then
  sb=/sys/firmware/efi/efivars/SecureBoot-8be4df61-93ca-11d2-aa0d-00e098032b8c
  if [ ! -r "$sb" ] || [ "$(od -An -j4 -N1 -tu1 "$sb" | tr -d ' ')" != 0 ]; then
    echo 'Skipping unsigned Inbook module: Secure Boot is enabled or unknown.' >&2; exit 0
  fi
fi
if grep -Eq '\[(integrity|confidentiality)\]' /sys/kernel/security/lockdown 2>/dev/null; then
  echo 'Skipping unsigned Inbook module: kernel lockdown is active.' >&2; exit 0
fi
if [ "$(dpkg-query -W -f='${db:Status-Status}:${Version}' inbook-x2-audio 2>/dev/null || :)" != installed:1.0.0 ]; then
  tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
  file=inbook-x2-audio_1.0.0_amd64.deb
  curl -fLsS --retry 3 "https://github.com/rasyidrafi/inbook-x2-audio/releases/download/v1.0.0/$file" -o "$tmp/$file"
  printf '%s  %s\n' 26e6db282b05f06ac887775a36cdbc90ea09da0f75f2887303117aa142a307c9 "$tmp/$file" | sha256sum -c -
  chmod 755 "$tmp"
  sudo apt-get install -y --no-remove "$tmp/$file"
  echo 'Inbook audio installed. The module activates at the next normal boot.'
fi
if systemctl --user daemon-reload 2>/dev/null; then
  systemctl --user enable --now inbook-audio-login.timer
else
  systemctl --user --no-reload enable inbook-audio-login.timer
fi
