#!/data/data/com.termux/files/usr/bin/sh
# Run after closing the old Codex session. Keeps the old npm package intact.
set -eu
prefix=/data/data/com.termux/files/usr
mise_binary="$prefix/bin/mise"
[ "${PREFIX:-}" = "$prefix" ] || { echo 'This script requires Termux.' >&2; exit 1; }
"$mise_binary" -C "$HOME" exec http:codex -- codex --version
# Run only after exiting old sessions: stop their separately named daemon.
old_launcher="$prefix/lib/node_modules/@mmmbuto/codex-cli-termux/bin/codex.js"
if [ -f "$old_launcher" ] && [ -e "$HOME/.codex/app-server-control-termux/app-server-control.sock" ]; then
    CODEX_TERMUX_SKIP_MIGRATION=1 "$prefix/bin/node" "$old_launcher" app-server daemon stop
fi
backup="$HOME/.local/state/mise-termux-codex-switch"
mkdir -p "$backup"
chmod 700 "$backup"
for command in codex codex-exec; do
    target="$prefix/bin/$command"
    if [ ! -e "$backup/$command" ] && [ ! -L "$backup/$command" ]; then
        if [ -e "$target" ] || [ -L "$target" ]; then cp -P "$target" "$backup/$command"; fi
    fi
    temporary="$prefix/bin/.$command-mise-$$"
    cat > "$temporary" <<'BRIDGE'
#!/data/data/com.termux/files/usr/bin/sh
# Codex runtime is selected by the home mise configuration.
set -eu
unset CODEX_SELF_EXE CODEX_MANAGED_BY_NPM CODEX_MANAGED_BY_BUN CODEX_MANAGED_BY_PNPM CODEX_MANAGED_BY_VITE_PLUS LD_LIBRARY_PATH
case "${0##*/}" in codex-exec) set -- exec "$@" ;; esac
exec /data/data/com.termux/files/usr/bin/mise -C "$HOME" exec http:codex -- codex "$@"
BRIDGE
    chmod 755 "$temporary"
    mv -f "$temporary" "$target"
done
"$mise_binary" reshim
"$prefix/bin/codex" --version
"$prefix/bin/codex" app-server daemon start
"$prefix/bin/codex" app-server daemon version
printf '%s\n' 'Switch complete. Old npm package retained; original launchers saved in:' "$backup" 'Now run: hash -r; codex --version; codex'
