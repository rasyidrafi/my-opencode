# Installed by mise run shell:setup. Shared, quiet Fish environment.
# PATH-only normalization can be replayed after config.fish; hooks run once.
if test -r "$HOME/.config/shell/path.fish"
    source "$HOME/.config/shell/path.fish"
end

if not set -q _MY_OPENCODE_SHELL_V1_INITIALIZED
    set -g _MY_OPENCODE_SHELL_V1_INITIALIZED 1
    if test -f "$HOME/.config/secrets/generated/env.fish"
        source "$HOME/.config/secrets/generated/env.fish"
    end
    if test -f "$HOME/.config/azure-mnt-cache/shell-enabled"; and test -r "$HOME/.config/azure-mnt-cache/cache.fish"
        source "$HOME/.config/azure-mnt-cache/cache.fish"
    end
end
# Bash commands started from Fish read the shared environment through BASH_ENV.
set -gx BASH_ENV "$HOME/.bash_env"
