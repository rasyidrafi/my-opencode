# Installed by mise run shell:setup. PATH-only Fish finalizer.
# Managed entries are de-duplicated in baseline order; other entries keep order.
set -l _my_shell_data
if test -n "$MISE_DATA_DIR"
    set _my_shell_data "$MISE_DATA_DIR"
else if test -n "$XDG_DATA_HOME"
    set _my_shell_data "$XDG_DATA_HOME/mise"
else
    set _my_shell_data "$HOME/.local/share/mise"
end

set -l _my_shell_managed
for _my_shell_dir in "$HOME/bin" "$HOME/.local/bin" "$_my_shell_data/shims"
    if test -d "$_my_shell_dir"
        set -a _my_shell_managed "$_my_shell_dir"
    end
end

if test (count $_my_shell_managed) -gt 0
    set -l _my_shell_before
    set -l _my_shell_after
    set -l _my_shell_found 0
    for _my_shell_entry in $PATH
        if contains -- "$_my_shell_entry" $_my_shell_managed
            if test $_my_shell_found -eq 0
                set _my_shell_found 1
            end
        else if test $_my_shell_found -eq 0
            set -a _my_shell_before "$_my_shell_entry"
        else
            set -a _my_shell_after "$_my_shell_entry"
        end
    end
    if test $_my_shell_found -eq 1
        set -gx PATH $_my_shell_before $_my_shell_managed $_my_shell_after
    else
        set -gx PATH $_my_shell_managed $PATH
    end
end

set -e _my_shell_data _my_shell_managed _my_shell_dir _my_shell_before
set -e _my_shell_after _my_shell_found _my_shell_entry
