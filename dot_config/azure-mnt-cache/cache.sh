# Installed by mise run azure-mnt-cache:setup. Source from a POSIX shell.
# Reset inherited paths before checking whether the disposable disk is ready.
export GOPATH="$HOME/go"
export XDG_CACHE_HOME="$HOME/.cache"
export npm_config_cache="$HOME/.npm"
export PIP_CACHE_DIR="$HOME/.cache/pip"
export UV_CACHE_DIR="$HOME/.cache/uv"
export GOCACHE="$HOME/.cache/go-build"
export GOMODCACHE="$HOME/go/pkg/mod"
export CARGO_TARGET_DIR="$HOME/.cache/cargo-build"
export CCACHE_DIR="$HOME/.cache/ccache"
export TMPDIR=/tmp
# Only clear our own selection when falling back; preserve unrelated builders.
if [ "${BUILDX_BUILDER:-}" = azure-mnt-cache ]; then unset BUILDX_BUILDER; fi

_azure_cache_root="/mnt/cache/$(id -un)"
if command -v mountpoint >/dev/null 2>&1 && mountpoint -q /mnt; then
    if (umask 077; mkdir -p "$_azure_cache_root/xdg" \
        "$_azure_cache_root/npm" "$_azure_cache_root/pip" \
        "$_azure_cache_root/uv" "$_azure_cache_root/go-build" \
        "$_azure_cache_root/go-mod" "$_azure_cache_root/cargo-build" \
        "$_azure_cache_root/ccache" "$_azure_cache_root/tmp") 2>/dev/null; then
        _azure_cache_ready=true
        for _azure_cache_dir in xdg npm pip uv go-build go-mod cargo-build ccache tmp; do
            if [ ! -w "$_azure_cache_root/$_azure_cache_dir" ] ||
               [ ! -x "$_azure_cache_root/$_azure_cache_dir" ]; then
                _azure_cache_ready=false
            fi
        done
        if [ "$_azure_cache_ready" = true ]; then
            export XDG_CACHE_HOME="$_azure_cache_root/xdg"
            export npm_config_cache="$_azure_cache_root/npm"
            export PIP_CACHE_DIR="$_azure_cache_root/pip"
            export UV_CACHE_DIR="$_azure_cache_root/uv"
            export GOCACHE="$_azure_cache_root/go-build"
            export GOMODCACHE="$_azure_cache_root/go-mod"
            export CARGO_TARGET_DIR="$_azure_cache_root/cargo-build"
            export CCACHE_DIR="$_azure_cache_root/ccache"
            export TMPDIR="$_azure_cache_root/tmp"
            if [ -f "$HOME/.config/azure-mnt-cache/docker-enabled" ] &&
               (umask 077; mkdir -p "$_azure_cache_root/docker-buildkit") 2>/dev/null; then
                export BUILDX_BUILDER=azure-mnt-cache
            fi
        fi
    fi
fi
unset _azure_cache_root _azure_cache_dir _azure_cache_ready
