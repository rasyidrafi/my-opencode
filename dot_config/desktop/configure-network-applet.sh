#!/bin/sh
# Use Mint's native XApp icon without replacing Debian's NetworkManager packages.
set -eu
. /etc/os-release
[ "$ID:${VERSION_ID:-}:$(dpkg --print-architecture)" = debian:13:amd64 ] || exit 0
stock=/etc/xdg/autostart/nm-applet.desktop
[ -f "$stock" ] && [ -x /usr/bin/nm-applet ] && [ -f /usr/share/xfce4/panel/plugins/xapp-status-plugin.desktop ] || exit 0
dir=${XDG_DATA_HOME:-$HOME/.local/share}/desktop-network-applet
entry=${XDG_CONFIG_HOME:-$HOME/.config}/autostart/nm-applet.desktop
if [ -e "$entry" ] && ! grep -Fxq 'X-Desktop-Setup-Managed=true' "$entry"; then
  echo 'Keeping custom nm-applet autostart.'; exit 0
fi
bin=$dir/nm-applet
if ! printf '%s  %s\n' 573912b3a00c244320336ee3e57b9b16ca6548fb249b8032412c68f3475bd467 "$bin" | sha256sum --status -c - 2>/dev/null; then
  tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
  curl -fLsS --retry 2 --max-time 60 'https://mirrors.edge.kernel.org/linuxmint-packages/pool/upstream/n/network-manager-applet/network-manager-gnome_1.34.0%2Bmint3_amd64.deb' -o "$tmp/app.deb"
  printf '%s  %s\n' fba31282af95845705b68494890af4cb5c90179ffd91bba3c79b67a9a634a97b "$tmp/app.deb" | sha256sum -c -
  dpkg-deb -x "$tmp/app.deb" "$tmp/pkg"
  install -Dm755 "$tmp/pkg/usr/bin/nm-applet" "$bin"
fi
mkdir -p "$(dirname "$entry")"
# Preserve the stock desktop entry, including its non-XFCE behavior.
cat > "$dir/start" <<'SH'
#!/bin/sh
case ":${XDG_CURRENT_DESKTOP:-}:" in
  *:XFCE:*)
    # An orphaned XApp wrapper can keep the status monitor name across logout.
    for pid in $(pgrep -u "$(id -u)" -P 1 -f '^/usr/lib/[^ ]*/xfce4/panel/wrapper-2\.0 [^ ]*/libxapp-status-plugin\.so ' || :); do
      session=$(sed -n 's|.*/session-\([^/]*\)\.scope.*|\1|p' "/proc/$pid/cgroup" 2>/dev/null)
      [ -n "$session" ] || continue
      [ "$(loginctl show-session "$session" -p State --value 2>/dev/null)" = closing ] || continue
      kill -TERM "$pid" 2>/dev/null || :
    done
    exec "$(dirname "$0")/nm-applet" "$@" ;;
  *) exec /usr/bin/nm-applet "$@" ;;
esac
SH
chmod 755 "$dir/start"
while IFS= read -r line; do
  case "$line" in
    Exec=nm-applet) printf 'Exec="%s/start"\nX-Desktop-Setup-Managed=true\n' "$dir" ;;
    *) printf '%s\n' "$line" ;;
  esac
done < "$stock" > "$entry"

# Switch only the stock GUI in this XFCE session, not NetworkManager itself
# or an applet serving a different login of the same user.
case ":${XDG_CURRENT_DESKTOP:-}:" in *:XFCE:*) ;; *) exit 0 ;; esac
[ -n "${DISPLAY:-}" ] && [ -n "${DBUS_SESSION_BUS_ADDRESS:-}" ] || exit 0
for pid in $(pgrep -u "$(id -u)" -x nm-applet || :); do
  applet_display=$(tr '\0' '\n' < "/proc/$pid/environ" | sed -n 's/^DISPLAY=//p')
  [ "${applet_display%.0}" = "${DISPLAY%.0}" ] || continue
  applet_exe=$(readlink "/proc/$pid/exe" || :)
  [ "$applet_exe" != "$bin" ] || exit 0
  [ "$applet_exe" = /usr/bin/nm-applet ] || continue
  kill -TERM "$pid"
  for wait_step in $(seq 1 50); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.1
  done
  if kill -0 "$pid" 2>/dev/null; then echo 'Stock applet still exiting; layout will apply at login.'; exit 0; fi
  break
done
systemd-run --user --quiet --collect \
  --setenv="DISPLAY=$DISPLAY" --setenv="DBUS_SESSION_BUS_ADDRESS=$DBUS_SESSION_BUS_ADDRESS" \
  --setenv="XAUTHORITY=${XAUTHORITY:-$HOME/.Xauthority}" \
  --setenv="XDG_CURRENT_DESKTOP=$XDG_CURRENT_DESKTOP" "$dir/start"
