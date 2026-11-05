#!/data/data/com.termux/files/usr/bin/sh
# Compatibility for native Termux shebangs; runtime selection stays with mise.
set -eu
runtime_command=${0##*/}
case "$runtime_command" in node|npm|npx) ;; *) echo 'Invalid Node compatibility entry point' >&2; exit 1 ;; esac
exec /data/data/com.termux/files/usr/bin/mise -C "$HOME" exec http:node -- "$runtime_command" "$@"
