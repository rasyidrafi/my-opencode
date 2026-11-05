#!/data/data/com.termux/files/usr/bin/sh
set -eu
[ "$(uname -m)" = aarch64 ] || { echo 'T3 native setup currently supports Android ARM64 only.' >&2; exit 1; }
[ -n "${TERMUX_VERSION:-}" ] || [ "${PREFIX:-}" = /data/data/com.termux/files/usr ] || { echo 'Run this task in Termux.' >&2; exit 1; }
config_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
version=0.1.7
commit=322f6544dfad0a3c8a0c8cbecf2c7f7874b14268
install_dir="$HOME/.local/share/t3code/$version"
state_dir="$HOME/.local/state/t3code"
mkdir -p "$state_dir" "$HOME/.local/bin" "$(dirname "$install_dir")"
if [ ! -f "$install_dir/.complete" ]; then
  for tool in curl tar clang clang++ npm node mise cloudflared; do
    command -v "$tool" >/dev/null || { echo "Missing $tool. Install native prerequisites: pkg install clang make python cloudflared" >&2; exit 1; }
  done
  if [ ! -f "$install_dir/.source-commit" ]; then
    [ ! -e "$install_dir" ] || { echo "Unexpected installation at $install_dir; move it before retrying." >&2; exit 1; }
    staging=$(mktemp -d "$(dirname "$install_dir")/.build-XXXXXX")
    trap 'rm -rf "$staging"' EXIT
    curl -fsSL --retry 2 "https://codeload.github.com/pingdotgg/t3code/tar.gz/$commit" -o "$staging/source.tar.gz"
    mkdir "$staging/source"
    tar -xzf "$staging/source.tar.gz" -C "$staging/source" --strip-components=1
    node "$config_dir/native/prepare.mjs" "$staging/source"
    cp "$config_dir/native/package-lock.json" "$staging/source/package-lock.json"
    printf '%s\n' "$commit" > "$staging/source/.source-commit"
    mv "$staging/source" "$install_dir"
  fi
  [ "$(cat "$install_dir/.source-commit")" = "$commit" ] || { echo 'Unexpected source commit.' >&2; exit 1; }
  if [ ! -f "$install_dir/.dependencies-complete" ]; then
    (cd "$install_dir" && npm ci --ignore-scripts --no-audit --no-fund --legacy-peer-deps)
    touch "$install_dir/.dependencies-complete"
  fi
  node "$config_dir/native/build.mjs" "$install_dir"
  node_wrapper=$(mise -C "$HOME" which node)
  node_root=$(CDPATH= cd -- "$(dirname -- "$node_wrapper")/.." && pwd)
  node_headers="$node_root/include/node"
  [ -f "$node_headers/node_api.h" ] || { echo "Missing Node headers: $node_headers" >&2; exit 1; }
  mkdir -p "$install_dir/termux-lib" "$install_dir/node_modules/node-pty/build/Release"
  cp "$config_dir/native/preload.cjs" "$install_dir/termux-lib/preload.cjs"
  clang -shared -Wl,--undefined=__clear_cache -Wl,--export-dynamic-symbol=__clear_cache \
    -o "$install_dir/termux-lib/libt3-compiler-rt.so" "$(clang --print-libgcc-file-name)"
  clang -shared -fPIC -I "$node_headers" -o "$install_dir/termux-lib/rename.node" "$config_dir/native/rename.c"
  clang++ -shared -fPIC -std=c++17 -DNAPI_CPP_EXCEPTIONS \
    -I "$install_dir/node_modules/node-addon-api" -I "$node_headers" \
    -o "$install_dir/node_modules/node-pty/build/Release/pty.node" "$install_dir/node_modules/node-pty/src/unix/pty.cc"
  touch "$install_dir/.complete"
fi
# Refresh the JavaScript compatibility shim when this task is rerun.
cp "$config_dir/native/preload.cjs" "$install_dir/termux-lib/preload.cjs"
cat > "$HOME/.local/bin/t3" <<'LAUNCHER'
#!/data/data/com.termux/files/usr/bin/sh
set -eu
t3_root="$HOME/.local/share/t3code/0.1.7"
export T3CODE_CLOUDFLARED_PATH="${T3CODE_CLOUDFLARED_PATH:-/data/data/com.termux/files/usr/bin/cloudflared}"
export LD_PRELOAD="$t3_root/termux-lib/libt3-compiler-rt.so${LD_PRELOAD:+:$LD_PRELOAD}"
node_runtime=$(mise -C "$HOME" which node)
exec "$node_runtime" --require "$t3_root/termux-lib/preload.cjs" "$t3_root/apps/server/dist/bin.mjs" "$@"
LAUNCHER
cat > "$HOME/.local/bin/t3-server" <<'LAUNCHER'
#!/data/data/com.termux/files/usr/bin/sh
exec sh "$HOME/.config/t3code/server.sh" "$@"
LAUNCHER
chmod 700 "$HOME/.local/bin/t3" "$HOME/.local/bin/t3-server"
"$HOME/.local/bin/t3" --version
sh "$config_dir/server.sh" start
