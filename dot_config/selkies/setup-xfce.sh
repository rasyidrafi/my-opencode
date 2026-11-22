#!/bin/sh
set -eu

prefix=${PREFIX:-}
if [ -n "${TERMUX_VERSION:-}" ] || [ "$prefix" != "${prefix#/data/data/com.termux/}" ]; then
  echo 'Selkies XFCE setup is not supported on Android/Termux.' >&2
  exit 1
fi

configure_panel_workarea() {
  config="$HOME/.config/chrome-remote-desktop"
  autostart="$HOME/.config/autostart/crd-panel-workarea.desktop"
  mkdir -p "$(dirname "$autostart")"
  if ! cmp -s "$config/crd-panel-workarea.desktop" "$autostart"; then
    cp "$config/crd-panel-workarea.desktop" "$autostart"
  fi
  if [ -n "${DISPLAY:-}" ] && command -v python3 >/dev/null 2>&1 && command -v xprop >/dev/null 2>&1; then
    # The helper's per-display lock makes repeated launches harmless.
    nohup /usr/bin/python3 "$config/panel-workarea.py" </dev/null >/dev/null 2>&1 &
  else
    echo 'Panel work-area helper enabled for the next XFCE login.'
  fi
}

if [ "$(uname -s)" != Linux ] || ! command -v apt-get >/dev/null 2>&1; then
  echo 'Selkies XFCE setup requires Debian/Ubuntu.' >&2
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

configure_timezone() {
  timezone='Asia/Jakarta'
  if [ "$(timedatectl show -p Timezone --value)" = "$timezone" ]; then
    echo "System timezone is already $timezone."
    return
  fi
  authenticate_sudo
  sudo timedatectl set-timezone "$timezone"
  if [ "$(timedatectl show -p Timezone --value)" != "$timezone" ]; then
    echo "Failed to configure system timezone: $timezone" >&2
    exit 1
  fi
  echo "System timezone configured: $timezone (WIB, UTC+7)."
}

configure_terminal_font() {
  font_missing=''
  for package in fonts-liberation fonts-dejavu-core fonts-dejavu-mono fonts-noto-core fonts-noto-cjk fonts-noto-color-emoji; do
    if [ "$(dpkg-query -W -f='${db:Status-Status}' "$package" 2>/dev/null || :)" != installed ]; then
      font_missing="$font_missing $package"
    fi
  done
  if [ -n "$font_missing" ]; then
    authenticate_sudo
    sudo apt-get update
    sudo apt-get install -y --no-install-recommends --no-upgrade $font_missing
  fi
  /usr/bin/python3 "$HOME/.config/chrome-remote-desktop/setup-terminal-font.py"
}

configure_archive_support() {
  archive_missing=''
  for package in thunar thunar-archive-plugin xarchiver 7zip; do
    if [ "$(dpkg-query -W -f='${db:Status-Status}' "$package" 2>/dev/null || :)" != installed ]; then
      archive_missing="$archive_missing $package"
    fi
  done
  if [ -n "$archive_missing" ]; then
    authenticate_sudo
    sudo apt-get update
    sudo apt-get install -y --no-install-recommends --no-upgrade $archive_missing
    echo 'Thunar archive support installed. Reopen Thunar to load Extract Here and Extract To for .7z files.'
  fi
}

# Apply host defaults even when the remote desktop service is already active.
configure_timezone
configure_archive_support
# Retire only our previous temporary helper. Its old source remains available
# for comparison; do not remove user autostarts.
old_helper="$HOME/.config/chrome-remote-desktop/crd-pwa-window-class.desktop"
old_autostart="$HOME/.config/autostart/crd-pwa-window-class.desktop"
if [ -f "$old_helper" ] && cmp -s "$old_helper" "$old_autostart"; then
  rm "$old_autostart"
fi
if command -v pgrep >/dev/null 2>&1; then
  for pid in $(pgrep -u "$(id -u)" -f '^/usr/bin/python3 .*pwa-window-class[.]py$' || :); do
    [ -r "/proc/$pid/cmdline" ] || continue
    cmd=$(tr '\000' '\n' < "/proc/$pid/cmdline")
    expected=$(printf '/usr/bin/python3\n%s' "$HOME/.config/chrome-remote-desktop/pwa-window-class.py")
    [ "$cmd" != "$expected" ] || kill "$pid" 2>/dev/null || :
  done
fi

missing=''
for package in xfce4 dbus-x11 xfce4-whiskermenu-plugin mint-y-icons bibata-cursor-theme xfce4-terminal xfce4-notifyd xfce4-screenshooter desktop-base python3 x11-utils pipewire wireplumber libasound2-plugins pulseaudio-utils; do
  if [ "$(dpkg-query -W -f='${db:Status-Status}' "$package" 2>/dev/null || :)" != installed ]; then
    missing="$missing $package"
  fi
done
if [ -n "$missing" ]; then
  echo "Installing missing packages (sudo required):$missing"
  authenticate_sudo
  sudo apt-get update
  sudo apt-get install -y --no-install-recommends --no-upgrade $missing
fi

# Enable on every run, independently of the one-time Mint profile marker.
/usr/bin/python3 "$HOME/.config/chrome-remote-desktop/setup-whisker-shortcut.py"
/usr/bin/python3 "$HOME/.config/chrome-remote-desktop/setup-titlebuttons.py"
/usr/bin/python3 "$HOME/.config/chrome-remote-desktop/setup-terminal-helper.py"
configure_panel_workarea

# Seed once, including when a previous XFCE profile exists or setup was interrupted.
sh "$HOME/.config/chrome-remote-desktop/mint-assets.sh"
if [ ! -f "$HOME/.local/state/crd-mint/preset-v1-complete" ]; then
  python3 "$HOME/.config/chrome-remote-desktop/seed-mint.py"
else
  echo 'Mint XFCE preset was already initialized; keeping current settings.'
fi
configure_terminal_font
