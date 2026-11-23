# Forked XFCE taskbar

`mise run desktop:setup` installs SHA-256-verified release packages on Debian 13
amd64 from `rasyidrafi/xfce4-docklike-plugin` and `rasyidrafi/xfce4-whiskermenu-plugin`
(branch `taskbar-integration`). No local compilation or GitHub login is required.
Other OS/architecture combinations retain the ordinary XFCE setup; do not install
these amd64 packages on them. The package names are the normal XFCE names so the
package manager owns the files; rerunning setup checks the exact fork versions.

Existing Docklike settings, pins and custom panel layouts are preserved. The known
Mint three-launcher/tasklist block is replaced with one Docklike instance without
changing the tray. On a custom layout add Docklike manually through Panel Preferences.
New instances start ungrouped, with launch-on-middle-click and browser, Thunar and
Terminal pinned. Log out and back in to reload plugins if a panel was already active.
