#!/bin/sh
set -eu

unit=t3code.service
default_unit="$HOME/.config/systemd/user/$unit"
config_unit="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/$unit"

load_state=$(systemctl --user show --property=LoadState --value "$unit")
active_state=$(systemctl --user show --property=ActiveState --value "$unit")
if [ "$load_state" != not-found ] || [ "$active_state" != inactive ]; then
  systemctl --user stop "$unit"
fi

if [ -e "$default_unit" ] || [ -L "$default_unit" ] ||
   [ -e "$config_unit" ] || [ -L "$config_unit" ]; then
  systemctl --user disable "$unit"
fi

rm -f -- "$default_unit" "$config_unit"
rm -rf -- "$default_unit.d" "$config_unit.d"
systemctl --user daemon-reload

if command -v tailscale >/dev/null 2>&1; then
  serve_config=$(tailscale serve status --json)
  t3_route=$(printf '%s\n' "$serve_config" | node -e '
    const config = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
    const routes = Object.entries(config.Web ?? {}).filter(([host, route]) =>
      host.endsWith(":443") && route.Handlers?.["/"]?.Proxy === "http://127.0.0.1:3773"
    );
    if (config.TCP?.["443"]?.HTTPS && routes.length === 1) {
      process.stdout.write(config.AllowFunnel?.[routes[0][0]] ? "funnel" : "serve");
    }
  ')
  if [ -n "$t3_route" ]; then
    tailscale "$t3_route" --bg --https=443 --set-path=/ off
    echo 'T3 Code Tailscale route removed.'
  fi
fi

echo 'T3 Code user service removed.'
