# Installed by mise run shell:setup. Git Bash inherits Windows user ENV.
if [ "${_MY_OPENCODE_WINDOWS_SHELL_INITIALIZED-}" != 1 ]; then
    _MY_OPENCODE_WINDOWS_SHELL_INITIALIZED=1
    _my_opencode_data=${MISE_DATA_DIR:-$(cygpath -u "$LOCALAPPDATA")/mise}
    _my_opencode_data=$(cygpath -u "$_my_opencode_data")
    for _my_opencode_path in "$_my_opencode_data/shims" "$HOME/.local/bin" "$HOME/bin"; do
        [ ! -d "$_my_opencode_path" ] || case ":$PATH:" in
            *":$_my_opencode_path:"*) ;;
            *) PATH="$_my_opencode_path:$PATH" ;;
        esac
    done
    export PATH
    case $- in
        *i*) if command -v mise >/dev/null 2>&1; then eval "$(mise activate bash)"; fi ;;
    esac
    [ ! -r "$HOME/.config/shell/local.sh" ] || . "$HOME/.config/shell/local.sh"
    unset _my_opencode_data _my_opencode_path
fi
