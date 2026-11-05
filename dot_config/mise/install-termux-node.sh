#!/bin/sh
# Extract only verified native Termux packages into mise; never invoke pkg here.
set -eu
: "${MISE_TOOL_INSTALL_PATH:?Mise must provide its installation path}"
npm_version=${1:?Pinned npm version required}
npm_checksum=${2:?Pinned npm checksum required}
required='libc++ openssl c-ares libicu libsqlite zlib libffi'
missing=''
for package in $required; do
    if [ "$(dpkg-query -W -f='${Status}' "$package" 2>/dev/null || :)" != 'install ok installed' ]; then
        missing="$missing $package"
    fi
done
if [ -n "$missing" ]; then
    echo "Node.js requires native Termux libraries. Run: pkg install$missing" >&2
    exit 1
fi
for command in curl dpkg-deb sha256sum; do
    if ! command -v "$command" >/dev/null 2>&1; then
        echo 'Node.js installation requires Termux tools. Run: pkg install curl dpkg coreutils' >&2
        exit 1
    fi
done
root=$MISE_TOOL_INSTALL_PATH
unpacked="$root/.termux-node"
trap 'rm -rf "$unpacked"' EXIT HUP INT TERM
mkdir -p "$unpacked/node" "$unpacked/npm" "$root/libexec" "$root/lib/node_modules"
dpkg-deb -x "$root/bin/node.deb" "$unpacked/node"
curl --fail --location --silent --show-error --max-time 120 \
    "https://packages-cf.termux.dev/apt/termux-main/pool/main/n/npm/npm_${npm_version}_all.deb" -o "$unpacked/npm.deb"
printf '%s  %s\n' "$npm_checksum" "$unpacked/npm.deb" | sha256sum -c - >/dev/null
dpkg-deb -x "$unpacked/npm.deb" "$unpacked/npm"
native_prefix=data/data/com.termux/files/usr
cp "$unpacked/node/$native_prefix/bin/node" "$root/libexec/node"
if [ -d "$unpacked/node/$native_prefix/include" ]; then
    cp -R "$unpacked/node/$native_prefix/include" "$root/"
fi
cp -R "$unpacked/npm/$native_prefix/lib/node_modules/npm" "$root/lib/node_modules/"
cat > "$root/bin/node" <<'EOF'
#!/data/data/com.termux/files/usr/bin/sh
# Codex ships a private libc++; Node must use Termux's system libraries.
unset LD_LIBRARY_PATH
node_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
exec "$node_root/libexec/node" "$@"
EOF
for command in npm npx; do
    if [ "$command" = npm ]; then entry=npm-cli.js; else entry=npx-cli.js; fi
    cat > "$root/bin/$command" <<EOF
#!/data/data/com.termux/files/usr/bin/sh
node_root=\$(CDPATH= cd -- "\$(dirname -- "\$0")/.." && pwd)
exec "\$node_root/bin/node" "\$node_root/lib/node_modules/npm/bin/$entry" "\$@"
EOF
done
chmod 755 "$root/libexec/node" "$root/bin/node" "$root/bin/npm" "$root/bin/npx"
if ! "$root/bin/node" --version || ! "$root/bin/npm" --version; then
    echo "Native Node.js/npm could not run. Repair Termux libraries: pkg install $required" >&2
    exit 1
fi
rm "$root/bin/node.deb"
