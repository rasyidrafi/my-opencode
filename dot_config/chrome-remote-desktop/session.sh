# Start the XFCE desktop components without the crashing session manager.
unset SESSION_MANAGER
export XDG_CURRENT_DESKTOP=XFCE DESKTOP_SESSION=xfce XDG_SESSION_DESKTOP=xfce XDG_MENU_PREFIX=xfce-
exec dbus-run-session -- sh -c '
  xfce4-panel &
  xfdesktop &
  /usr/bin/python3 "$HOME/.config/chrome-remote-desktop/xfce-autostart.py" &
  exec xfwm4 --replace
'
