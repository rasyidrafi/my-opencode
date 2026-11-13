#!/bin/sh
set -eu
command -v mise >/dev/null 2>&1 || { echo 'mise is required. Run mise install first.' >&2; exit 1; }
t3=$(mise -C "$HOME" which t3) || { echo 'T3 CLI is not selected in Mise. Install/configure it separately, then retry.' >&2; exit 1; }
# Preserve CLI help and subcommands without changing service configuration.
if [ "$#" -gt 0 ]; then exec "$t3" connect "$@"; fi
if "$t3" status --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",x=>s+=x).on("end",()=>{try {let v=JSON.parse(s);process.exit(v.connect?.enabled && !v.connect?.revoked && v.service?.installed ? 0 : 1)}catch{process.exit(1)}})' && systemctl --user is-active --quiet t3code.service; then
  echo 'T3 Connect and its service are already enabled.'
else
  "$t3" connect
fi
unit=$(systemctl --user show t3code.service -p FragmentPath --value)
[ -f "$unit" ] || { echo 'T3 service unit not found; cannot configure secret loading.' >&2; exit 1; }
command_line=$(sed -n 's/^ExecStart=//p' "$unit")
case "$command_line" in
  /*' __service-launcher') binary=${command_line% __service-launcher} ;;
  *) echo 'Unexpected T3 service ExecStart; leaving it unchanged.' >&2; exit 1 ;;
esac
case "$binary" in *[!a-zA-Z0-9_./-]*|'') echo 'Unsupported T3 service binary path; leaving it unchanged.' >&2; exit 1;; esac
[ -x "$binary" ] || { echo 'T3 service binary is missing.' >&2; exit 1; }
dir="$HOME/.config/systemd/user/t3code.service.d"
mkdir -p "$dir"
tmp=$(mktemp "$dir/.secrets.XXXXXX")
trap 'rm -f "$tmp"' EXIT HUP INT TERM
printf '%s\n' '[Service]' 'ExecStart=' "ExecStart=/bin/sh %h/.config/t3code/service-env.sh $binary __service-launcher" > "$tmp"
if [ -f "$dir/10-my-opencode-secrets.conf" ] && cmp -s "$tmp" "$dir/10-my-opencode-secrets.conf"; then
  echo 'T3 service secret loading is already configured.'
else
  mv "$tmp" "$dir/10-my-opencode-secrets.conf"
  systemctl --user daemon-reload
fi
echo 'Restarting T3 service to load secrets; running agent sessions may be interrupted.'
systemctl --user restart t3code.service
