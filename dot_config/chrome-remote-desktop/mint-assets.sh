#!/bin/sh
set -eu
tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT HUP INT TERM
wallpaper="$HOME/.local/share/backgrounds/crd-mint/sele_ring.jpg"
themes="$HOME/.local/share/themes"
if [ ! -f "$themes/Mint-Y-Dark-Aqua/gtk-3.0/gtk.css" ] || [ ! -f "$themes/Mint-Y-Dark-Aqua/xfwm4/themerc" ] || [ ! -f "$themes/Mint-Y-Aqua/gtk-3.0/gtk.css" ] || [ ! -f "$themes/Mint-Y-Aqua/xfwm4/themerc" ]; then
  curl -fsSL https://github.com/linuxmint/mint-themes/releases/download/master.lmde7/packages.tar.gz -o "$tmpdir/themes.tar.gz"
  printf '%s  %s\n' 84ab8925d64af713cee577a069b187bd9ccb6bd8fbd0be7e098a2de96bbcedfb "$tmpdir/themes.tar.gz" | sha256sum -c -
  tar xOf "$tmpdir/themes.tar.gz" packages/mint-themes_2.4.3_all.deb > "$tmpdir/themes.deb"
  mkdir -p "$tmpdir/extracted" "$themes"
  dpkg-deb --fsys-tarfile "$tmpdir/themes.deb" | tar xf - -C "$tmpdir/extracted" ./usr/share/themes/Mint-Y-Dark-Aqua ./usr/share/themes/Mint-Y-Aqua
  for theme in Mint-Y-Dark-Aqua Mint-Y-Aqua; do
    mkdir -p "$themes/$theme"
    cp -R "$tmpdir/extracted/usr/share/themes/$theme/." "$themes/$theme/"
  done
fi
if [ ! -f "$wallpaper" ]; then
  curl -fsSL https://mirrors.edge.kernel.org/linuxmint-packages/pool/main/m/mint-artwork/mint-artwork_1.9.3_all.deb -o "$tmpdir/artwork.deb"
  printf '%s  %s\n' ed1e44dc159a282ab56ff61bb373e13ea6017cb4a1875f40cb5ca7ba34ec75ba "$tmpdir/artwork.deb" | sha256sum -c -
  mkdir -p "$tmpdir/artwork" "$(dirname "$wallpaper")"
  dpkg-deb --fsys-tarfile "$tmpdir/artwork.deb" | tar xf - -C "$tmpdir/artwork" ./usr/share/backgrounds/linuxmint/sele_ring.jpg
  cp "$tmpdir/artwork/usr/share/backgrounds/linuxmint/sele_ring.jpg" "$wallpaper"
fi
fontdir="$HOME/.local/share/fonts/crd-mint"
fonts_changed=false
for font in Ubuntu-Regular Ubuntu-Medium Ubuntu-Bold Ubuntu-Italic Ubuntu-BoldItalic UbuntuMono-Regular UbuntuMono-Bold UbuntuMono-Italic UbuntuMono-BoldItalic; do
  [ -f "$fontdir/$font.ttf" ] && continue
  case "$font" in UbuntuMono-*) directory=ubuntumono;; *) directory=ubuntu;; esac
  mkdir -p "$fontdir"
  curl -fsSL "https://raw.githubusercontent.com/google/fonts/a50de97857f6626d6628c91e6a34c12ee8a16ede/ufl/$directory/$font.ttf" -o "$tmpdir/$font.ttf"
  cp "$tmpdir/$font.ttf" "$fontdir/"
  fonts_changed=true
done
if [ "$fonts_changed" = true ]; then
  fc-cache -f "$fontdir"
fi
