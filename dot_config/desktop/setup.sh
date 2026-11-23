#!/bin/sh
set -eu

prefix=${PREFIX:-}
if [ -n "${TERMUX_VERSION:-}" ] || [ "$prefix" != "${prefix#/data/data/com.termux/}" ]; then
  echo 'Desktop setup is not supported on Android/Termux.' >&2
  exit 1
fi

configure_desktop_scaling() {
  source_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
  config=${XDG_CONFIG_HOME:-$HOME/.config}
  scaler="$config/desktop/scale-desktop.py"
  mkdir -p "$config/autostart" "$config/desktop"
  if ! cmp -s "$source_dir/scale-desktop.py" "$scaler"; then
    install -m 644 "$source_dir/scale-desktop.py" "$scaler"
  fi
  install -m 644 "$source_dir/desktop-scale.desktop" "$config/autostart/desktop-scale.desktop"
  legacy="$config/autostart/selkies-panel-scale.desktop"
  if [ -f "$legacy" ] && grep -Fxq 'Exec=sh -c "exec sh $HOME/.config/selkies/panel-scale.sh"' "$legacy"; then
    rm "$legacy"
  fi
  if [ -n "${DISPLAY:-}" ] && [ -n "${DBUS_SESSION_BUS_ADDRESS:-}" ] &&
    pgrep -u "$(id -u)" -x xfce4-session >/dev/null 2>&1; then
    if [ "$phase" = desktop ] && command -v systemd-run >/dev/null 2>&1 &&
      systemd-run --user --quiet --collect \
        --setenv="DISPLAY=$DISPLAY" --setenv="DBUS_SESSION_BUS_ADDRESS=$DBUS_SESSION_BUS_ADDRESS" \
        --setenv="XDG_CONFIG_HOME=$config" /usr/bin/python3 "$scaler"; then
      return
    fi
    nohup /usr/bin/python3 "$scaler" </dev/null >/dev/null 2>&1 &
  fi
}

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
  echo 'Desktop setup requires Debian/Ubuntu.' >&2
  exit 1
fi
phase=${1:-desktop}
case "$phase:${container:-}:$(id -u)" in
  desktop:*:0|packages:proot-distro:[1-9]*|profile:proot-distro:0)
    echo "Unexpected user for XFCE setup phase: $phase" >&2; exit 1 ;;
  desktop:*:*|packages:proot-distro:0|profile:proot-distro:*) ;;
  *) echo "Unsupported XFCE setup phase: $phase" >&2; exit 1 ;;
esac

as_root() {
  if [ "$phase" = packages ]; then
    "$@"
    return
  fi
  authenticate_sudo
  sudo "$@"
}

authenticate_sudo() {
  if ! sudo -n /usr/bin/true >/dev/null 2>&1; then
    echo 'Administrator access is needed; sudo may ask for your password.'
    sudo -v
  fi
}

configure_timezone() {
  timezone='Asia/Jakarta'
  if [ "$phase" = packages ]; then
    ln -snf "/usr/share/zoneinfo/$timezone" /etc/localtime
    printf "%s\n" "$timezone" > /etc/timezone
    return
  fi
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

install_terminal_fonts() {
  font_missing=''
  for package in fonts-liberation fonts-dejavu-core fonts-dejavu-mono fonts-noto-core fonts-noto-cjk fonts-noto-color-emoji; do
    if [ "$(dpkg-query -W -f='${db:Status-Status}' "$package" 2>/dev/null || :)" != installed ]; then
      font_missing="$font_missing $package"
    fi
  done
  if [ -n "$font_missing" ]; then
    as_root apt-get update
    as_root apt-get install -y --no-install-recommends --no-upgrade $font_missing
  fi
}

configure_archive_support() {
  archive_missing=''
  for package in thunar thunar-archive-plugin xarchiver 7zip; do
    if [ "$(dpkg-query -W -f='${db:Status-Status}' "$package" 2>/dev/null || :)" != installed ]; then
      archive_missing="$archive_missing $package"
    fi
  done
  if [ -n "$archive_missing" ]; then
    as_root apt-get update
    as_root apt-get install -y --no-install-recommends --no-upgrade $archive_missing
    echo 'Thunar archive support installed. Reopen Thunar to load Extract Here and Extract To for .7z files.'
  fi
}

install_desktop_packages() {
  missing=''
  for package in xfce4 dbus-x11 xfce4-whiskermenu-plugin mint-y-icons bibata-cursor-theme xfce4-terminal xfce4-notifyd xfce4-screenshooter desktop-base python3 x11-utils pipewire wireplumber libasound2-plugins pulseaudio-utils; do
    if [ "$(dpkg-query -W -f='${db:Status-Status}' "$package" 2>/dev/null || :)" != installed ]; then
      missing="$missing $package"
    fi
  done
  if [ -n "$missing" ]; then
    echo "Installing missing desktop packages:$missing"
    as_root apt-get update
    as_root apt-get install -y --no-install-recommends --no-upgrade $missing
  fi
}

configure_touchpad() {
  touchpad_config='Section "InputClass"
    Identifier "Desktop touchpad defaults"
    MatchIsTouchpad "on"
    MatchDriver "libinput"
    Option "Tapping" "on"
    Option "NaturalScrolling" "on"
EndSection'
  target=/etc/X11/xorg.conf.d/90-desktop-touchpad.conf
  if ! printf '%s\n' "$touchpad_config" | cmp -s "$target" -; then
    as_root mkdir -p "$(dirname "$target")"
    printf '%s\n' "$touchpad_config" | as_root tee "$target" >/dev/null
  fi

  # Also apply the Xorg default to any touchpads in the running X11 session.
  if [ -z "${DISPLAY:-}" ] || [ "${XDG_SESSION_TYPE:-}" = wayland ]; then
    return
  fi
  if ! command -v xinput >/dev/null 2>&1; then
    as_root apt-get update
    as_root apt-get install -y --no-install-recommends xinput
  fi
  if devices=$(xinput list --id-only 2>/dev/null); then
    for device in $devices; do
      properties=$(xinput list-props "$device" 2>/dev/null) || continue
      if printf '%s\n' "$properties" | grep -q 'libinput Tapping Enabled ('; then
        xinput set-prop "$device" 'libinput Tapping Enabled' 1
        echo 'Enabled tap-to-click on the current X11 touchpad.'
        if printf '%s\n' "$properties" | grep -q 'libinput Natural Scrolling Enabled ('; then
          xinput set-prop "$device" 'libinput Natural Scrolling Enabled' 1
          echo 'Enabled natural two-finger scrolling on the current X11 touchpad.'
        fi
      fi
    done
  fi
}

configure_local_login() {
  # A server can have a graphical seat and GPU without a connected screen.
  if [ "$(loginctl show-seat seat0 -p CanGraphical --value 2>/dev/null)" != yes ] ||
    ! grep -qsx connected /sys/class/drm/card*-*/status; then
    echo 'No connected display on the graphical seat. Skipping local login setup.'
    return
  fi

  if [ ! -r /usr/share/xsessions/xfce.desktop ]; then
    echo 'The XFCE login session is missing after package installation.' >&2
    exit 1
  fi
  configure_touchpad
  if systemctl cat display-manager.service >/dev/null 2>&1; then
    echo 'XFCE is available in the existing display manager.'
    return
  fi

  as_root apt-get update
  as_root apt-get install -y --no-install-recommends xserver-xorg lightdm lightdm-gtk-greeter
  as_root systemctl enable lightdm.service
  echo 'XFCE is available through LightDM at the next graphical boot.'
}

if [ "$phase" != packages ] && [ ! -f "$HOME/.local/state/crd-mint/preset-v1-complete" ] &&
  pgrep -u "$(id -u)" -x xfce4-session >/dev/null 2>&1; then
  echo 'Log out of the running XFCE session before initializing the desktop preset.' >&2
  exit 1
fi

if [ "$phase" = profile ]; then
  # PRoot lacks the shared-memory permissions used by PulseAudio clients.
  pulse="$HOME/.config/pulse/daemon.conf.d"
  mkdir -p "$pulse"
  printf '%s\n' 'enable-shm = no' > "$pulse/90-desktop-proot.conf"
  legacy="$pulse/90-selkies-proot.conf"
  if printf '%s\n' 'enable-shm = no' | cmp -s "$legacy" -; then
    rm "$legacy"
  fi
else
  configure_timezone
  configure_archive_support
fi
if [ "$phase" = packages ]; then
  install_desktop_packages
  install_terminal_fonts
  exit 0
fi

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

if [ "$phase" = desktop ]; then
  install_desktop_packages
fi

# Enable on every run, independently of the one-time Mint profile marker.
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
# Apply the shortcut after seeding so the initial preset cannot overwrite it.
/usr/bin/python3 "$HOME/.config/chrome-remote-desktop/setup-whisker-shortcut.py"
if [ "$phase" = desktop ]; then
  install_terminal_fonts
fi
/usr/bin/python3 "$HOME/.config/chrome-remote-desktop/setup-terminal-font.py"
configure_desktop_scaling

if [ "$phase" = desktop ]; then
  configure_local_login
fi
