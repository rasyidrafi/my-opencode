"""Apply the Mint preset's logical dimensions to this XFCE session."""
import subprocess


def query(channel, key, *args):
    return subprocess.run(['xfconf-query', '-c', channel, '-p', key, *args],
                          capture_output=True, text=True)


def dimensions(dpi):
    def px(base):
        return ((abs(base) * dpi + 48) // 96) * (-1 if base < 0 else 1)

    def nearest(base, choices):
        return min(range(len(choices)), key=lambda i: (abs(choices[i] - px(base)), -i))

    yield 'xfce4-panel', '/panels/panel-1/size', px(32)
    yield 'xfce4-panel', '/panels/panel-1/icon-size', px(20)
    yield 'xfce4-desktop', '/desktop-icons/icon-size', px(48)
    yield 'xfce4-desktop', '/desktop-icons/tooltip-size', px(48)
    for key, base in [('snap_width', 10), ('double_click_distance', 5), ('shadow_delta_y', -3)]:
        yield 'xfwm4', '/general/' + key, px(base)
    # Thunar enum names, not raw pixels. Only the preset's sidebar is managed.
    names = ['SMALLEST', 'SMALLER', 'SMALL', 'NORMAL', 'LARGE', 'LARGER', 'LARGEST']
    yield 'thunar', '/shortcuts-icon-size', 'THUNAR_ICON_SIZE_' + names[nearest(16, (16, 24, 32, 48, 64, 96, 128))]
    yield 'systray', 'icon-size', px(20)
    yield 'whiskermenu', 'menu-width', px(450)
    yield 'whiskermenu', 'menu-height', px(500)
    for key, base in [('launcher-icon-size', 32), ('category-icon-size', 24)]:
        yield 'whiskermenu', key, nearest(base, (16, 24, 32, 48, 64, 96, 128))


def main():
    raw = query('xsettings', '/Xft/DPI').stdout.strip()
    dpi = int(raw) if raw.isdecimal() and int(raw) > 0 else 96
    # Resolve plugin IDs rather than overwriting a different plugin after edits.
    panel = subprocess.run(['xfconf-query', '-c', 'xfce4-panel', '-lv'],
                           capture_output=True, text=True)
    plugins = {}
    for line in panel.stdout.splitlines():
        fields = line.split()
        if len(fields) == 2 and fields[0].startswith('/plugins/plugin-') and fields[0].count('/') == 2:
            plugins.setdefault(fields[1], []).append(fields[0])
    for channel, key, value in dimensions(dpi):
        plugin = channel in ('whiskermenu', 'systray')
        targets = [('xfce4-panel', p + '/' + key) for p in plugins.get(channel, [])] if plugin else [(channel, key)]
        for ch, prop in targets:
            current = query(ch, prop)
            if current.returncode and not plugin:
                continue
            old = current.stdout.strip()
            if old == str(value) or (isinstance(value, int) and old == f'{value:.6f}'):
                continue
            args = ['-n', '-t', 'int'] if current.returncode else []
            query(ch, prop, *args, '-s', str(value)).check_returncode()


if __name__ == '__main__':
    main()
