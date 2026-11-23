"""Replace only the known Mint launcher/tasklist block; never reset a custom panel."""
import os
from pathlib import Path
import subprocess


def query(*args, optional=False):
    result = subprocess.run(['xfconf-query', '-c', 'xfce4-panel', *args],
                            text=True, stdout=subprocess.PIPE, check=not optional)
    return result.stdout.strip() if result.returncode == 0 else ''


def configure():
    prop = '/panels/panel-1/plugin-ids'
    ids = [line for line in query('-p', prop).splitlines() if line.isdecimal()]
    names = [query('-p', '/plugins/plugin-' + i) for i in ids]
    migrate = 'docklike' not in names
    if migrate:
        block = ['3', '4', '5', '6']
        start = next((n for n in range(len(ids)) if ids[n:n+4] == block and
                      names[n:n+4] == ['launcher'] * 3 + ['tasklist']), None)
        if start is None:
            print('Custom panel preserved. Add Docklike Taskbar via Panel Preferences if desired.')
            return
        for i, item in zip(block, ['browser.desktop', 'terminal.desktop', 'files.desktop']):
            values = query('-p', f'/plugins/plugin-{i}/items').splitlines()
            # xfconf-query puts a localized header and blank line before arrays.
            if '' in values:
                values = values[values.index('') + 1:]
            if values != [item]:
                print('Custom launcher preserved; not migrating the panel.')
                return
        used = set(query('-l').splitlines())
        num = next(i for i in range(15, 65536) if f'/plugins/plugin-{i}' not in used and not rcfile(str(i)).exists())
        instance = str(num)
    else:
        instance = ids[names.index('docklike')]
    rc = rcfile(instance)
    rc.parent.mkdir(parents=True, exist_ok=True)
    if not rc.exists():
        browser = 'google-chrome' if Path('/usr/share/applications/google-chrome.desktop').exists() else 'xfce4-web-browser'
        with rc.open('x') as f:
            f.write(f'[user]\nungroupWindows=true\nmiddleButtonBehavior=1\npinned={browser};thunar;xfce4-terminal;\n')
    if migrate:
        query('-p', '/plugins/plugin-' + instance, '-n', '-t', 'string', '-s', 'docklike')
        new = ids[:start] + [instance] + ids[start+4:]
        query('-p', prop, *[arg for i in new for arg in ('-t', 'int', '-s', i)])


def rcfile(instance):
    return Path(os.environ.get('XDG_CONFIG_HOME') or Path.home() / '.config') / 'xfce4/panel' / f'docklike-{instance}.rc'


if __name__ == '__main__':
    configure()
