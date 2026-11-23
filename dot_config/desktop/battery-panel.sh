#!/bin/sh
set -eu

has_battery_plugin() {
  xfconf-query -c xfce4-panel -lv |
    grep -Eq '^/plugins/plugin-[0-9]+[[:space:]]+power-manager-plugin$'
}

configure_status_area() {
  channel=xfce4-panel
  order_changed=false
  for property in $(xfconf-query -c "$channel" -l | grep -E '^/panels/panel-[0-9]+/plugin-ids$'); do
    current=$(xfconf-query -c "$channel" -p "$property" | tail -n +3)
    notifications= tray= xapp= battery= volume= clock=
    set --
    for id in $current; do
      case $(xfconf-query -c "$channel" -p "/plugins/plugin-$id") in
        notification-plugin) notifications="$notifications $id" ;;
        systray) tray="$tray $id" ;;
        xapp-status-plugin) xapp="$xapp $id" ;;
        power-manager-plugin) battery="$battery $id" ;;
        pulseaudio) volume="$volume $id" ;;
        clock) clock="$clock $id" ;;
        *) set -- "$@" "$id" ;;
      esac
    done
    for id in $clock; do
      xfconf-query -c "$channel" -p "/plugins/plugin-$id/digital-layout" -n -t uint -s 1
    done
    set -- "$@" $tray $notifications $xapp $battery $volume $clock
    if [ "$(printf '%s\n' "$@")" != "$current" ]; then
      ids="$*"
      set --
      for id in $ids; do
        set -- "$@" -t int -s "$id"
      done
      xfconf-query -c "$channel" -p "$property" -a "$@"
      order_changed=true
    fi
  done
  if [ "$(xfconf-query -c xfce4-power-manager -p /xfce4-power-manager/show-panel-label 2>/dev/null || :)" != 0 ]; then
    xfconf-query -c xfce4-power-manager -p /xfce4-power-manager/show-panel-label -n -t int -s 0
  fi
  # A running panel reads the new plugin order on restart.
  if [ "$order_changed" = true ]; then
    xfce4-panel --restart
  fi
}

# At login, wait briefly for XFCE to start the panel.
restarted=false
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if pgrep -u "$(id -u)" -x xfce4-panel >/dev/null 2>&1; then
    if [ -f /usr/share/xfce4/panel/plugins/xapp-status-plugin.desktop ] &&
      ! xfconf-query -c xfce4-panel -lv | grep -Eq '^/plugins/plugin-[0-9]+[[:space:]]+xapp-status-plugin$'; then
      xfce4-panel --add=xapp-status-plugin
      sleep 1
    fi
    if [ -f /usr/share/xfce4/panel/plugins/power-manager-plugin.desktop ] && ! has_battery_plugin; then
      xfce4-panel --add=power-manager-plugin
      sleep 1
      if ! has_battery_plugin; then
        if [ "$restarted" = true ]; then
          exit 1
        fi
        # A running panel can cache the plugin list from before installation.
        xfce4-panel --restart
        restarted=true
        sleep 1
        continue
      fi
    fi
    configure_status_area
    # Starts the daemon if the package's own autostart has not run yet.
    if ! pgrep -u "$(id -u)" -f '^(/usr/bin/)?xfce4-power-manager( |$)' >/dev/null 2>&1; then
      xfce4-power-manager --daemon
    fi
    config=${XDG_CONFIG_HOME:-$HOME/.config}
    if [ -f "$config/autostart/desktop-battery.desktop" ]; then
      rm "$config/autostart/desktop-battery.desktop"
    fi
    exit 0
  fi
  sleep 1
done
exit 1
