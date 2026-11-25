#!/usr/bin/env bash
set -euo pipefail

unit=openchamber.service
user_units="$HOME/.config/systemd/user"

if systemctl --user show-environment >/dev/null 2>&1; then
  load_state=$(systemctl --user show "$unit" --property=LoadState --value)
  if [[ $load_state != not-found ]]; then
    systemctl --user stop "$unit"
  fi
  if [[ -e $user_units/$unit || -L $user_units/$unit || $load_state != not-found ]]; then
    systemctl --user disable "$unit"
    rm -f -- "$user_units/$unit"
    systemctl --user daemon-reload
  fi
else
  # Disabling unit files can work offline, including from a shell without a user bus.
  if [[ -e $user_units/$unit || -L $user_units/$unit ]]; then
    systemctl --user --no-reload disable "$unit"
    rm -f -- "$user_units/$unit"
  fi
fi

is_openchamber_server() {
  local pid=$1 port=3000 index executable
  local -a args
  [[ -O /proc/$pid && -r /proc/$pid/cmdline ]] || return 1
  mapfile -d '' -t args 2>/dev/null < "/proc/$pid/cmdline" || return 1
  executable=${args[0]-}
  case ${executable##*/} in
    node|bun) ;;
    *) return 1 ;;
  esac
  case ${args[1]-} in
    */node_modules/@openchamber/web/build/bin/cli.js)
      [[ ${args[2]-} == serve ]] || return 1
      index=3 ;;
    */node_modules/@openchamber/web/build/server/index.js)
      index=2 ;;
    *) return 1 ;;
  esac
  for ((; index<${#args[@]}; index++)); do
    case ${args[index]} in
      -p|--port) port=${args[index+1]-} ;;
      --port=*) port=${args[index]#*=} ;;
    esac
  done
  [[ $port == 3000 ]]
}

pids=()
for proc_dir in /proc/[0-9]*; do
  pid=${proc_dir##*/}
  if is_openchamber_server "$pid"; then
    if ! kill -TERM "$pid" && is_openchamber_server "$pid"; then
      exit 1
    fi
    pids+=("$pid")
  fi
done

for pid in "${pids[@]}"; do
  for ((attempt=0; attempt<50; attempt++)); do
    is_openchamber_server "$pid" || break
    sleep 0.1
  done
  if is_openchamber_server "$pid"; then
    echo "OpenChamber process $pid is still running." >&2
    exit 1
  fi
done

echo 'OpenChamber startup removed and port 3000 server stopped.'
