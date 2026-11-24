#!/bin/sh
set -eu
dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
# Do not install Debian binaries on another distribution or architecture.
. /etc/os-release
if [ "$ID:${VERSION_ID:-}:$(dpkg --print-architecture)" != debian:13:amd64 ]; then
  echo 'No compatible taskbar fork release; retaining the standard XFCE setup.' >&2
  exec sh "$dir/setup.sh" "$@"
fi
[ "$(id -u)" != 0 ] || { echo 'Run desktop:setup as your desktop user.' >&2; exit 1; }
sh "$dir/install-taskbar-forks.sh"
sh "$dir/install-inbook-audio.sh"
sh "$dir/setup.sh" "$@"
# xfconf-query needs a bus even when provisioning before the first login.
if [ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ]; then
  exec dbus-run-session -- python3 "$dir/configure-taskbar.py"
fi
exec python3 "$dir/configure-taskbar.py"
