#!/bin/sh
set -eu
tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT HUP INT TERM
theme="$HOME/.local/share/themes/Mint-Y-Dark-Aqua"
wallpaper="$HOME/.local/share/backgrounds/crd-mint/sele_ring.jpg"
if [ ! -f "$theme/gtk-3.0/gtk.css" ] || [ ! -f "$theme/xfwm4/themerc" ]; then
  curl -fsSL https://github.com/linuxmint/mint-themes/releases/download/master.lmde7/packages.tar.gz -o "$tmpdir/themes.tar.gz"
  printf '%s  %s\n' 84ab8925d64af713cee577a069b187bd9ccb6bd8fbd0be7e098a2de96bbcedfb "$tmpdir/themes.tar.gz" | sha256sum -c -
  tar xOf "$tmpdir/themes.tar.gz" packages/mint-themes_2.4.3_all.deb > "$tmpdir/themes.deb"
  mkdir -p "$tmpdir/extracted" "$HOME/.local/share/themes"
  dpkg-deb --fsys-tarfile "$tmpdir/themes.deb" | tar xf - -C "$tmpdir/extracted" ./usr/share/themes/Mint-Y-Dark-Aqua
  mkdir -p "$theme"
  cp -R "$tmpdir/extracted/usr/share/themes/Mint-Y-Dark-Aqua/." "$theme/"
fi
if [ ! -f "$wallpaper" ]; then
  curl -fsSL https://mirrors.edge.kernel.org/linuxmint-packages/pool/main/m/mint-artwork/mint-artwork_1.9.3_all.deb -o "$tmpdir/artwork.deb"
  printf '%s  %s\n' ed1e44dc159a282ab56ff61bb373e13ea6017cb4a1875f40cb5ca7ba34ec75ba "$tmpdir/artwork.deb" | sha256sum -c -
  mkdir -p "$tmpdir/artwork" "$(dirname "$wallpaper")"
  dpkg-deb --fsys-tarfile "$tmpdir/artwork.deb" | tar xf - -C "$tmpdir/artwork" ./usr/share/backgrounds/linuxmint/sele_ring.jpg
  cp "$tmpdir/artwork/usr/share/backgrounds/linuxmint/sele_ring.jpg" "$wallpaper"
fi
fontdir="$HOME/.local/share/fonts/crd-mint"
if [ ! -f "$fontdir/Ubuntu-Regular.ttf" ] || [ ! -f "$fontdir/Ubuntu-Medium.ttf" ] || [ ! -f "$fontdir/Ubuntu-Bold.ttf" ]; then
  mkdir -p "$fontdir"
  for weight in Regular Medium Bold; do
    [ ! -f "$fontdir/Ubuntu-$weight.ttf" ] || continue
    curl -fsSL "https://raw.githubusercontent.com/google/fonts/a50de97857f6626d6628c91e6a34c12ee8a16ede/ufl/ubuntu/Ubuntu-$weight.ttf" -o "$tmpdir/Ubuntu-$weight.ttf"
    cp "$tmpdir/Ubuntu-$weight.ttf" "$fontdir/"
  done
  fc-cache -f "$fontdir"
fi
