#!/bin/sh
# Mise postinstall: extract the checksum-verified official Termux package.
set -eu
: "${MISE_TOOL_INSTALL_PATH:?Mise must provide its installation path}"
package="$MISE_TOOL_INSTALL_PATH/bin/gh.deb"
unpacked="$MISE_TOOL_INSTALL_PATH/.termux-gh"
dpkg-deb -x "$package" "$unpacked"
cp "$unpacked/data/data/com.termux/files/usr/bin/gh" "$MISE_TOOL_INSTALL_PATH/bin/gh"
chmod 755 "$MISE_TOOL_INSTALL_PATH/bin/gh"
rm -rf "$unpacked"
rm "$package"
