# Preserve caller-provided values, including explicitly empty values.
# names contains validated identifiers only, never credential values.
if [ -r "$HOME/.config/secrets/generated/env.sh" ]; then
    if [ -r "$HOME/.config/secrets/generated/names" ]; then
        while IFS= read -r _my_shell_secret_name; do
            case $_my_shell_secret_name in
                ''|[0-9]*|*[!A-Z0-9_]*) continue ;;
            esac
            eval '_my_shell_secret_set_'"$_my_shell_secret_name"'=${'"$_my_shell_secret_name"'+x}'
            eval '_my_shell_secret_saved_'"$_my_shell_secret_name"'=${'"$_my_shell_secret_name"'-}'
        done < "$HOME/.config/secrets/generated/names"
    fi
    . "$HOME/.config/secrets/generated/env.sh"
    if [ -r "$HOME/.config/secrets/generated/names" ]; then
        while IFS= read -r _my_shell_secret_name; do
            case $_my_shell_secret_name in
                ''|[0-9]*|*[!A-Z0-9_]*) continue ;;
            esac
            eval 'if [ "${_my_shell_secret_set_'"$_my_shell_secret_name"'-}" = x ]; then '"$_my_shell_secret_name"'=${_my_shell_secret_saved_'"$_my_shell_secret_name"'}; export '"$_my_shell_secret_name"'; fi'
            eval 'unset _my_shell_secret_set_'"$_my_shell_secret_name"' _my_shell_secret_saved_'"$_my_shell_secret_name"
        done < "$HOME/.config/secrets/generated/names"
    fi
    unset _my_shell_secret_name
fi
