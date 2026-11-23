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
  authenticate_sudo || return
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
  for package in xfce4 dbus-x11 xfce4-whiskermenu-plugin mint-y-icons bibata-cursor-theme xfce4-terminal xfce4-notifyd xfce4-screenshooter xfce4-screensaver desktop-base python3 x11-utils pipewire wireplumber libasound2-plugins pulseaudio-utils pavucontrol xfce4-power-manager xfce4-power-manager-plugins upower; do
    if [ "$(dpkg-query -W -f='${db:Status-Status}' "$package" 2>/dev/null || :)" != installed ]; then
      missing="$missing $package"
    fi
  done
  if [ -n "$missing" ]; then
    echo "Installing missing desktop packages:$missing"
    as_root apt-get update
    as_root apt-get install -y --no-install-recommends --no-upgrade $missing
  fi
  # Respect an existing PulseAudio server instead of replacing it.
  if [ "$(dpkg-query -W -f='${db:Status-Status}' pipewire-pulse 2>/dev/null || :)" != installed ] &&
    [ "$(dpkg-query -W -f='${db:Status-Status}' pulseaudio 2>/dev/null || :)" != installed ]; then
    as_root apt-get update
    as_root apt-get install -y --no-install-recommends --no-upgrade pipewire-pulse
  fi
}

install_xapp_plugin() {
  if [ "$(dpkg-query -W -f='${db:Status-Status}' xfce4-xapp-status-plugin 2>/dev/null || :)" != installed ]; then
    if apt-cache show xfce4-xapp-status-plugin >/dev/null 2>&1; then
      as_root apt-get update
      as_root apt-get install -y --no-install-recommends xfce4-xapp-status-plugin
    else
      # The official Mint 22.3 package is published for amd64 only.
      if [ "$(dpkg --print-architecture)" != amd64 ]; then
        echo 'XApp panel plugin unavailable for this architecture; using XFCE Status Tray.'
        return 0
      fi
      . /etc/os-release
      case "$ID:$VERSION_ID" in
        debian:13|ubuntu:24.04) package='xfce4-xapp-status-plugin_0.3.6+wilma_amd64.deb'; hash=73fff87581f22a9897e5bfa03b23a0aaa58384ee9427afcd6b7e9ebc7fa81d21 ;;
        *) echo 'XApp panel plugin unavailable for this distribution; using XFCE Status Tray.'; return 0 ;;
      esac
      tmp=$(mktemp -d)
      if ! curl -fsSL "https://mirrors.edge.kernel.org/linuxmint-packages/pool/backport/x/xfce4-xapp-status-plugin/$package" -o "$tmp/xapp.deb" ||
        ! printf '%s  %s\n' "$hash" "$tmp/xapp.deb" | sha256sum -c -; then
        rm -f "$tmp/xapp.deb"; rmdir "$tmp"
        echo 'Could not download verified XApp panel plugin.' >&2
        return 1
      fi
      if ! as_root apt-get update || ! as_root apt-get install -y --no-install-recommends "$tmp/xapp.deb"; then
        rm -f "$tmp/xapp.deb"; rmdir "$tmp"; return 1
      fi
      rm -f "$tmp/xapp.deb"; rmdir "$tmp"
    fi
  fi
  if [ "$(dpkg-query -W -f='${db:Status-Status}' xapp-sn-watcher 2>/dev/null || :)" != installed ] && apt-cache show xapp-sn-watcher >/dev/null 2>&1; then
    as_root apt-get update
    as_root apt-get install -y --no-install-recommends xapp-sn-watcher
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

configure_wifi_panel() {
  # The Mint panel preset already includes a Status Tray for nm-applet.
  # Only install a network manager on local desktops with Wi-Fi hardware.
  set -- /sys/class/ieee80211/phy*
  if [ ! -e "$1" ]; then
    return
  fi
  wifi_missing=''
  for package in network-manager network-manager-gnome polkitd; do
    if [ "$(dpkg-query -W -f='${db:Status-Status}' "$package" 2>/dev/null || :)" != installed ]; then
      wifi_missing="$wifi_missing $package"
    fi
  done
  if [ -n "$wifi_missing" ]; then
    as_root apt-get update
    as_root apt-get install -y --no-install-recommends --no-upgrade $wifi_missing
  fi
  if [ -n "${DISPLAY:-}" ] && [ -n "${DBUS_SESSION_BUS_ADDRESS:-}" ] &&
    pgrep -u "$(id -u)" -x xfce4-session >/dev/null 2>&1 &&
    ! pgrep -u "$(id -u)" -x nm-applet >/dev/null 2>&1; then
    # The package's XDG autostart starts the applet at subsequent logins.
    if ! systemd-run --user --quiet --collect --unit=desktop-nm-applet \
      --setenv="DISPLAY=$DISPLAY" --setenv="DBUS_SESSION_BUS_ADDRESS=$DBUS_SESSION_BUS_ADDRESS" \
      --setenv="XAUTHORITY=${XAUTHORITY:-$HOME/.Xauthority}" /usr/bin/nm-applet; then
      nohup /usr/bin/nm-applet </dev/null >/dev/null 2>&1 &
    fi
  fi
}

configure_desktop_dns() {
  command -v nmcli >/dev/null 2>&1 || return 0
  device=$(ip -o -4 route get 1.1.1.1 2>/dev/null |
    awk 'NR == 1 { for (i = 1; i < NF; i++) if ($i == "dev") { print $(i+1); exit } }')
  [ -n "$device" ] || return 0
  case $(nmcli -g GENERAL.TYPE device show "$device" 2>/dev/null) in
    wifi|ethernet) ;;
    *) return 0 ;;
  esac
  profile=$(nmcli -g GENERAL.CON-UUID device show "$device" 2>/dev/null) || return 0
  [ -n "$profile" ] && [ "$profile" != -- ] || return 0

  old_dns=$(nmcli -g ipv4.dns connection show uuid "$profile") || return 0
  old_auto4=$(nmcli -g ipv4.ignore-auto-dns connection show uuid "$profile") || return 0
  old_auto6=$(nmcli -g ipv6.ignore-auto-dns connection show uuid "$profile") || return 0
  if [ "$old_dns" = 1.1.1.1 ] && [ "$old_auto4" = yes ] && [ "$old_auto6" = yes ]; then
    return 0
  fi

  as_root nmcli connection modify uuid "$profile" \
    ipv4.dns 1.1.1.1 ipv4.ignore-auto-dns yes ipv6.ignore-auto-dns yes || return 1
  if as_root nmcli device reapply "$device"; then
    for attempt in 1 2 3 4 5; do
      if nmcli -g IP4.DNS device show "$device" | grep -Fxq 1.1.1.1 &&
        timeout 3 getent ahostsv4 cloudflare.com >/dev/null; then
        return 0
      fi
      sleep 1
    done
  fi

  echo "DNS validation failed on $device. Restoring the previous DNS settings." >&2
  as_root nmcli connection modify uuid "$profile" \
    ipv4.dns "$old_dns" ipv4.ignore-auto-dns "$old_auto4" ipv6.ignore-auto-dns "$old_auto6" &&
    as_root nmcli device reapply "$device"
}

configure_battery_panel() {
  set -- /sys/class/backlight/*
  if [ "$phase" = desktop ] && [ -e "$1" ] &&
    [ "$(dpkg-query -W -f='${db:Status-Status}' pkexec 2>/dev/null || :)" != installed ]; then
    as_root apt-get update
    as_root apt-get install -y --no-install-recommends --no-upgrade pkexec
  fi
  source_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
  config=${XDG_CONFIG_HOME:-$HOME/.config}
  mkdir -p "$config/autostart" "$config/desktop"
  if ! cmp -s "$source_dir/battery-panel.sh" "$config/desktop/battery-panel.sh"; then
    install -m 644 "$source_dir/battery-panel.sh" "$config/desktop/battery-panel.sh"
  fi
  if [ -n "${DISPLAY:-}" ] && [ -n "${DBUS_SESSION_BUS_ADDRESS:-}" ] &&
    pgrep -u "$(id -u)" -x xfce4-panel >/dev/null 2>&1; then
    sh "$config/desktop/battery-panel.sh"
  else
    install -m 644 "$source_dir/desktop-battery.desktop" "$config/autostart/desktop-battery.desktop"
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
  if [ ! -x /usr/lib/policykit-1-gnome/polkit-gnome-authentication-agent-1 ] &&
    [ ! -x /usr/lib/mate-polkit/polkit-mate-authentication-agent-1 ] &&
    [ ! -x /usr/libexec/polkit-mate-authentication-agent-1 ] &&
    [ ! -x /usr/libexec/polkit-gnome-authentication-agent-1 ] &&
    [ "$(dpkg-query -W -f='${db:Status-Status}' mate-polkit 2>/dev/null || :)" != installed ]; then
    as_root apt-get update
    as_root apt-get install -y --no-install-recommends --no-upgrade mate-polkit
  fi
  configure_touchpad
  configure_wifi_panel
  configure_desktop_dns
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
  install_xapp_plugin
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
  install_xapp_plugin
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
# Apply the shortcuts after seeding so the initial preset cannot overwrite them.
/usr/bin/python3 "$HOME/.config/chrome-remote-desktop/setup-whisker-shortcut.py"
/usr/bin/python3 "$HOME/.config/chrome-remote-desktop/setup-whisker-shortcut.py" --screenshot
if [ "$phase" = desktop ]; then
  install_terminal_fonts
fi
/usr/bin/python3 "$HOME/.config/chrome-remote-desktop/setup-terminal-font.py"
configure_desktop_scaling
configure_battery_panel

if [ "$phase" = desktop ]; then
  configure_local_login
fi
