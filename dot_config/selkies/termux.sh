#!/bin/sh
set -eu

case "${TERMUX_VERSION:-}:${PREFIX:-}:$(uname -o 2>/dev/null)" in
  ?*:*:*|*:/data/data/com.termux/*:*|*:*:Android) ;;
  *) echo 'This Selkies setup requires Android/Termux.' >&2; exit 1 ;;
esac

dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
guest=my-opencode-xfce
user=desktop
url=http://127.0.0.1:8443

guest_login() {
  proot-distro login --isolated --bind "$dir:/mnt/selkies" \
    --bind "$dir/../desktop:/mnt/desktop-setup" "$@"
}

guest_exists() {
  command -v proot-distro >/dev/null && proot-distro list --quiet |
    grep -Fxq "$guest"
}

selkies_ready() {
  [ "$(curl -fsS --max-time 2 -o /dev/null -w '%{http_code}' "$url/api/websockets" 2>/dev/null)" = 204 ] &&
    curl -fsSI --max-time 2 "$url/selkies-core.js" 2>/dev/null |
    grep -qi '^content-type: .*javascript'
}

if ! guest_exists || ! guest_login --user "$user" "$guest" -- sh -c '
  test -f "$HOME/.local/state/crd-mint/preset-v1-complete"
'; then
  echo 'Run mise run termux:xfce:setup first.' >&2
  exit 1
fi
guest_login --user "$user" "$guest" -- sh /mnt/desktop-setup/setup.sh profile
guest_login "$guest" -- env DEBIAN_FRONTEND=noninteractive sh /mnt/selkies/setup.sh packages
guest_login --user "$user" "$guest" -- sh -ec '
  mkdir -p "$HOME/.config/selkies"
  install -m 644 /mnt/selkies/prepare-web.py "$HOME/.config/selkies/"
  /opt/selkies/bin/python "$HOME/.config/selkies/prepare-web.py"
'
if ! selkies_ready; then
  proot-distro login --isolated --user "$user" --detach "$guest" -- sh -ec '
    state="$HOME/.local/state/selkies-desktop"
    mkdir -p "$state"
    exec >>"$state/session.log" 2>&1
    unset PULSE_SERVER
    exec selkies session --session=xfce --addr=127.0.0.1 --port=8443 --enable-basic-auth=false --enable-https=false --web-root="$HOME/.local/share/selkies-desktop/web/current"
  '
  attempts=0
  until selkies_ready; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge 30 ]; then
      guest_login --user "$user" "$guest" -- sh -c '
        tail -n 40 "$HOME/.local/state/selkies-desktop/session.log"
      ' >&2 || :
      echo "Selkies did not become ready at $url." >&2
      exit 1
    fi
    sleep 1
  done
fi
echo "Selkies: $url (localhost only, no login)"
