#!/bin/sh
set -eu
panel() { xfconf-query -c xfce4-panel "$@"; }
properties=$(panel -lv)
for plugin in $(printf '%s\n' "$properties" | awk '$1 ~ /^\/plugins\/plugin-[0-9]+$/ && $2 == "pulseaudio" {print $1}'); do
  key=$plugin/show-notifications
  if value=$(panel -p "$key" 2>/dev/null); then
    case $value in
      1|2) continue ;; # All or output notifications already enabled.
      true|false) panel -p "$key" -r ;; # Older preset used a boolean.
      *) panel -p "$key" -s 2; continue ;;
    esac
  fi
  panel -p "$key" -n -t uint -s 2
done
