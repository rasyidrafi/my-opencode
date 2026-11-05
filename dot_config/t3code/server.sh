#!/data/data/com.termux/files/usr/bin/sh
set -eu
state_dir="$HOME/.local/state/t3code"
pid_file="$state_dir/server.pid"
log_file="$state_dir/server.log"
launcher="$HOME/.local/bin/t3"
mkdir -p "$state_dir"
alive() {
  [ -f "$pid_file" ] || return 1
  pid=$(cat "$pid_file")
  case "$pid" in ''|*[!0-9]*) return 1;; esac
  kill -0 "$pid" 2>/dev/null || return 1
  # Never signal an unrelated process after PID reuse.
  command_line=$(tr '\000' ' ' < "/proc/$pid/cmdline" 2>/dev/null) || return 1
  case "$command_line" in *"$HOME/.local/share/t3code/0.1.7/apps/server/dist/bin.mjs"*) return 0;; *) return 1;; esac
}
case "${1:-status}" in
  start)
    if alive; then echo "T3 server is running (PID $pid), port ${T3CODE_PORT:-3773}."; exit 0; fi
    [ -x "$launcher" ] || { echo 'Run mise run t3code:setup first.' >&2; exit 1; }
    command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock || true
    rm -f "$pid_file"
    # Detach from the calling terminal/session, including Codex's tool process group.
    setsid -f sh -c 'pid_file=$1; shift; echo "$$" > "$pid_file"; exec "$@"' sh \
      "$pid_file" "$launcher" serve --host "${T3CODE_HOST:-127.0.0.1}" \
      --port "${T3CODE_PORT:-3773}" --no-browser </dev/null >>"$log_file" 2>&1
    count=0
    while [ ! -s "$pid_file" ] && [ "$count" -lt 10 ]; do sleep 1; count=$((count + 1)); done
    count=0
    while [ "$count" -lt 45 ]; do
      if curl -fsS "http://127.0.0.1:${T3CODE_PORT:-3773}/api/auth/session" >/dev/null 2>&1; then
        echo "T3 server ready at http://127.0.0.1:${T3CODE_PORT:-3773}. Run t3-server pair to connect."
        exit 0
      fi
      if ! kill -0 "$(cat "$pid_file")" 2>/dev/null; then tail -n 30 "$log_file" >&2; exit 1; fi
      sleep 1
      count=$((count + 1))
    done
    echo "Server started; check $log_file for readiness." >&2
    exit 1
    ;;
  stop)
    if alive; then
      kill -TERM "$pid"
      count=0
      while alive && [ "$count" -lt 20 ]; do sleep 1; count=$((count + 1)); done
      if alive; then echo "T3 is still stopping; check $log_file." >&2; exit 1; fi
    fi
    rm -f "$pid_file"
    echo 'T3 server is stopped.'
    ;;
  status)
    if alive; then echo "T3 server running (PID $pid). Logs: $log_file"; else echo 'T3 server is stopped.'; exit 1; fi
    ;;
  pair) shift; exec "$launcher" pair "$@" ;;
  logs) exec tail -n 60 "$log_file" ;;
  *) echo 'Usage: t3-server {start|stop|status|pair|logs}' >&2; exit 2 ;;
esac
