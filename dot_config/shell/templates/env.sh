# Installed by mise run shell:setup. Shared, quiet POSIX shell environment.
# Only these managed PATH entries are reordered; unrelated entries retain order.
_my_shell_remove_path() {
    _my_shell_rest=${PATH-}
    _my_shell_result=
    _my_shell_first=yes
    while :; do
        case $_my_shell_rest in
            *:*) _my_shell_entry=${_my_shell_rest%%:*}; _my_shell_rest=${_my_shell_rest#*:}; _my_shell_more=yes ;;
            *) _my_shell_entry=$_my_shell_rest; _my_shell_more=no ;;
        esac
        if [ "$_my_shell_entry" != "$1" ]; then
            if [ "$_my_shell_first" = yes ]; then
                _my_shell_result=$_my_shell_entry
                _my_shell_first=no
            else
                _my_shell_result=$_my_shell_result:$_my_shell_entry
            fi
        fi
        [ "$_my_shell_more" = yes ] || break
    done
    PATH=$_my_shell_result
}
_my_shell_data=${MISE_DATA_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/mise}
for _my_shell_dir in "$_my_shell_data/shims" "$HOME/.local/bin" "$HOME/bin"; do
    if [ -d "$_my_shell_dir" ]; then
        _my_shell_remove_path "$_my_shell_dir"
        PATH="$_my_shell_dir${PATH:+:$PATH}"
    fi
done
export PATH
unset -f _my_shell_remove_path
unset _my_shell_rest _my_shell_result _my_shell_first _my_shell_entry _my_shell_more _my_shell_data _my_shell_dir

[ ! -r "$HOME/.config/secrets/load.sh" ] || . "$HOME/.config/secrets/load.sh"
if [ -f "$HOME/.config/azure-mnt-cache/shell-enabled" ] && [ -r "$HOME/.config/azure-mnt-cache/cache.sh" ]; then
    . "$HOME/.config/azure-mnt-cache/cache.sh"
fi
[ ! -r "$HOME/.config/shell/local.sh" ] || . "$HOME/.config/shell/local.sh"
if [ -n "${BASH_VERSION-}" ]; then
    BASH_ENV="$HOME/.bash_env"
    export BASH_ENV
fi
