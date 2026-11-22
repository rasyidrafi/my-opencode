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
url=http://127.0.0.1:8443

guest_login() {
  proot-distro login --isolated --bind "$dir:/mnt/selkies" \
    --bind "$desktop:/mnt/desktop" "$@"
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

case "${1:-}" in
  xfce)
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
      sh /mnt/selkies/setup-xfce.sh packages
    '
    guest_login --user "$user" --env "CRD_MINT_THEME=${CRD_MINT_THEME:-dark}" "$guest" -- sh -ec '
      config="$HOME/.config/chrome-remote-desktop"
      mkdir -p "$config"
      cd /mnt/desktop
      cp -R mint-preset "$config/"
      install -m 644 crd-panel-workarea.desktop mint-assets.sh panel-workarea.py \
        pwa-titlebuttons.css seed-mint.py setup-terminal-font.py setup-terminal-helper.py \
        setup-titlebuttons.py setup-whisker-shortcut.py "$config/"
      sh /mnt/selkies/setup-xfce.sh profile
    '
    echo "Debian XFCE is ready. Run mise run selkies:setup to open it in a browser."
    ;;
  selkies)
    if ! guest_exists || ! guest_login --user "$user" "$guest" -- sh -c '
      test -f "$HOME/.local/state/crd-mint/preset-v1-complete"
    '; then
      echo 'Run mise run termux:xfce:setup first.' >&2
      exit 1
    fi
    guest_login "$guest" -- env DEBIAN_FRONTEND=noninteractive sh /mnt/selkies/setup.sh packages
    guest_login --user "$user" "$guest" -- sh -ec '
      mkdir -p "$HOME/.config/autostart" "$HOME/.config/selkies" "$HOME/.config/pulse/daemon.conf.d"
      # PulseAudio uses the session socket without Android shared-memory permissions.
      printf "%s\n" "enable-shm = no" > "$HOME/.config/pulse/daemon.conf.d/90-selkies-proot.conf"
      install -m 644 /mnt/selkies/selkies-panel-scale.desktop "$HOME/.config/autostart/"
      install -m 644 /mnt/selkies/panel-scale.sh /mnt/selkies/scale-desktop.py /mnt/selkies/prepare-web.py "$HOME/.config/selkies/"
      /opt/selkies/bin/python "$HOME/.config/selkies/prepare-web.py"
    '
    if ! selkies_ready; then
      proot-distro login --isolated --user "$user" --detach "$guest" -- sh -ec '
        state="$HOME/.local/state/selkies-desktop"
        mkdir -p "$state"
        exec >>"$state/session.log" 2>&1
        export SELKIES_SCALE_XFCE_PANEL=1
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
    ;;
  *) echo 'Usage: termux.sh xfce|selkies' >&2; exit 1 ;;
esac
