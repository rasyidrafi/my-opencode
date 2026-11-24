#!/bin/sh
set -eu
panel() { xfconf-query -c xfce4-panel "$@"; }
properties=$(panel -lv)
for tray in $(printf '%s\n' "$properties" | awk '$1 ~ /^\/plugins\/plugin-[0-9]+$/ && $2 == "systray" {print $1}'); do
  key=$tray/square-icons
  if current=$(panel -p "$key" 2>/dev/null); then
    [ "$current" = true ] || panel -p "$key" -s true
  else
    panel -p "$key" -n -t bool -s true
  fi
done
