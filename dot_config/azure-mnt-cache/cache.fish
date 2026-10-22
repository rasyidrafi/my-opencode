# Installed by mise run azure-mnt-cache:setup. Source from Fish.
# Reset inherited paths before checking whether the disposable disk is ready.
set -gx GOPATH "$HOME/go"
set -gx XDG_CACHE_HOME "$HOME/.cache"
set -gx npm_config_cache "$HOME/.npm"
set -gx PIP_CACHE_DIR "$HOME/.cache/pip"
set -gx UV_CACHE_DIR "$HOME/.cache/uv"
set -gx GOCACHE "$HOME/.cache/go-build"
set -gx GOMODCACHE "$HOME/go/pkg/mod"
set -gx CARGO_TARGET_DIR "$HOME/.cache/cargo-build"
set -gx CCACHE_DIR "$HOME/.cache/ccache"
set -gx TMPDIR /tmp
# Only clear our own selection when falling back; preserve unrelated builders.
if test "$BUILDX_BUILDER" = azure-mnt-cache
    set -e BUILDX_BUILDER
end
set -l _azure_cache_root /mnt/cache/(id -un)
set -l _azure_cache_old_umask (umask)
umask 077
if command -v mountpoint >/dev/null 2>&1; and mountpoint -q /mnt; and mkdir -p "$_azure_cache_root/xdg" \
    "$_azure_cache_root/npm" "$_azure_cache_root/pip" \
    "$_azure_cache_root/uv" "$_azure_cache_root/go-build" \
    "$_azure_cache_root/go-mod" "$_azure_cache_root/cargo-build" \
    "$_azure_cache_root/ccache" "$_azure_cache_root/tmp" 2>/dev/null
    set -l _azure_cache_ready
    set _azure_cache_ready true
    for _azure_cache_dir in xdg npm pip uv go-build go-mod cargo-build ccache tmp
        if not test -w "$_azure_cache_root/$_azure_cache_dir"; or not test -x "$_azure_cache_root/$_azure_cache_dir"
            set _azure_cache_ready false
        end
    end
    if test "$_azure_cache_ready" = true
        set -gx XDG_CACHE_HOME "$_azure_cache_root/xdg"
        set -gx npm_config_cache "$_azure_cache_root/npm"
        set -gx PIP_CACHE_DIR "$_azure_cache_root/pip"
        set -gx UV_CACHE_DIR "$_azure_cache_root/uv"
        set -gx GOCACHE "$_azure_cache_root/go-build"
        set -gx GOMODCACHE "$_azure_cache_root/go-mod"
        set -gx CARGO_TARGET_DIR "$_azure_cache_root/cargo-build"
        set -gx CCACHE_DIR "$_azure_cache_root/ccache"
        set -gx TMPDIR "$_azure_cache_root/tmp"
    end
end
umask $_azure_cache_old_umask
set -e _azure_cache_root _azure_cache_old_umask _azure_cache_ready _azure_cache_dir
