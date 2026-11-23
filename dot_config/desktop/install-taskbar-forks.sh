#!/bin/sh
set -eu
tmp=$(mktemp -d)
trap 'rm -f "$tmp"/*.deb; rmdir "$tmp"' EXIT
fetch() {
  pkg=$1 version=$2 tag=$3 sha=$4
  if [ "$(dpkg-query -W -f='${db:Status-Status}:${Version}' "$pkg" 2>/dev/null || :)" = "installed:$version" ]; then return; fi
  file="$tmp/$pkg.deb"
  curl -fLsS --retry 3 "https://github.com/rasyidrafi/$pkg/releases/download/taskbar-debian13-$tag/$pkg.deb" -o "$file"
  printf '%s  %s\n' "$sha" "$file" | sha256sum -c -
}
fetch xfce4-docklike-plugin 0.5.1+fork.22a56a1 22a56a1 1ccea05b64f2a44de62f9ca22a9ceae68db3c635a10afcd59312db9c65a488bc
fetch xfce4-whiskermenu-plugin '2.10.0~dev+fork.ad86320' ad86320 4a577301e8990529187fc695e6e56ce2797baf9804940438fcae82cbae5bc670
set -- "$tmp"/*.deb
[ -f "$1" ] || exit 0
chmod 755 "$tmp"
sudo apt-get install -y --no-remove "$@"
