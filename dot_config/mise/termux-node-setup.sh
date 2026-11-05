#!/bin/sh
# Opt-in migration; never run automatically during chezmoi apply or mise install.
set -eu
case "${1:---check}" in --check|--remove-native) mode=${1:---check} ;; *) echo 'Usage: mise run termux:node:setup -- [--check | --remove-native]' >&2; exit 1 ;; esac
[ "$#" -le 1 ] || exit 1
termux_prefix=/data/data/com.termux/files/usr
[ "${PREFIX:-}" = "$termux_prefix" ] || { echo 'This task requires native Termux.' >&2; exit 1; }
mise_binary="$termux_prefix/bin/mise"
bridge="$HOME/.config/mise/termux-node-bridge.sh"
[ -f "$bridge" ] || { echo 'Apply the managed Node compatibility bridge with chezmoi first.' >&2; exit 1; }
managed() { "$mise_binary" -C "$HOME" exec http:node -- "$@"; }
managed node --version
managed npm --version
managed npx --version
# Verify the public entry point; its bridge resolves the configured mise runtime.
codex_launcher="$termux_prefix/bin/codex"
if [ -x "$codex_launcher" ]; then "$codex_launcher" --version; fi
if [ "$mode" = --check ]; then
    echo 'Managed Termux Node/npm and the available Codex launcher passed preflight. Native packages unchanged.'
    exit 0
fi
# Preserve ABI libraries when apt later suggests autoremove.
apt-mark manual libc++ openssl c-ares libicu libsqlite zlib libffi >/dev/null
backup="$HOME/.local/state/mise-termux-node/$(date +%Y%m%d-%H%M%S)-$$"
umask 077
mkdir -p "$backup/bin"
for command in node npm npx; do
    if [ -e "$termux_prefix/bin/$command" ]; then cp -P "$termux_prefix/bin/$command" "$backup/bin/$command"; fi
done
if [ -d "$termux_prefix/lib/node_modules/npm" ]; then
    cp -R "$termux_prefix/lib/node_modules/npm" "$backup/npm"
fi
rollback() {
    status=$?
    if [ "$status" -ne 0 ]; then
        echo "Migration failed; restoring runtime files from $backup. Repair package registration with: pkg install nodejs npm" >&2
        if [ -d "$backup/npm" ]; then
            mkdir -p "$termux_prefix/lib/node_modules"
            rm -rf "$termux_prefix/lib/node_modules/npm"
            cp -R "$backup/npm" "$termux_prefix/lib/node_modules/npm"
        fi
        for command in node npm npx; do
            if [ -e "$backup/bin/$command" ] || [ -L "$backup/bin/$command" ]; then
                rm -f "$termux_prefix/bin/$command"
                cp -P "$backup/bin/$command" "$termux_prefix/bin/$command"
            fi
        done
    fi
}
trap rollback EXIT
# dpkg refuses removal if other installed packages depend on these, rather than
# silently removing additional applications to satisfy the request.
dpkg --remove npm nodejs
for command in node npm npx; do
    cp "$bridge" "$termux_prefix/bin/$command"
    chmod 755 "$termux_prefix/bin/$command"
done
"$mise_binary" reshim
"$termux_prefix/bin/node" --version
"$termux_prefix/bin/npm" --version
"$termux_prefix/bin/npx" --version
if [ -x "$codex_launcher" ]; then "$codex_launcher" --version; fi
trap - EXIT
echo "Migration verified. Node/npm are managed by mise; compatibility launchers preserve Termux shebangs. Backup: $backup"
