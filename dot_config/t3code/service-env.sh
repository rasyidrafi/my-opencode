#!/bin/sh
set -eu
[ ! -r "$HOME/.config/secrets/load.sh" ] || . "$HOME/.config/secrets/load.sh"
exec "$@"
