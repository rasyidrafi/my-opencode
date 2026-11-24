"""Launch XFCE XDG autostarts on the CRD display without xfce4-session."""
from pathlib import Path
import sys

from gi.repository import Gio, GLib

seen = set()
for base in (GLib.get_user_config_dir(), *GLib.get_system_config_dirs()):
    for path in sorted((Path(base) / "autostart").glob("*.desktop")):
        if path.name in seen:
            continue
        seen.add(path.name)  # A hidden user entry also masks the system entry.
        app = Gio.DesktopAppInfo.new_from_filename(str(path))
        if app and not app.get_is_hidden() and app.get_show_in("XFCE"):
            try:
                app.launch([], None)
            except GLib.Error as error:
                print(f"Cannot autostart {path.name}: {error}", file=sys.stderr)
