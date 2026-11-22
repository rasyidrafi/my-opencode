"""Build a user-owned web root without modifying Selkies' packaged client."""
import hashlib
import shutil
import tempfile
from pathlib import Path


DIGEST = '6d40a13fe9ca9751047c6b138bd0d89fb925003abfbce79ddfcab7ab7d7b6192'
# Use the working Gaming Mode keyboard path; skip only its two automatic
# pointer-lock paths (entry gesture and subsequent fullscreen/click retries).
PATCHES = {
    'L.isFirefox()?e():this._lockOnGesture(e)': 'e()',
    '_armPointerLock(t=0,n=0){this.inputAttached': '_armPointerLock(t=0,n=0){return;this.inputAttached',
}


def prepare(src, state):
    core = (src / 'selkies-core.js').read_bytes()
    target = src
    state.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=state) as temp:
        stage = Path(temp)
        if hashlib.sha256(core).hexdigest() == DIGEST and all(core.count(k.encode()) == 1 for k in PATCHES):
            patched = core
            for old, new in PATCHES.items():
                patched = patched.replace(old.encode(), new.encode())
            target = state / hashlib.sha256(patched).hexdigest()
            if not target.exists():
                shutil.copytree(src, stage / 'client', ignore=shutil.ignore_patterns('__pycache__'))
                (stage / 'client/selkies-core.js').write_bytes(patched)
                (stage / 'client').rename(target)
        else:
            print('Unrecognized Selkies client; using stock fullscreen behavior.', flush=True)
        (stage / 'current').symlink_to(target)
        (stage / 'current').replace(state / 'current')


if __name__ == '__main__':
    from importlib.resources import files
    prepare(Path(str(files('selkies.selkies_web'))), Path.home() / '.local/share/selkies-desktop/web')
