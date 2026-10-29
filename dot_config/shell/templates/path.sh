# Installed by mise run shell:setup. PATH-only finalizer for POSIX shells.
# Managed entries are de-duplicated and kept in baseline order. Unrelated entries
# keep their order and position around the first managed entry.
_my_shell_data=${MISE_DATA_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/mise}
_my_shell_bin=
_my_shell_local=
_my_shell_shims=
_my_shell_managed=
if [ -d "$HOME/bin" ]; then _my_shell_bin=$HOME/bin; fi
if [ -d "$HOME/.local/bin" ]; then _my_shell_local=$HOME/.local/bin; fi
if [ -d "$_my_shell_data/shims" ]; then _my_shell_shims=$_my_shell_data/shims; fi
for _my_shell_dir in "$_my_shell_bin" "$_my_shell_local" "$_my_shell_shims"; do
    if [ -n "$_my_shell_dir" ]; then
        _my_shell_managed=${_my_shell_managed:+$_my_shell_managed:}$_my_shell_dir
    fi
done

if [ -n "$_my_shell_managed" ]; then
    _my_shell_rest=${PATH-}
    _my_shell_before=
    _my_shell_before_set=no
    _my_shell_after=
    _my_shell_after_set=no
    _my_shell_found=no
    if [ "${PATH+x}" = x ]; then
        _my_shell_more=yes
        while [ "$_my_shell_more" = yes ]; do
            case $_my_shell_rest in
                *:*) _my_shell_entry=${_my_shell_rest%%:*}; _my_shell_rest=${_my_shell_rest#*:}; _my_shell_more=yes ;;
                *) _my_shell_entry=$_my_shell_rest; _my_shell_rest=; _my_shell_more=no ;;
            esac
            _my_shell_is_managed=no
            if [ -n "$_my_shell_bin" ] && [ "$_my_shell_entry" = "$_my_shell_bin" ]; then _my_shell_is_managed=yes; fi
            if [ -n "$_my_shell_local" ] && [ "$_my_shell_entry" = "$_my_shell_local" ]; then _my_shell_is_managed=yes; fi
            if [ -n "$_my_shell_shims" ] && [ "$_my_shell_entry" = "$_my_shell_shims" ]; then _my_shell_is_managed=yes; fi
            if [ "$_my_shell_is_managed" = yes ]; then
                _my_shell_found=yes
            elif [ "$_my_shell_found" = yes ]; then
                if [ "$_my_shell_after_set" = yes ]; then _my_shell_after=$_my_shell_after:$_my_shell_entry
                else _my_shell_after=$_my_shell_entry; _my_shell_after_set=yes; fi
            elif [ "$_my_shell_before_set" = yes ]; then _my_shell_before=$_my_shell_before:$_my_shell_entry
            else _my_shell_before=$_my_shell_entry; _my_shell_before_set=yes; fi
        done
    fi
    if [ "$_my_shell_found" = yes ]; then
        if [ "$_my_shell_before_set" = yes ]; then PATH=$_my_shell_before:$_my_shell_managed
        else PATH=$_my_shell_managed; fi
        if [ "$_my_shell_after_set" = yes ]; then PATH=$PATH:$_my_shell_after; fi
    elif [ "$_my_shell_before_set" = yes ]; then
        PATH=$_my_shell_managed:$_my_shell_before
    else
        PATH=$_my_shell_managed
    fi
    export PATH
fi

unset _my_shell_data _my_shell_bin _my_shell_local _my_shell_shims _my_shell_managed
unset _my_shell_rest _my_shell_before _my_shell_before_set _my_shell_after _my_shell_after_set
unset _my_shell_found _my_shell_more _my_shell_entry _my_shell_is_managed _my_shell_dir
