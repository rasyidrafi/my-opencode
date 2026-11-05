#!/bin/sh
# Extract the checksum-verified Termux build without registering a pkg install.
set -eu
: "${MISE_TOOL_INSTALL_PATH:?Mise must provide its installation path}"
package="$MISE_TOOL_INSTALL_PATH/bin/codex.deb"
unpacked="$MISE_TOOL_INSTALL_PATH/.termux-codex"
dpkg-deb -x "$package" "$unpacked"
cp -R "$unpacked/data/data/com.termux/files/usr/." "$MISE_TOOL_INSTALL_PATH/"
chmod 755 "$MISE_TOOL_INSTALL_PATH/bin/codex"
"$MISE_TOOL_INSTALL_PATH/bin/codex" --version
rm -rf "$unpacked"
rm "$package"
