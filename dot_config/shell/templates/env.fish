# Installed by mise run shell:setup. Shared, quiet Fish environment.
# Fish equivalent of templates/env.sh. Only managed PATH entries are reordered;
# unrelated entries retain their positions. Secrets and cache loaders mirror the
# Bash behavior. ~/.config/shell/local.sh stays Bash-only (its snippets may use
# Bash functions), so host-specific Fish needs belong in the Fish user config.
function _my_shell_prepend
    set -l _my_shell_rest
    for _my_shell_entry in $PATH
        if test "$_my_shell_entry" != "$argv[1]"
            set _my_shell_rest $_my_shell_rest $_my_shell_entry
        end
    end
    set PATH $argv[1] $_my_shell_rest
end
set -l _my_shell_shims
if test -n "$MISE_DATA_DIR"
    set _my_shell_shims "$MISE_DATA_DIR/shims"
else if test -n "$XDG_DATA_HOME"
    set _my_shell_shims $XDG_DATA_HOME/mise/shims
else
    set _my_shell_shims $HOME/.local/share/mise/shims
end
for _my_shell_dir in $_my_shell_shims $HOME/.local/bin $HOME/bin
    if test -d "$_my_shell_dir"
        _my_shell_prepend "$_my_shell_dir"
    end
end
set -e _my_shell_shims _my_shell_dir
functions -e _my_shell_prepend

if test -f "$HOME/.config/secrets/generated/env.fish"
    source "$HOME/.config/secrets/generated/env.fish"
end
if test -f "$HOME/.config/azure-mnt-cache/shell-enabled"; and test -r "$HOME/.config/azure-mnt-cache/cache.fish"
    source "$HOME/.config/azure-mnt-cache/cache.fish"
end
# Bash commands started from Fish read the shared environment through BASH_ENV.
set -gx BASH_ENV "$HOME/.bash_env"
