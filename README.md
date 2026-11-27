# Dotfiles

## Android / Termux tools

On Android (including Termux), `chezmoi apply` enables chezmoi, Bitwarden CLI,
GitHub CLI (`http:gh`), Node.js with npm (`http:node`), and Codex (`http:codex`,
ARM64/x86_64 only). Node, GitHub CLI, and Codex
use checksum-pinned native packages from the official Termux repository,
extracted into mise. npm is checksum-pinned alongside Node in the same mise
installation. Linux/Windows keep their default Node backend.

Install native prerequisites first:

```sh
pkg install curl dpkg coreutils libc++ openssl c-ares libicu libsqlite zlib libffi
mise install http:node
mise install
```

The Node installer checks prerequisites and reports missing packages without
installing them automatically. Its wrapper removes inherited `LD_LIBRARY_PATH`
so Codex's private libc++ does not interfere with the native Termux runtime.
Other tools and the gcloud plugin override remain commented out on Android.
All platforms use the official `npm:@bitwarden/cli` package.

Codex uses a separately pinned Termux native build (currently 0.167.2); Linux
and Windows use the desktop npm version (currently 0.168.0). A normal
`npm:@openai/codex` install on Android skips its Linux-only binary dependency.
The old `@mmmbuto/codex-cli-termux` npm package is end-of-life; a third-party npm
wrapper is not needed. Install with `mise install http:codex`, verify
`mise which codex` and `codex --version`. To retain the old package while switching
its Termux command entry points, close old Codex sessions and run:

```sh
sh ~/.config/mise/termux-codex-switch.sh
hash -r
codex --version
codex
```

The switch stops the old Termux daemon and starts/verifies the mise-managed
daemon, so run it only after closing old Codex sessions. It preserves the npm package and backs up its original command symlinks
in `~/.local/state/mise-termux-codex-switch`. It redirects `codex` and
`codex-exec` to the home mise configuration; cleanup can be done later.
Existing Codex configuration and sessions remain in `~/.codex`.

For an existing `pkg` Node/npm installation, use the explicit migration task:

```sh
mise run termux:node:setup -- --check
mise run termux:node:setup -- --remove-native
```

Migration verifies mise Node/npm/npx and the installed Termux Codex launcher,
marks runtime libraries as manually installed, backs up the old runtime files,
and removes only the native `npm` and `nodejs` packages. It installs compatibility
launchers at the original Termux `bin/node`, `bin/npm`, and `bin/npx` paths so
hardcoded shebangs (including the Termux Codex launcher) continue working through
mise. The bridge selects the home configuration's native `http:node`; no Node
binary is kept in the Termux package prefix. On failure the task restores its
backup files and reports how to repair native package registration. It never runs
automatically. Future `pkg install nodejs`/`npm` overwrites these compatibility
launchers; rerun migration after deliberately switching back to native packages.

`mise run secrets:setup --check` validates the secrets manifest without vault
access. Run `mise run secrets:setup` interactively to log in and sync secrets.
The manifest also configures GitHub authentication, which requires Git and
GitHub CLI (`gh`). Mise installs `gh`; install Git with `pkg install git` before syncing.

## Multi-platform tools and tasks

### Cua Driver on Linux

After `chezmoi apply`, run `mise run cua:setup` to install Cua Driver through
the [official installer](https://cua.ai/cua-driver) if it is missing, install
`at-spi2-core` on Debian/Ubuntu when needed, and enable its systemd user service.
The installer leaves shell startup files and agent integrations alone. The task
requires a running systemd user manager, curl and Bash for a new installation,
and sudo for missing Debian accessibility packages. On other distributions,
install the distribution's AT-SPI service separately. The task imports the
current graphical environment and registers an XFCE login hook so the daemon
gets the display after login. Each run restarts the daemon, briefly interrupting
active Cua sessions; existing service or autostart files that differ are not
overwritten. A graphical login is required for desktop control.

Edit `.chezmoidata/mise.json` to update tool versions, default installation
platforms, task scripts, and task platform lists. Platform names are `linux`,
`windows`, and `android`. A tool's `platforms` list controls default installation,
not a claim that other platforms are unsupported. Tools excluded from Android
remain commented out for manual opt-in after checking compatibility.

Android backend overrides use the tool's `android` metadata and a template under
`.chezmoitemplates/mise/`. GitHub CLI, Node.js, and Codex use native Termux packages with
checksums per architecture; other platforms retain the default backend. Node
Android metadata also pins npm. After changing only the npm version/checksum,
run `mise install --force http:node` to rebuild the installation.

Tasks are rendered only on their declared platforms. Android includes secrets,
GitHub, shell, skills, and provider configuration tasks, plus native Node
migration, Debian XFCE provisioning, and Selkies. Cloudflared integration,
Docker setup/forwarding, and Azure mount-cache setup are Linux-only. Cleanup,
browser setup, Tailscale setup, and Codex startup are available
on Linux/Windows only. Android/Termux
Codex runs directly; its build disables automatic daemon startup. Installing a CLI
manually on Android does not enable unsupported desktop startup tasks.

Desktop task scripts also check platform support before invoking external tools,
using `dot_config/my-opencode/platform.mjs`. Keep these guards aligned with the
catalog when adding support. Linux-specific prerequisites such as systemd and
Debian/Ubuntu remain checked by each feature. Termux detection checks the OS,
`TERMUX_VERSION`, and `PREFIX` in both template and runtime code.

On Linux, `cloudflared:setup`, `cloudflared:restart`, `docker:forward:setup`,
and `tools:cleanup` require system Python 3 at `/usr/bin/python3`. They check
the interpreter before making changes and report installation instructions
if it is missing or cannot run. On Debian/Ubuntu, install it with
`sudo apt install python3`. Windows cleanup uses PowerShell and does not
require Python.

Run `node --test tests/mise-config.test.mjs tests/platform.test.mjs` to verify
the platform matrix. These tests render configuration without installing tools.
Apply the repository with `chezmoi apply` to activate changes on your machine.

## GitHub HTTPS credentials

After `chezmoi apply` and `mise install`, run `mise run github:setup` once
to migrate GitHub and Gist credential helpers to the stable Mise `gh` shim.
This repairs stale version-specific paths without sudo, Bitwarden access or
logging in again. It preserves other hosts and refuses custom GitHub helpers.
On Windows, install [Git for Windows](https://git-scm.com/download/win) first
and ensure `git.exe` is on PATH. If Git is missing, `github:setup` exits with
installation instructions; reopen the terminal after installing and rerun it.
Reruns are idempotent; normal tool upgrades/cleanup need no rerun because the
shim selects the active version. Keep Mise's shims installed (`mise reshim`).
`secrets:setup` uses the same integration after authenticating GitHub.
Do not subsequently run `gh auth setup-git`, which records a version-specific
executable path again. Test: `node --test dot_config/github/setup.test.mjs`.

SSH configuration uses `dot_ssh/modify_config` to preserve local options and
unrelated aliases. A leading managed block owns HostName, User and Port for
`soy`, `soy-wb` and `bull`, plus the Docker SSH fragment Include.
Local IdentityAgent settings (including Bitwarden sockets), IdentityFile and
other options survive `chezmoi apply`, whether in individual or shared Host
blocks. Old endpoint fields in single-alias blocks are removed; shared and
wildcard blocks remain intact, with managed endpoints taking precedence.
All managed endpoints use port 22; `soy-wb` connects directly to its own
Tailscale node rather than forwarding through `soy`.
Edit the modifier to change these managed endpoints. Test with
`node --test tests/ssh-config.test.mjs` (chezmoi and OpenSSH required).

Run `chezmoi init --source /absolute/path/to/this/checkout` (after `cd` into it;
effectively `$(pwd)` at that moment) to generate `~/.config/chezmoi/chezmoi.toml`
with `sourceDir` recorded by `.chezmoi.toml.tmpl`. Re-run that form after moving
the checkout; bare `chezmoi init` without a source generates no config.

Apply this checkout on Linux or Windows with `chezmoi apply --source /path/to/this/checkout`.
Targets retired from the source are removed on apply by listing them in
`.chezmoiremove`. Template files use LF line endings through `.gitattributes`,
including on Windows, so generated agent files and repeated SSH config merges
stay consistent across platforms.

## Restart the Cloudflare tunnel

After `chezmoi apply` and `mise install`, switch an existing, running system
`cloudflared.service` on Linux/systemd to the global Mise pin:

```sh
mise run cloudflared:setup
mise run cloudflared:restart
mise run tools:cleanup -- --apply
```

Setup consolidates the service-specific drop-ins under
`/etc/systemd/system/cloudflared.service.d/90-my-opencode.conf` without editing
the original service. It reloads systemd but does not restart the tunnel.
`cloudflared:restart` also performs this consolidation automatically, then
refreshes the executable path to the installed global Mise version and uses
`try-restart`. It verifies both running state and the new PID's executable
path/identity, not just `--version` or tunnel connectivity. This briefly
interrupts the tunnel. After upgrades, run
`mise install`, `cloudflared:restart`, then cleanup; old install paths are no
longer held by this service.

Both tasks refuse missing/inactive/non-running services. No tunnel installation,
enablement or token provisioning occurs. Existing command arguments are preserved
privately. All `.conf` drop-ins in the service-specific directory are preserved
and consolidated into the managed file; files outside that directory are left
untouched and require manual review, since they may be vendor or shared settings.
The task supports a single direct cloudflared `ExecStart` with `--no-autoupdate`;
modified managed files, unsafe permissions and unsupported command syntax require
manual review rather than guessing. The drop-in is root-owned mode 0600 because
arguments may contain credentials. A system lock serializes setup/restart. On
failure, the previous drop-ins are restored and the service recovery is attempted.
Recovery is best effort and cannot guarantee the tunnel comes back if its old binary or
configuration is broken. Non-root users authenticate with interactive sudo when
needed; passwordless sudo needs no prompt. No credentials or unit contents are
printed. Cleanup remains a separate, explicit operation.

Test without restarting anything: `node --test dot_config/cloudflared/restart.test.mjs`.

## OpenCode and OpenChamber

On Linux and Windows, `chezmoi apply` followed by `mise install` installs the
pinned OpenCode CLI and OpenChamber Web. Run `opencode` for the CLI or
`openchamber --port 3000` for the web interface.

## OpenCode plugin

The managed OpenCode V2 plugin `local.my-opencode` lives at
`dot_config/opencode/plugins/my-opencode/`. It registers `read_media` for images and PDFs and removes
`opencode_worktree_remove` from the tool registry;
it does not transform tools, agents, models, or providers.

Plugin code changes require an OpenCode server restart to take effect.
OpenCode 2.3.2 re-evaluates a local plugin's entrypoint when watched files
change, but transitive ESM imports stay cached in the Bun runtime, so edits to
imported modules can remain stale across reloads until the server restarts.
Chezmoi-managed agent files do not need a restart.

`chezmoi apply` owns all agent configuration through native OpenCode settings:
it generates the full user agent files from `agent-policy.json` in the plugin
directory and writes the title model plus `default_agent: build` into
`opencode.json`. The `general`, `explore`, and `reviewer` profiles are selectable
session agents; only `plan` remains disabled. Build denies
tools by default and allows `shell`, `edit`, `patch`, `skill`,
`external_directory`, `openchamber`, `openchamber_render`, `openchamber_secret`, and `read_media`. The plugin
does not configure agent permissions or re-enforce prompts, modes or models at runtime,
so manual changes to agent files take effect immediately and survive until the
next `chezmoi apply` regenerates them. To change policy, edit
`dot_config/opencode/plugins/my-opencode/agent-policy.json`. Apply removes the
old `openai-allowlist` entrypoint from the local plugin directory so it cannot
be auto-discovered alongside the new plugin; unrelated files in that old
directory are left untouched.

The auto-discovered `my-opencode` plugin stays implicit. Apply manages the
Muse plugin (`@rasyid_rafi/opencode-muse`), retires the Antigravity plugin
entries from `opencode.json`, and preserves unrelated plugins and other local
checkouts.

Test: `node --test tests/my-opencode-plugin.test.mjs tests/opencode-config.test.mjs`.

### Delegation through OpenChamber

The managed `openchamber-delegation` skill describes bounded handoffs, callback
delivery, and independent review. Request `explore` for discovery, `general`
for implementation, or `reviewer` for assessment. Each is a session agent
with model and permissions in `dot_config/opencode/plugins/my-opencode/agent-policy.json`.
Build orchestrates; it is never the delegated worker. Create each worker session
with the authorized named profile. If profile selection needs clarification,
ask before dispatch; if the profile is unavailable, report the blocker.

## Tool version cleanup

After `chezmoi apply`, preview unused older Mise installations on Linux or Windows:

```sh
mise run tools:cleanup
mise run tools:cleanup -- --dry-run
mise run tools:cleanup -- --apply
```

Preview is the default. Global configured versions must already be installed.
The helper protects global selections (including resolved ranges such as Node 24)
and versions required by any configuration Mise has tracked. Numeric releases
older than a globally selected, installed replacement are candidates; tools no
longer referenced by any tracked configuration are also candidates in all
installed versions. Unconfigured versions of tools that are still configured,
refs and prereleases are otherwise left alone. No config edits, upgrades, cache
sweeps, service restarts or process termination are performed.

On Linux, before uninstalling anything, the task performs a read-only `/proc` scan
using `sudo -n /usr/bin/python3` (root inspection is required even for preview).
The task first probes noninteractive sudo access. If authentication is needed,
it runs `sudo -v` with inherited terminal input/output so sudo asks for a password
interactively; the helper never reads the password. Passwordless sudo needs no prompt.
The scan checks executables, working directories, absolute arguments, mapped files and open files;
inode matching through each process root detects shared nspawn bind mounts too.
On Windows, PowerShell scans running processes once per check, matching executable
paths, loaded modules and absolute command-line paths against candidate installs.
It does not enumerate installation files or register them with Restart Manager.
No Python or sudo is needed. Visible executable/argument references from all
sessions protect candidates; module inspection focuses on the current interactive
session. Unrelated system/other-account processes do not block user cleanup.
Windows-enforced Antimalware Light protection distinguishes protected AV processes
without relying on their names. If inspection needs administrator access, setup
requests UAC once for a read-only scanner session, reused for all pre-removal
checks. The original account SID is retained and uninstall runs unelevated.
Unresolved processes owned by the current account still block removal. Progress identifies
each scan and candidate. Configuration and use are rechecked before removal.
Windows scanning does not inspect arbitrary open files, process working directories or Linux guests;
use Linux cleanup inside WSL for WSL installations.
Busy versions are skipped with tool/PID information only. Versions Mise does
not consider prunable are skipped unless the tool is absent from all tracked
configuration; unverifiable/symlinked install paths are always skipped.
Configurations and process use are checked again immediately before each explicit
`mise uninstall tool@version`. If one uninstall fails, other eligible versions are
still attempted. A summary reports removed, skipped and failed counts; uninstall
failures return a nonzero exit status after processing the remaining candidates.
Busy/protected skips alone are not errors. Authentication, inventory and process
inspection failures stop cleanup because eligibility cannot safely be established.

This is not an atomic transaction: processes/configs can change after preflight,
and a backend uninstall failure can leave that version partially removed. Run during
a quiet period; stop old services yourself first. Projects never tracked by Mise,
relative script arguments, future uses from an idle shell's PATH, and independent
guest installations are not covered. Run the task separately inside a guest to
clean its own Mise installations. The helper never scans or cleans cache storage.

Test: `node --test dot_config/tools-cleanup/setup.test.mjs`.

## Mise task reruns and cleanup

Setup tasks reconcile their documented, task-owned assets; rerun them after
updating the repo, saved settings, or generated secret values to refresh those
assets. A no-op rerun does not imply a runtime refresh: check each task's service
instructions. In particular, `cloudflared:restart` intentionally switches the
running executable and briefly interrupts the tunnel; `docker:forward:setup`
restarts only for changed or pending assets, otherwise it leaves a healthy
service running; `codex:setup` performs the lifecycle
actions named in their task descriptions.

Changed shell, Docker setup, and Rawroute targets may create private backups
before replacement. Backups can contain credentials and are retained for manual
recovery; no task automatically prunes them. Destructive cleanup is separate and
explicit: for example, `tools:cleanup` previews by default and only uninstalls
with `--apply`, while old Cloudflare binaries are eligible only after the
separate cleanup step. Reruns do not generically remove unrelated tools, services,
containers, caches, or user data.

## Optional agent skills

`ask-bun` and `ask-docker` are opt-in skills, adapted from the sibling
`ai-personal` repository. Their catalog lives in
`dot_local/share/my-opencode/optional-skills/`; `chezmoi apply` installs it at
`~/.local/share/my-opencode/optional-skills/` without activating any skills.
After applying the catalog and task assets:

```sh
mise run skills:list
mise run skills:install  # Select skills, project/global scope, then confirm
mise run skills:install -- ask-bun ask-docker --global
mise run skills:install -- ask-bun --project /absolute/path/to/project --dry-run
mise run skills:install -- ask-bun --project /absolute/path/to/project
```

Global links go into `~/.agents/skills/`; project links go into the selected
directory's `.agents/skills/`. The project directory must already exist.
Relative project paths use `MISE_ORIGINAL_CWD` when available, otherwise the task's
working directory; absolute paths are unambiguous. Interactive mode defaults to project scope
and asks for the directory (using `MISE_ORIGINAL_CWD` as a suggestion when present).
Noninteractive use requires explicit skill names and scope.

The installer validates the entire selection, skips correct existing links, and
refuses conflicting paths or symlinked `.agents`/`skills` parent directories.
`--dry-run` creates nothing. No sudo, downloads, AI requests, automatic dependency
installation, or Git configuration changes occur. Windows uses directory junctions,
which do not require Developer Mode or administrator privileges.

Links point to the deployed catalog, not the Git checkout: update with
`chezmoi apply`. Activation links remain local and are not managed by chezmoi.
Do not commit project links containing machine-specific absolute paths; optionally
exclude individual links through that project's `.git/info/exclude`. To deactivate,
remove only the chosen activation symlink, not its catalog directory.

The `ask-bun` and `ask-docker` skills require Python 3.10+ and internet access, use only the Python standard
library, and send questions to the respective public documentation AI service.
Do not include secrets in questions. Their scripts and original mocked tests were
ported from `ai-personal`; no live AI requests are needed to run these tests:

```sh
node --test dot_config/skills/setup.test.mjs
python3 -B -m unittest discover -s dot_local/share/my-opencode/optional-skills/tests
```

Run `mise run shell:setup` after `chezmoi apply` and `mise install` to install
portable Bash and optional Fish startup integration on Linux/macOS/Android (Termux), or PowerShell
and Git Bash integration on Windows. This is not a
bare-OS bootstrap: it assumes the repository's generated files and Mise are
available. Zsh and service/OS-wide environment setup are out of scope. No Codex,
model, credentials, network access, sudo, or AI requests are needed; setup never
runs implicitly. Use `mise run shell:setup -- --check` for a read-only structural
preflight, or `mise run shell:setup -- --dry-run` to preview planned file changes.
The check does not source startup files or secret values; it reports validators,
Fish config root, Bash login entrypoint, cache state, planned paths, and blockers.
Fish syntax/runtime checks run only when Fish is installed. Startup fixtures cover
bounded generic patterns; they do not certify any CachyOS-shipped defaults.

On Android/Termux, setup uses native Node.js, Bash and sh from the Termux PATH.
It preserves `$PREFIX/bin`, installs user startup hooks under `$HOME`, and
activates the Termux-installed Mise from PATH. Optional Fish uses the same user
`conf.d` hook. Native Node.js/npm are managed by mise (`http:node`); no system-wide
Termux profiles are modified. The task clears `LD_LIBRARY_PATH` for its Node
process to avoid inherited incompatible library paths.
The shared Bash/POSIX and Fish PATH finalizers discard missing mise Node/Codex
version directories and missing legacy Termux Codex npm directories. Existing
mise activation paths and unrelated custom entries retain their order. No tool
version paths need to be hardcoded in startup profiles; rerun `shell:setup` after
applying template changes.

On Windows, setup detects installed Windows PowerShell 5.1 and PowerShell 7 and
asks each executable for its current-user, all-hosts profile, including redirected
Documents locations. It preserves user content and installs an idempotent loader
with native Mise activation. Git Bash is detected from Git for Windows, never
through the WSL `bash.exe` launcher. Its interactive and selected login profiles
load the Windows hook, preserve customizations and activate Mise once per shell.
Only existing user `bin`, `.local/bin` and Windows Mise shims are added to PATH.
Optional custom hooks are `~/.config/shell/local.ps1` and `local.sh` respectively.
Windows Terminal needs no configuration; new tabs use their shell's startup hooks.

CMD integration is opt-in: `mise run shell:setup -- --cmd`. It installs a quiet
shim/PATH loader through user-scoped `Command Processor/AutoRun`, preserving the
original command and Registry value type. CMD uses Mise shims, without directory
change/prompt activation. `cmd /d` bypasses AutoRun. Check or preview CMD changes
with `--check --cmd` or `--dry-run --cmd`; neither writes files or Registry values.
Windows backups include previous profiles and the original AutoRun value/type,
restricted to your Windows account. Setup validates PowerShell and Bash syntax
before writing, and reports restrictive PowerShell execution policies without
changing them. A PowerShell profile encoded in UTF-16 is backed up byte-for-byte
and rewritten as UTF-8 with a BOM for PowerShell 5.1 compatibility.

Windows shells inherit the user environment saved by `secrets:setup`; loaders do
not copy secrets into profiles. Restart the parent terminal/launcher (or sign out
and back in) if it still has stale environment values. WSL shells use the existing
Linux setup, run inside each distribution. Windows setup does not manage WSL.

The installer backs up changed files privately under
`~/.local/state/shell-init-backups`, syntax-checks proposed files, and installs
idempotent hooks in `.bashrc`, `.profile`, and existing `.bash_profile` or
`.bash_login`. The shared environment is initialized before distro `.bashrc`
early-return guards; a separate PATH-only finalizer runs after profile/interactive
customizations so stock PATH prepends cannot leave duplicates or reverse the
baseline. Existing profile content is preserved. Only existing `~/bin`,
`~/.local/bin`, and Mise shims are normalized; unrelated PATH entries keep their
order and position around that baseline, and custom interactive PATH additions
remain effective. Mise activation is interactive-only. Generated secret values
replace unset, empty, or stale inherited values; a value already equal to the
latest generated secret is left unchanged. Setup reads secret names from the
manifest but never prints secret values.

Fish terminals use an installer-owned hook at
`$XDG_CONFIG_HOME/fish/conf.d/my-opencode.fish` (default
`~/.config/fish/conf.d/my-opencode.fish`) to source `~/.config/shell/env.fish`;
Fish user configuration is never edited. An in-home nondefault XDG config root is
supported. External or relative roots and unmanaged `my-opencode.fish` collisions
are refused before writes. The root is selected from `XDG_CONFIG_HOME` when setup
runs; rerun setup after changing that variable. Fish prompt-time finalization is
PATH-only, so secrets and cache hooks are not replayed.

Existing generated Bash exports are supported using names from the secrets
manifest. Secrets/cache helper reruns recognize installed integration.
Cache remains opt-in via `azure-mnt-cache:setup`; a marker or an active standalone
known cache loader preserves opt-in, while comments and inactive textual mentions
do not. Workboxes without opt-in remain unaffected.

Keep host-specific additions in `~/.config/shell/local.sh`. It is Bash-only and is
guarded from POSIX `sh` profiles; Fish-specific additions belong in Fish user
configuration. Custom absolute `BASH_ENV` hooks are preserved through a private
legacy wrapper when supplied in the task's invoking environment. A custom
`BASH_ENV` assignment inside a profile is refused for explicit migration.
`BASH_ENV` is inherited only by child noninteractive Bash processes that receive
it; this task cannot update already-running processes,
services, cron, GUI launchers, or clean Bash processes started without it. Ambiguous
conditional/inline loader migrations and unsupported startup customizations fail
explicitly instead of being guessed. Existing shared generated loaders require
review and `--replace-legacy-loader` (also supported with `--dry-run` and `--check`).
Templates in `dot_config/shell/templates` are the source of truth; rerun setup after
applying updates. Generated loaders are not chezmoi targets. Backups may contain
sensitive configuration; keep them private. Test without editing the real home:
`node --test dot_config/shell/setup.test.mjs dot_config/secrets/setup.test.mjs dot_config/azure-mnt-cache/setup.test.mjs`.

Run `mise run chrome:setup` after `chezmoi apply` for `browser-use`. Setup first
reuses a verified Chrome, Edge, Chromium, or Brave executable found on `PATH` or
at a small set of conventional Linux paths. The bounded `--version` check does
not launch a browser or verify CDP/headless support. Existing browsers skip
distro, architecture, apt, sudo, and network checks. Broken or unverifiable
launchers stop with an error rather than being silently replaced. Known Chrome,
Chromium, Edge, and Brave Flatpak apps are detected read-only; this task does not
launch/configure Flatpak browsers and will not install a native replacement over
one. Snap launcher paths are preserved, though their packaging/runtime may still
affect browser launch.

On Windows, setup detects existing Chrome, Edge, Chromium and Brave installations
through PATH, user/system installation directories and Registry App Paths. It
checks executable version metadata without launching a browser. If none is found,
it asks you to install a supported browser; it does not install one automatically.

Only when no browser is found on Linux does setup install Google Chrome Stable. This
fallback supports Debian-family Linux (Debian/Ubuntu IDs or exact Debian/Ubuntu
`ID_LIKE` tokens, including Linux Mint) on amd64; Windows, macOS, other
distributions and architectures fail explicitly. It requires root or sudo and
internet access, downloads Google's official `.deb` over HTTPS, and installs it
with apt, including dependencies. Google's package may configure its apt
repository for future updates. Setup does not launch Chrome, change browser
profiles, or run automatically during `mise install`.
Test host validation without installing anything:
`node --test dot_config/chrome/setup.test.mjs`.

### mpv with ModernZ

Run `mise run mpv:setup` on Linux to install mpv if needed and configure the
ModernZ on-screen controller from the official
[ModernZ releases](https://github.com/Samillion/ModernZ/releases). The task
supports apt, dnf, pacman, and zypper, and asks for sudo only when mpv needs to
be installed. It preserves unrelated `mpv.conf` settings and an existing
`modernz.conf`, replaces the earlier uosc files/config, and makes no changes or
downloads on subsequent runs once setup is complete. Windows, macOS, and
Android/Termux are not supported. Test without system changes with
`node --test tests/mpv-setup.test.mjs`.

### T3 Code

Install the T3 Code CLI separately on Linux and make `t3` available on your
PATH. Run `t3` to start its server and open the web app. See https://t3.codes
for installation details.

After initial service setup with `t3 up`, run `mise run t3code:setup` to start or
restart the Linux service with the managed shell environment and secrets loaded
at each start. The service wrapper looks for `t3` on its PATH, starting with
`~/.local/bin`. Pairing remains a
separate manual step (`t3 pair` or `t3 pair --tailscale`). After syncing secrets,
restart the service to pick up changes.

Run `mise run t3code:uninstall` to stop, disable, and remove the Linux user
service and remove its Tailscale HTTPS route to `http://127.0.0.1:3773`.
Tailscale stays installed and running. The task works even if the `t3` CLI
has already been removed.

### Muse Code

Run `mise run muse:setup` on Linux or Windows to install or update Meta's
[Muse Code](https://dev.meta.ai/docs/muse-code) CLI through its official
installer. The task downloads the installer instead of piping it to a shell,
installs into `~/.local/bin`, and sets `MUSE_NO_MODIFY_PATH=1` so the installer
does not edit your shell profiles; `shell:setup` already puts that directory on
PATH. It then verifies `muse --version`. On Linux it warns when `bwrap` is
missing, because Muse Code's sandbox needs it.

The installer follows the `muse-stable` channel and the launcher self-updates, so
mise does not pin the version and the task upgrades to the latest release on each
run. The binary is a native install in `~/.local/bin` (not a mise-managed tool),
so it is not listed by `mise ls` and is not touched by `tools:cleanup`.
Android/Termux is not supported by the task.

The first `muse` run needs a Meta account: sign in through the browser, or set
`META_API_KEY` for headless/SSH use. Credentials are not managed by the task.

Test without installing: `node --test dot_config/muse/setup.test.mjs`.

## Shared native Docker

`docker:setup` is opt-in and deterministic, for Debian/Ubuntu amd64/arm64.
`docker:setup`, `docker:forward:setup` and `azure-mnt-cache:setup` explicitly exit
with a not-supported error on Windows before running commands or modifying files.
Mise runs the task but does not manage Docker binaries. The host uses native
Docker CE; a systemd-nspawn guest installs only native CLI, Compose and Buildx
packages from Docker's official apt repository. No TCP daemon or shared socket.

```sh
# On the host, as the intended Docker user:
mise run docker:setup -- --role host --dry-run
mise run docker:setup -- --role host

# On the guest; supply independently verified SSH trust and an authorized key:
mise run docker:setup -- --role guest --context soy --ssh-alias soy-docker \
  --host 172.16.0.4 --user soy \
  --identity "$HOME/.ssh/id_ed25519_docker_soy" \
  --known-hosts "$HOME/.ssh/known_hosts_docker_soy" --migrate-mise
```

The address above is the existing soy endpoint, not a universal default. Guest
settings are saved locally, so later runs need only `--role guest`. Use
`--dry-run` before changing anything. `--migrate-mise` backs up link metadata and
removes only obsolete mise Docker shims/plugin symlinks; installed mise Docker
directories are archived outside active mise installs for rollback and to prevent
`mise reshim` from recreating old shims. Remove active Docker mise selections explicitly
first. Unrecognized executables, conflicting contexts, package stacks and SSH
settings stop setup rather than being silently replaced.

Existing healthy packages are not upgraded, and a healthy daemon is not restarted.
Missing packages require sudo. For noninteractive provisioning an administrator
can run the installed Node helper as root with `--role guest --packages-only`,
then run the normal task as the guest user. Host users must be explicitly authorized
to access Docker by an administrator; group changes require a new login. Setup
does not silently grant docker-group membership or relax socket permissions.

Guest SSH fragments live under `~/.ssh/config.d/docker-*.conf`, included by the
repo's SSH config and not overwritten by chezmoi. Host keys are never accepted
automatically and private keys are never copied/generated. For a new dedicated
Ed25519 key, authorize its **public** key on the host with
`--role host --authorize-key /absolute/path/to/key.pub`. Existing authorization
with different options requires manual review. Authorization keeps the forced command
`/usr/bin/docker system dial-stdio` and allows SSH port forwarding by default;
Docker access is still **host-root equivalent**. Rerunning host setup with
`--authorize-key` upgrades this task's older `restrict` authorization, preserving
unrelated keys. Rerunning guest setup upgrades its managed SSH fragment to allow
forwarding and configure SSH connection reuse (`ControlMaster auto`, a private
control socket, and a 10-minute persist window); pinned trust, identity and endpoint
are preserved. This lets repeated Docker CLI calls share an authenticated SSH
connection. A healthy daemon does not need to be restarted for these SSH changes.

Verification uses the actual Docker context transport, not a generic SSH shell
(forced-command keys intentionally do not provide one). Unset Docker endpoint
and config environment overrides before setup. A builder override is reported
and preserved, not mistaken for a daemon endpoint. Bind mounts resolve on
the **host filesystem**, and published ports belong to the host. Guest workspaces
are not automatically shared. Run storage migration on the Docker host; SSH guests continue using that daemon.

Test without installing packages or changing Docker:
`node --test dot_config/docker-setup/setup.test.mjs`.

### Guest localhost forwarding

After `chezmoi apply` and guest `docker:setup`, opt into automatic localhost
access to the remote Docker host's published TCP ports:

```sh
mise run docker:forward:setup -- --dry-run
mise run docker:forward:setup
systemctl status workbox-docker-forward.service
journalctl -u workbox-docker-forward.service -f
```

The task reads `~/.config/docker-setup/state.json`, validates the saved SSH
context, and installs a system service running as the invoking guest user.
There are no hardcoded host IPs, SSH aliases, or application port numbers.
Run as that user; sudo is requested only for installation/service management.
Dry run validates prerequisites and connectivity without writing files.

The service discovers published ports roughly every 120 seconds (2 minutes),
creates IPv4 and IPv6 loopback SSH forwards, retries failed tunnels, and removes forwards
when publications disappear. Docker discovery failures preserve existing
tunnels until a complete snapshot is available. It starts at boot without
requiring an interactive login. SSH keys must work noninteractively with the
guest's existing pinned host trust and forwarding authorization.

Rerunning setup updates the existing `workbox-docker-forward.service` and
`/usr/local/libexec/workbox-docker-forward.py` in place, including installations
created before this task. An activation marker is persisted before changing
assets and cleared only after daemon-reload, restart and active-state verification;
if activation fails, rerunning retries it even if the files now match. A healthy
unchanged service is enabled/checked without restart; an inactive one is started.
After a repo update, apply chezmoi and rerun setup to update the installed service
code. The task does not restart Docker or modify containers.

Scope is **all running containers on the saved context**, regardless of which
machine created them. Only published TCP ports (`-p`, Compose `ports`) are
forwarded: `EXPOSE` alone, UDP, and host-network listeners are not discovered.
Occupied local ports are reported and left untouched, then retried; remove
obsolete manual tunnels separately if the service should manage their ports.
Low ports such as 80/443 depend on the guest user's bind permissions. Multiple
distinct host addresses publishing the same port cannot be represented by one
localhost port; discovery reports that ambiguity instead of picking a target.
Each loopback forward currently uses its own SSH connection. Logs distinguish
tunnel startup from application readiness; verify your app with curl.

To disable forwarding: `sudo systemctl disable --now workbox-docker-forward.service`.

Tests (no sudo, Docker changes, or service installation):

```sh
node --test dot_config/docker-forward/setup.test.mjs
python3 -m unittest discover -s dot_config/docker-forward -p '*_test.py'
```

Run `mise run azure-mnt-cache:setup` to move **all native Docker-managed persistent
storage** to `/mnt/docker-storage` and enable shell caches at
`/mnt/cache/<username>`. Preview with `mise run azure-mnt-cache:setup -- --dry-run`.
Apply the repo first so the task and its `docker-storage.mjs` helper are installed.

On a native Linux/systemd host, the task uses sudo and requires `rsync`
(`sudo apt-get install rsync` on Debian/Ubuntu). It supports the standard
`/var/lib/docker` and `/var/lib/containerd` layout. Both trees are moved to
`/mnt/docker-storage/docker` and `/mnt/docker-storage/containerd`, then mounted
back at their original paths using systemd bind mounts. Images, writable layers,
Docker volumes (including databases), container logs and the default builder's
cache therefore reside on `/mnt`. Runtime binaries/configuration stay on root;
sockets and running-process state stay in `/run`.

Migration stops running containers, Docker and containerd, transfers files with
permissions, owners, hardlinks and extended attributes, and restarts the same
containers. It verifies daemon identity, container/image/volume inventories and
running containers before marking the migration complete. Source files are removed
after successful transfer: **no rollback copy or old storage tree is retained**.
An interrupted migration is resumed forward by rerunning the task. Do not remove
`/etc/azure-mnt-cache/docker-storage.json` or the destination while it is unfinished.
Completed reruns verify mounts without restarting workloads. Mount dependencies
and separate markers prevent premature boot binds: the mount units require
`/mnt/docker-storage/.transfer-complete`, written only after both transfers finish
and are synced, while Docker/containerd services also require `.ready`. A reboot
during copying therefore leaves the original `/var/lib` trees visible instead of
hiding unmoved files under a partial bind. If an older unfinished migration is
already bound without a recorded completed transfer, setup refuses to bless it;
stop the services and inspect/unmount the underlying paths safely before rerunning.
Completed state from the previous unit format is verified before its boot guards
are upgraded.

Existing unrelated systemd overrides are preserved. Conflicting storage mounts,
custom containerd roots/services, non-Docker containerd namespaces, auto-remove or
paused/restarting containers, and external bind/volume data outside `/mnt` require
explicit resolution before migration. Project bind mounts are not relocated by
this task; their backing filesystem must already be `/mnt`. The host setup verifies
that condition, including binds exposed at other paths such as `/home/soy-wb/projects`.

For an SSH Docker context (for example `soy-wb` using `ssh://soy-docker`), the task
checks the remote daemon and installs only the guest's shell cache integration.
It never migrates guest system directories or installs a guest daemon. Run the
migration once on the host: all clients then use its relocated storage.

The previous `azure-mnt-cache` Buildx builder and its data already on `/mnt` remain
usable; the task no longer creates or forces that special builder. Ordinary Docker
builds also use `/mnt` after host migration. Shell loaders clear the old managed
`BUILDX_BUILDER` override and the task removes its obsolete `docker-enabled` marker.

Shell integration still falls back to home cache paths when `/mnt` is unavailable;
it does not migrate old language/package caches. Fish requires `shell:setup` and
loads `cache.fish`; Bash/Zsh load `cache.sh`. Open a new shell after applying the
updated loaders. Test with
`node --test dot_config/azure-mnt-cache/setup.test.mjs dot_config/shell/setup.test.mjs`
(the real isolated file-transfer test requires rsync).

Run `mise run desktop:setup` after applying chezmoi to install and configure XFCE
on a Debian or Ubuntu Linux host. It applies the Mint theme, wallpaper, panel,
shortcuts, fonts, XFCE screensaver and screen locking, Thunar archive support,
and Asia/Jakarta system timezone.
It honors the existing one-time preset marker to preserve desktop customizations.
On each desktop setup run, the XFCE PulseAudio panel plugin is configured to
show an on-screen volume indicator for the keyboard volume keys, including on
existing profiles created with notifications disabled.
On a host with a connected display and graphical seat, XFCE is available in the
existing display manager or through LightDM at the next graphical boot. A headless
host skips display manager setup.

On the Ice Lake **Infinix INBOOK X2** (EM_IC325, ESSX8326), setup also installs
the pinned, SHA-256-verified [speaker fix](https://github.com/rasyidrafi/inbook-x2-audio/releases/tag/v1.0.0)
and enables its per-user login recovery timer. This unsigned release targets
Debian 13 amd64 kernel `6.12.118+deb13-amd64` only. Other boards, kernel ABIs
and Secure Boot systems are skipped; setup never builds, reloads a module or
reboots the laptop. See the [driver guide](https://github.com/rasyidrafi/inbook-x2-audio#readme)
for verification, kernel upgrades and rollback.

XFCE Custom DPI also scales the Mint panel, tray, Whisker menu, desktop icons,
Thunar sidebar, and selected XFWM distances. The panel and its icons use
32/20 px at 96 DPI, 40/25 px at 120 DPI, and 48/30 px at 144 DPI. The watcher
recalculates these sizes at login and when DPI changes. On Xorg, local
libinput touchpads default to tap-to-click and natural scrolling. On a local
desktop with a backlight, setup also installs `pkexec` so XFCE Power Manager's
privileged backlight helper can adjust screen brightness.

Run `mise run selkies:setup` for a separate browser-accessible XFCE session.
On Linux it runs the desktop setup first, then adds Selkies. It requires Debian
12/13 or Ubuntu 24.04/26.04 (amd64/arm64), curl, sudo for missing packages, and
a systemd user session. Open **http://127.0.0.1:8443**.
On the packaged 2.2.1 client, choose **Gaming Mode** for its usual keyboard
capture with normal, absolute mouse input. Automatic pointer lock is disabled;
ordinary Fullscreen is unchanged. When Chrome grants keyboard lock, tap Esc
for the remote app and hold Esc to leave fullscreen.
The service serves a user-local copy; unknown client builds use stock behavior.
In Selkies, **Scale UI** updates XFCE DPI. The shared desktop watcher handles
the panel and other XFCE dimensions.
From another machine, run `ssh -N -L 8443:127.0.0.1:8443 user@host`, then open
the same URL locally. Selkies listens only on IPv4 loopback and explicitly
disables authentication: any local user can control the desktop. Setup restarts
a running session only when the installed service definition changes.
For logs: `journalctl --user -u selkies-desktop.service`.

On Linux, run `mise run selkies:uninstall` from SSH or another independent
session to stop and disable Selkies, purge its system-wide package, and remove
the invoking user's Selkies service and generated web/session data. This ends
any active Selkies session, but preserves XFCE, its settings, and other desktop
packages. The chezmoi-managed Selkies setup scripts remain available for reuse.

On Android/Termux (ARM64 or x86-64), run these after applying chezmoi:

```sh
mise run termux:xfce:setup
mise run selkies:setup
```

The first task creates a Debian 13 PRoot container named `my-opencode-xfce`
and applies the same XFCE preset as Linux, including the Mint theme, wallpaper,
fonts, panel, and shortcuts. Set `CRD_MINT_THEME=light` on the first run to use
the light preset. The second task installs Selkies and starts a detached
session at **http://127.0.0.1:8443** on the phone. Both tasks run without Android
root. Android can stop the Termux process in the background. Rerun
`mise run selkies:setup` to start it again. Use `proot-distro ps` to find the
session PID and `proot-distro kill PID` to stop it. The guest log is at
`/home/desktop/.local/state/selkies-desktop/session.log`.

On Debian or Ubuntu amd64, run `mise run desktop:setup` for the shared XFCE
desktop, then `mise run crd:setup` to install Chrome Remote Desktop. CRD setup
starts the XFCE panel, desktop, and window manager directly, bypassing `xfce4-session`.
It upgrades the old stock launcher, preserves custom launchers, and never restarts an active CRD session.
For a new host, open https://remotedesktop.google.com/headless, authorize it, and
run the Debian Linux command Google provides in an interactive terminal; choose
a PIN when prompted. For an existing registered host, setup starts the stopped
service. CRD setup does not install or modify the shared desktop configuration.
To retire an installed CRD host, use `mise run crd:uninstall` from Selkies or SSH,
not the CRD session being removed. It purges the machine-wide CRD package (ending
CRD access for all users) and removes only the invoking user's local registrations,
paired clients and stock session launcher. Custom launchers and other users' files
are preserved. It does not autoremove packages, uninstall Chrome, remove the shared
desktop helpers under `~/.config/chrome-remote-desktop`, or restart Selkies.

**Shared XFCE provisioning:**
Every setup run also installs missing `thunar`, `thunar-archive-plugin`,
`xarchiver`, and `7zip` packages. This
adds **Extract Here** and **Extract To…** for `.7z` archives in Thunar. Repeated
runs skip archive installation when these packages are already installed.
Reopen Thunar after the first installation to load the plugin; setup leaves
open file manager windows alone.
On Debian 13 amd64, `desktop:setup` installs the checksum-verified release of
the [Screenshooter fork](https://github.com/rasyidrafi/xfce4-screenshooter)
with remembered actions. Other supported systems use the distro package.
Setup binds **Ctrl+Shift+S** to select an area and immediately copy it to the
clipboard, independent of Screenshooter's GUI preference. It also binds **Super**
to Whisker Menu. Later runs ensure both bindings and preserve unrelated shortcuts.
An XFCE autostart helper refreshes panel space reservations at login and after
screen-size changes, working around stale work areas during CRD's “Resize to
fit” with high-DPI mode off or on. It preserves panel sizes, does not force a
resolution or DPI, and does not restart CRD. After applying chezmoi, run
`mise run desktop:setup`: it installs/repairs the autostart entry on every run and
starts the helper immediately when run inside the graphical session (`DISPLAY`
set), otherwise at the next XFCE login. A per-display lock prevents duplicates.
Every setup run also maintains one marked block in `~/.config/gtk-3.0/gtk.css`
to widen GTK-backed Chrome PWA caption buttons while keeping Chrome's own frame.
Unrelated user CSS is preserved, and the original CSS is backed up once under
`~/.local/state/crd-mint/gtk.css-before-titlebuttons`. The selector targets
Chromium's synthetic GTK headerbar nodes (`.chromium`), covering browser and
PWA headerbars without changing Thunar's buttons. Reopen Chrome/PWAs to load
it; setup never closes them.
Button spacing matches the bundled Mint XFWM theme's 32-pixel center-to-center
distance (26-pixel GTK button plus Chromium's 6-pixel gap).
Setup also installs Liberation, DejaVu, Noto (including CJK) and color emoji fallback fonts and sets XFCE Terminal to
`Ubuntu Mono 10` with system-font inheritance disabled. This avoids generic
`Monospace` resolving to a proportional font on minimal desktops. It updates
both terminalrc and live xfconf settings, preserves other terminal settings,
backs up the original terminalrc once, and skips unchanged settings on reruns.
It also sets `xfce4-terminal` as XFCE's default terminal emulator, preserving
other helper preferences; this avoids a broken system fallback such as Zutty
preventing Thunar's **Open Terminal Here** action from working.
It also maintains `~/.config/fontconfig/conf.d/10-crd-monospace.conf` (under
`XDG_CONFIG_HOME` when set), making generic `monospace` resolve to Ubuntu Mono
and `sans-serif` to Ubuntu, including in browser applications.
Relaunch the browser after setup to clear its cached font selection.
These desktop fixes also run when CRD is already active; missing terminal fonts
may require sudo, but CRD and existing terminal sessions are never restarted.
Every Linux desktop setup run also ensures the machine's system timezone is
`Asia/Jakarta` (WIB, UTC+7). It uses sudo only when a change is needed, verifies
the result, and does not restart CRD or change the actual system clock time.
It also installs PipeWire, WirePlumber, ALSA's PulseAudio plugin and audio
utilities for CRD's per-session audio forwarding. Installing audio support in an
already running session takes effect after the CRD service is restarted; setup
itself never restarts an active session.
For a new XFCE profile it also installs Mint-Y icons, Whisker Menu, a cursor
theme and XFCE Terminal. It uses the official Mint 22.3 XFCE settings for the
panel, window manager, desktop, terminal and notifications, with the official
Mint-Y-Dark-Aqua theme, Mint wallpaper, and Ubuntu fonts installed locally. The
menu uses a Debian logo and generic launchers. The panel uses Mint's Status Tray,
notification, XApp, power manager, audio and clock ordering. On Debian 13 and
Ubuntu 24.04 amd64, setup installs the checksum-pinned Mint 22.3 XApp package
when it is not available from configured repositories; unsupported systems
retain the XFCE status tray. It also installs the XApp watcher when available.
The first setup backs up an existing XFCE
profile before initializing the preset; later runs preserve user changes and
repair missing theme assets. A running CRD session is never restarted or reset
by setup; the targeted desktop fixes above still apply. An existing session can
be updated explicitly by running `sh ~/.config/chrome-remote-desktop/mint-assets.sh`
and `python3 ~/.config/chrome-remote-desktop/apply-mint-live.py`; this backs up
the previous XFCE configuration and restarts only the panel.

Both `Mint-Y-Dark-Aqua` and its light counterpart `Mint-Y-Aqua` are installed
locally, including on an already running host. Dark remains the default. To use
light for a **first-time preset initialization**, run
`CRD_MINT_THEME=light mise run desktop:setup` after applying chezmoi. This option
does not overwrite an existing preset or change an active session. For an
existing desktop, select `Mint-Y-Aqua` in XFCE **Appearance** and **Window
Manager** settings; choose `Mint-Y-Dark-Aqua` to switch back. Installing assets
may require internet access even when CRD is already running. The explicit
`apply-mint-live.py` command above reapplies the dark preset.

Run `mise run codex:setup` after applying chezmoi and installing tools with Mise
to start the native Codex app-server daemon, or restart it if already running.
This supports Linux and Windows. The task is disabled on Android/Termux because
its native Codex build does not support this packaged daemon setup.
This briefly interrupts an existing daemon. Check its status and versions with
`codex app-server daemon version`.
The Codex startup task supports Windows npm `.ps1` and `.cmd` launchers.
It requires the CLI on PATH; run `mise install` and `mise reshim` first.

Run `mise run openchamber:setup` to enable and start the native startup service
on port 3000.

Run `mise run openchamber:uninstall` to disable and remove the native startup
service and stop the OpenChamber instance on port 3000. Run it from a terminal
outside OpenChamber, as the user who started the service and within the same
system or container. The task preserves the package, settings, and user data.

If mise or its tools have been removed, run the installed script directly.

- Linux `bash ~/.config/services/openchamber-uninstall.sh`
- Windows `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$HOME/.config/services/openchamber-uninstall.ps1"`

This is a chezmoi source directory. Its `dot_codex/modify_config.toml` template
updates `~/.codex/config.toml` in place: it enforces the Rawroute defaults while
retaining other Codex settings, including project trust entries and Windows
sandbox preferences. Codex can continue to add unrelated settings without those
being discarded on the next `chezmoi apply`.
The model defaults to `gpt-6-luna` only when the `model` field is absent, and
reasoning effort defaults to `xhigh` only when `model_reasoning_effort` is absent.
Existing values for both fields are preserved, including during Rawroute switches.

OpenCode's global config is `~/.config/opencode/opencode.json`. Its
`dot_config/opencode/modify_opencode.json` template updates the separate Rawroute provider while retaining unmanaged root settings.
OpenAI uses OpenCode’s built-in configuration: no custom routing, API-key
reference, model limits, or model allowlist is installed. Apply removes existing
`openai` overrides from both `provider` and `providers` to retire the old settings.
Rawroute switches use the same merge.
Per-agent files are generated from `agent-policy.json` on every apply, including
their frontmatter and system prompts, and the plugin does not re-enforce any of
it at runtime: manual changes survive until the next apply regenerates the
files. The title model and `default_agent` in `opencode.json` are generated
from that file too. Title uses
`rawroute/gpt-base`. Build is the default primary agent and inherits the session
model. Explore, General, and Reviewer use their profile models. Plan is disabled.

The retired RawRoute models `step-5-preview`, `atria-dawn`, and
`deepseek-v4.1-flash-1017` are removed from existing configs on apply.

RawRoute also exposes three stable GPT gateway aliases: `gpt-base` (GPT Base,
1,000,000 context), `gpt-core` (GPT Core, 640,000 context), and `gpt-peak`
(GPT Peak, 400,000 context). Each has a 128,000-token output limit. The backend
can change which OpenAI model each alias resolves to without changing the
OpenCode model IDs. RawRoute also exposes `base-alpha` (Base Alpha), `base-beta`
(Base Beta), and `base-charlie` (Base Charlie), each with a 1,000,000-token
context, a 128,000-token output limit, and text, image, and PDF input.
OpenCode renders its provider metadata from `.chezmoidata/rawroute.json`.

Verify with `node --test tests/opencode-config.test.mjs dot_config/rawroute/setup.test.mjs`.

### Rawroute endpoint switch

Each task updates Codex (`~/.codex/config.toml`) and OpenCode
(`~/.config/opencode/opencode.json`)
to use the same RawRoute endpoint and API key variables.

| Task | Base URL variable | API key variable |
| --- | --- | --- |
| `mise run provider:default` | `RAWROUTE_BASE_URL` | `RAWROUTE_API_KEY` |
| `mise run provider:local` | `RAWROUTE_LOCAL_BASE_URL` | `RAWROUTE_LOCAL_API_KEY` |

The secrets manifest maps each variable to the password field of a Bitwarden
login item with the same name. Run `chezmoi apply` to install the tasks, then
run `mise run secrets:setup` and open a new initialized shell to use the apps.

```sh
mise run provider:local -- --dry-run
mise run provider:local
mise run provider:default
```

Codex stores the selected base URL from the environment when you apply or
switch modes. If the URL is empty or unset, the command warns and writes a
`{env:VARIABLE_NAME}` marker. Reapply once the URL is available so Codex can
connect. OpenCode resolves the URL reference at runtime.

Both templates read the same marker, `~/.config/rawroute/local-enabled`.
The switch creates private backups under `~/.local/state/rawroute-backups` and
restores all three configs and the previous markers if applying or validating the
configs fails. `--dry-run` checks source ownership without applying changes.

The applied `source.json` records the chezmoi source used to install the task.
If the checkout moves, reapply the task assets or pass
`--source /absolute/path/to/checkout`.

Apply this source with `chezmoi apply`. The TOML is parsed and re-serialized, so
formatting and comments may change. Tables use flat section headers without
extra nesting indentation or redundant parent sections. Formatting is checked
against the parsed data; unusual whitespace-sensitive values retain the original
encoder formatting when needed. All other TOML values are retained; the
literal `experimental_bearer_token` under `model_providers.rawroute` is removed.
If reviewing a diff from a config that still has a literal token, avoid printing
or sharing the removed line.
