# Installed by mise run shell:setup. Shared, quiet POSIX shell environment.
# PATH-only normalization can be replayed at startup boundaries; hooks run once
# per shell process even when a login shell also sources .bashrc.
[ ! -r "$HOME/.config/shell/path.sh" ] || . "$HOME/.config/shell/path.sh"
if [ "${_MY_OPENCODE_SHELL_V1_INITIALIZED-}" != 1 ]; then
    _MY_OPENCODE_SHELL_V1_INITIALIZED=1
    [ ! -r "$HOME/.config/secrets/load.sh" ] || . "$HOME/.config/secrets/load.sh"
    if [ -f "$HOME/.config/azure-mnt-cache/shell-enabled" ] && [ -r "$HOME/.config/azure-mnt-cache/cache.sh" ]; then
        . "$HOME/.config/azure-mnt-cache/cache.sh"
    fi
    if [ -n "${BASH_VERSION-}" ] && [ -r "$HOME/.config/shell/local.sh" ]; then
        . "$HOME/.config/shell/local.sh"
    fi
fi
if [ -n "${BASH_VERSION-}" ]; then
    BASH_ENV="$HOME/.bash_env"
    export BASH_ENV
fi
