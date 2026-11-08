#!/bin/sh
set -eu

DOCKLIKE_COMMIT=5f0591185badf6c6b9a15c7a79d8cbcb30957c32
SOURCE_URL=https://github.com/rasyidrafi/xfce4-docklike-plugin.git
TARGET=/usr/lib/x86_64-linux-gnu/xfce4/panel/plugins/libdocklike.so
DIVERTED="$TARGET.crd-docklike-fork.distrib"
STATE_DIR=/var/lib/crd-docklike-fork
MANIFEST="$STATE_DIR/manifest"
LOCK_DIR=/var/lib
LOCK_FILE="$LOCK_DIR/crd-docklike-fork.lock"
PACKAGE=xfce4-docklike-plugin

die() {
  echo "crd:docklike: $*" >&2
  exit 1
}

admin() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  else
    sudo "$@"
  fi
}

is_installed() {
  [ "$(dpkg-query -W -f='${db:Status-Status}' "$1" 2>/dev/null || :)" = installed ]
}

owns_target() {
  dpkg-query -S "$TARGET" 2>/dev/null | awk -F ': ' -v package="$PACKAGE" \
    '$1 == package || index($1, package ":") == 1 { found = 1 } END { exit !found }'
}

installed_hash() {
  sha256sum "$1" | awk '{print $1}'
}

read_manifest() {
  [ -f "$MANIFEST" ] && [ ! -L "$MANIFEST" ] || die "managed diversion has no regular install manifest: $MANIFEST"
  [ "$(wc -l < "$MANIFEST")" -eq 2 ] || die "invalid install manifest: $MANIFEST"
  manifest_commit=$(sed -n '1s/^commit=//p' "$MANIFEST")
  manifest_hash=$(sed -n '2s/^sha256=//p' "$MANIFEST")
  case "$manifest_commit" in
    ''|*[!0-9a-f]*) die "invalid source revision in $MANIFEST" ;;
  esac
  [ "${#manifest_commit}" -eq 40 ] || die "invalid source revision in $MANIFEST"
  case "$manifest_hash" in
    ''|*[!0-9a-f]*) die "invalid plugin hash in $MANIFEST" ;;
  esac
  [ "${#manifest_hash}" -eq 64 ] || die "invalid plugin hash in $MANIFEST"
}

case "$(uname -s)" in
  Linux) ;;
  *) die 'requires Linux on Debian/Ubuntu amd64.' ;;
esac
[ "$(dpkg --print-architecture 2>/dev/null || :)" = amd64 ] || die 'requires Linux on Debian/Ubuntu amd64.'
command -v apt-get >/dev/null 2>&1 || die 'requires apt-get.'
command -v flock >/dev/null 2>&1 || die 'requires flock.'
case "$DOCKLIKE_COMMIT" in
  ''|REPLACE_WITH_FORK_COMMIT|*[!0-9a-f]*) die 'DOCKLIKE_COMMIT must be replaced with the fork’s immutable 40-character commit.' ;;
esac
[ "${#DOCKLIKE_COMMIT}" -eq 40 ] || die 'DOCKLIKE_COMMIT must be a 40-character commit hash.'

# Serialize installers before inspecting diversion or install state. /var/lib and
# this persistent lock file must remain root-controlled so users cannot spoof it.
[ -d "$LOCK_DIR" ] && [ ! -L "$LOCK_DIR" ] || die "unsafe lock directory: $LOCK_DIR"
[ "$(stat -c %u "$LOCK_DIR")" = 0 ] || die "lock directory is not root-owned: $LOCK_DIR"
lock_dir_mode=$(stat -c %a "$LOCK_DIR")
[ $((0$lock_dir_mode & 0022)) -eq 0 ] || die "lock directory is group/world writable: $LOCK_DIR"
if [ ! -e "$LOCK_FILE" ] && [ ! -L "$LOCK_FILE" ]; then
  # Exclusive creation avoids replacing another invocation's lock inode.
  admin sh -c 'umask 022; set -C; : > "$1"' sh "$LOCK_FILE" 2>/dev/null || :
fi
[ -f "$LOCK_FILE" ] && [ ! -L "$LOCK_FILE" ] || die "lock file is missing, symlinked, or not regular: $LOCK_FILE"
[ "$(stat -c %u "$LOCK_FILE")" = 0 ] || die "lock file is not root-owned: $LOCK_FILE"
[ "$(stat -c %a "$LOCK_FILE")" = 644 ] || die "lock file must have mode 0644: $LOCK_FILE"
exec 9< "$LOCK_FILE" || die "could not open installer lock: $LOCK_FILE"
flock -x 9 || die "could not acquire installer lock: $LOCK_FILE"

if [ -L "$STATE_DIR" ]; then
  die "refusing symlinked install state directory: $STATE_DIR"
fi

# Refuse all diversions except this installer's exact local diversion.
diversion_package=$(dpkg-divert --listpackage "$TARGET")
diversion_target=$(dpkg-divert --truename "$TARGET")
managed=false
if [ "$diversion_package" = LOCAL ] && [ "$diversion_target" = "$DIVERTED" ]; then
  managed=true
elif [ -n "$diversion_package" ] || [ "$diversion_target" != "$TARGET" ]; then
  die "conflicting dpkg diversion for $TARGET (package: ${diversion_package:-none}, target: $diversion_target)."
fi

if [ "$managed" = true ]; then
  [ -f "$TARGET" ] && [ ! -L "$TARGET" ] || die "managed plugin is missing or not a regular file: $TARGET"
  [ -f "$DIVERTED" ] && [ ! -L "$DIVERTED" ] || die "diverted distro plugin is missing or not a regular file: $DIVERTED"
  read_manifest
  actual_hash=$(installed_hash "$TARGET")
  [ "$actual_hash" = "$manifest_hash" ] || die 'installed plugin hash differs from its manifest; refusing to replace a modified file.'
  if [ "$manifest_commit" = "$DOCKLIKE_COMMIT" ]; then
    echo "Docklike fork $DOCKLIKE_COMMIT is already installed and verified; no changes made."
    exit 0
  fi
else
  [ ! -e "$DIVERTED" ] || die "unmanaged file already exists at the diversion destination: $DIVERTED"
  [ ! -L "$DIVERTED" ] || die "unmanaged symlink already exists at the diversion destination: $DIVERTED"
  [ ! -e "$MANIFEST" ] || die "install manifest exists without this installer's diversion: $MANIFEST"
  [ ! -L "$MANIFEST" ] || die "unmanaged symlink already exists at the install manifest path: $MANIFEST"
  if is_installed "$PACKAGE"; then
    [ -f "$TARGET" ] && [ ! -L "$TARGET" ] || die "expected distro plugin is missing or not a regular file: $TARGET"
    owns_target || die "refusing to replace a plugin not owned by $PACKAGE: $TARGET"
  else
    [ ! -e "$TARGET" ] && [ ! -L "$TARGET" ] || die "refusing to overwrite a pre-existing unmanaged plugin: $TARGET"
  fi
fi

missing=''
for package in \
  "$PACKAGE" git ca-certificates build-essential autoconf autoconf-archive automake libtool pkg-config \
  xfce4-dev-tools gettext autopoint intltool libglib2.0-dev libgtk-3-dev libcairo2-dev \
  libxfce4ui-2-dev libxfce4util-dev libxfce4panel-2.0-dev \
  libxfce4windowing-0-dev libx11-dev; do
  if ! is_installed "$package"; then
    missing="$missing $package"
  fi
done
if [ -n "$missing" ]; then
  echo 'Installing the distro Docklike plugin and missing build dependencies (sudo required).'
  admin apt-get update
  # Package names are fixed above; the whitespace-separated list is safe to split.
  # shellcheck disable=SC2086
  admin apt-get install -y --no-install-recommends --no-upgrade $missing
fi

if [ "$managed" = false ]; then
  is_installed "$PACKAGE" || die "$PACKAGE did not install successfully."
  [ -f "$TARGET" ] && [ ! -L "$TARGET" ] || die "expected distro plugin is missing or not a regular file: $TARGET"
  if ! owns_target; then
    die "refusing to replace a plugin not owned by $PACKAGE: $TARGET"
  fi
fi

for tool in git make sha256sum readelf ldd; do
  command -v "$tool" >/dev/null 2>&1 || die "required build/verification command is missing: $tool"
done

work=$(mktemp -d)
transaction_started=false
new_diversion=false
old_plugin_backup=false
old_manifest_backup=false
state_dir_created=false
plugin_tmp="$TARGET.crd-docklike-fork.$$"
manifest_tmp="$MANIFEST.crd-docklike-fork.$$"
plugin_backup="$TARGET.crd-docklike-fork-backup.$$"
manifest_backup="$MANIFEST.crd-docklike-fork-backup.$$"
plugin_restore="$TARGET.crd-docklike-fork-restore.$$"
manifest_restore="$MANIFEST.crd-docklike-fork-restore.$$"

rollback() {
  status=$?
  trap - 0 HUP INT TERM
  if [ "$transaction_started" = true ]; then
    if [ "$managed" = true ]; then
      if [ "$old_plugin_backup" = true ]; then
        if admin cp -p "$plugin_backup" "$plugin_restore" && admin mv -f "$plugin_restore" "$TARGET" && [ "$(installed_hash "$TARGET" 2>/dev/null || :)" = "$old_plugin_hash" ]; then
          admin rm -f "$plugin_backup" || :
          old_plugin_backup=false
        else
          echo "crd:docklike: could not restore the previous plugin; recovery backup retained at $plugin_backup." >&2
        fi
      fi
      if [ "$old_manifest_backup" = true ]; then
        if admin cp -p "$manifest_backup" "$manifest_restore" && admin mv -f "$manifest_restore" "$MANIFEST" && [ "$(installed_hash "$MANIFEST" 2>/dev/null || :)" = "$old_manifest_hash" ]; then
          admin rm -f "$manifest_backup" || :
          old_manifest_backup=false
        else
          echo "crd:docklike: could not restore the previous manifest; recovery backup retained at $manifest_backup." >&2
        fi
      fi
    else
      current_package=$(dpkg-divert --listpackage "$TARGET" 2>/dev/null || :)
      current_diverted=$(dpkg-divert --truename "$TARGET" 2>/dev/null || :)
      if [ "$new_diversion" = true ]; then
        if [ "$current_package" = LOCAL ] && [ "$current_diverted" = "$DIVERTED" ]; then
          if [ -e "$DIVERTED" ]; then
            if [ -e "$TARGET" ] || [ -L "$TARGET" ]; then
              if [ -f "$TARGET" ] && [ ! -L "$TARGET" ] && [ "$(installed_hash "$TARGET" 2>/dev/null || :)" = "$new_hash" ]; then
                admin rm -f "$TARGET" "$MANIFEST" || :
              else
                echo "crd:docklike: rollback left an unexpected file untouched at $TARGET." >&2
                current_diverted=''
              fi
            else
              admin rm -f "$MANIFEST" || :
            fi
            if [ "$current_diverted" = "$DIVERTED" ]; then
              if ! admin dpkg-divert --remove --local --rename --divert "$DIVERTED" "$TARGET" >/dev/null 2>&1; then
                echo "crd:docklike: could not restore the distro plugin; recovery file retained at $DIVERTED." >&2
              fi
            fi
          else
            echo "crd:docklike: rollback could not find the diverted distro plugin at $DIVERTED; leaving the diversion in place." >&2
          fi
        fi
      fi
    fi
    admin rm -f "$plugin_tmp" "$manifest_tmp" "$plugin_restore" "$manifest_restore" || :
    if [ "$state_dir_created" = true ]; then
      admin rmdir "$STATE_DIR" 2>/dev/null || :
    fi
  fi
  rm -rf "$work"
  exit "$status"
}
trap rollback 0
trap 'exit 1' HUP INT TERM

source_dir="$work/source"
stage_dir="$work/stage"
mkdir -p "$source_dir" "$stage_dir"
git -C "$source_dir" init -q
git -C "$source_dir" remote add origin "$SOURCE_URL"
git -C "$source_dir" fetch --depth 1 origin "$DOCKLIKE_COMMIT"
fetched_commit=$(git -C "$source_dir" rev-parse FETCH_HEAD)
[ "$fetched_commit" = "$DOCKLIKE_COMMIT" ] || die "fetched source revision mismatch: expected $DOCKLIKE_COMMIT, got $fetched_commit"
git -C "$source_dir" checkout --quiet --detach FETCH_HEAD

(
  cd "$source_dir"
  unset NOCONFIGURE
  ./autogen.sh --prefix=/usr --libdir=/usr/lib/x86_64-linux-gnu --enable-x11 --disable-wayland
  make -j"$(getconf _NPROCESSORS_ONLN)"
  make install DESTDIR="$stage_dir"
)

staged_plugin="$stage_dir$TARGET"
[ -f "$staged_plugin" ] && [ ! -L "$staged_plugin" ] || die "build did not stage the expected plugin: $staged_plugin"
readelf -h "$staged_plugin" | grep -Eq 'Type:[[:space:]]+DYN' || die 'staged plugin is not a shared ELF object.'
ldd_output=$(ldd "$staged_plugin" 2>&1) || die "could not inspect staged plugin dependencies: $ldd_output"
if printf '%s\n' "$ldd_output" | grep -q 'not found'; then
  die 'staged plugin has unresolved runtime library dependencies.'
fi
new_hash=$(installed_hash "$staged_plugin")

transaction_started=true
if [ ! -d "$STATE_DIR" ]; then
  state_dir_created=true
  admin install -d -o root -g root -m 0755 "$STATE_DIR"
fi
admin test ! -e "$plugin_tmp"
admin test ! -L "$plugin_tmp"
admin test ! -e "$manifest_tmp"
admin test ! -L "$manifest_tmp"
admin test ! -e "$plugin_backup"
admin test ! -L "$plugin_backup"
admin test ! -e "$manifest_backup"
admin test ! -L "$manifest_backup"
admin test ! -e "$plugin_restore"
admin test ! -L "$plugin_restore"
admin test ! -e "$manifest_restore"
admin test ! -L "$manifest_restore"
admin install -o root -g root -m 0644 "$staged_plugin" "$plugin_tmp"
printf 'commit=%s\nsha256=%s\n' "$DOCKLIKE_COMMIT" "$new_hash" > "$work/manifest"
admin install -o root -g root -m 0644 "$work/manifest" "$manifest_tmp"

transaction_started=true
if [ "$managed" = true ]; then
  old_plugin_hash=$(installed_hash "$TARGET")
  old_manifest_hash=$(installed_hash "$MANIFEST")
  admin cp -p "$TARGET" "$plugin_backup"
  old_plugin_backup=true
  admin cp -p "$MANIFEST" "$manifest_backup"
  old_manifest_backup=true
else
  # Set first so the exit handler cleans up a partially completed dpkg-divert.
  new_diversion=true
  admin dpkg-divert --add --local --rename --divert "$DIVERTED" "$TARGET"
fi
admin mv -f "$plugin_tmp" "$TARGET"
admin mv -f "$manifest_tmp" "$MANIFEST"
[ "$(installed_hash "$TARGET")" = "$new_hash" ] || die 'installed plugin hash does not match the validated staged build.'
transaction_started=false
admin rm -f "$plugin_backup" "$manifest_backup" || :
echo "Installed Docklike fork revision $DOCKLIKE_COMMIT (sha256 $new_hash)."
