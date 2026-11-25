#!/bin/sh
# Load the same managed environment as an initialized shell on every start.
[ ! -r "$HOME/.config/shell/env.sh" ] || . "$HOME/.config/shell/env.sh"
[ ! -r "$HOME/.config/secrets/load.sh" ] || . "$HOME/.config/secrets/load.sh"
PATH="$HOME/.local/bin:${XDG_DATA_HOME:-$HOME/.local/share}/mise/shims:$PATH"
export PATH
exec mise exec -- t3 __service-launcher
