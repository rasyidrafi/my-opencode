# Dotfiles

## GitHub HTTPS credentials

After `chezmoi apply` and `mise install`, run `mise run github:setup` once
to migrate GitHub and Gist credential helpers to the stable Mise `gh` shim.
This repairs stale version-specific paths without sudo, Bitwarden access or
logging in again. It preserves other hosts and refuses custom GitHub helpers.
Reruns are idempotent; normal tool upgrades/cleanup need no rerun because the
shim selects the active version. Keep Mise's shims installed (`mise reshim`).
`secrets:setup` uses the same integration after authenticating GitHub.
Do not subsequently run `gh auth setup-git`, which records a version-specific
executable path again. Test: `node --test dot_config/github/setup.test.mjs`.

SSH configuration uses `dot_ssh/modify_config` to preserve local options and
unrelated aliases. A leading managed block owns HostName, User and Port for
`soy`, `soy-wb`, `bull` and `bull-wb`, plus the Docker SSH fragment Include.
Local IdentityAgent settings (including Bitwarden sockets), IdentityFile and
other options survive `chezmoi apply`, whether in individual or shared Host
blocks. Old endpoint fields in single-alias blocks are removed; shared and
wildcard blocks remain intact, with managed endpoints taking precedence.
The ordinary host ports are explicitly 22; workbox ports are 2222.
Edit the modifier to change these managed endpoints. Test with
`node --test tests/ssh-config.test.mjs` (chezmoi and OpenSSH required).

Run `chezmoi init --source /absolute/path/to/this/checkout` (after `cd` into it;
effectively `$(pwd)` at that moment) to generate `~/.config/chezmoi/chezmoi.toml`
with `sourceDir` recorded by `.chezmoi.toml.tmpl`. Re-run that form after moving
the checkout; bare `chezmoi init` without a source generates no config.

## Restart the Cloudflare tunnel

After `chezmoi apply` and `mise install`, integrate an existing, running system
`cloudflared.service` on Linux/systemd once, then switch it to the global Mise pin:

```sh
mise run cloudflared:setup
mise run cloudflared:restart
mise run tools:cleanup -- --apply
```

Setup adds `/etc/systemd/system/cloudflared.service.d/90-my-opencode.conf` without
editing the original service. It reloads systemd but does not restart the tunnel;
reruns are idempotent. Restart requires setup, refreshes the executable path to
the installed global Mise version, then uses `try-restart`. It verifies both
running state and the new PID's executable path/identity, not just `--version`
or tunnel connectivity. This briefly interrupts the tunnel. After upgrades, run
`mise install`, `cloudflared:restart`, then cleanup; old install paths are no
longer held by this service.

Both tasks refuse missing/inactive/non-running services. No tunnel installation,
enablement or token provisioning occurs. Existing command arguments are preserved
privately. Only a single direct cloudflared ExecStart with `--no-autoupdate` is
supported; unrelated drop-ins, modified managed files, unsafe permissions and
unsupported command syntax require manual review rather than guessing. The drop-in
is root-owned mode 0600 because arguments may contain credentials. A system lock
serializes setup/restart. On failure, the previous drop-in is restored (or a new
one removed); after a restart attempt, service recovery is attempted too. Recovery
is best effort and cannot guarantee the tunnel comes back if its old binary or
configuration is broken. Non-root users authenticate with interactive sudo when
needed; passwordless sudo needs no prompt. No credentials or unit contents are
printed. Cleanup remains a separate, explicit operation.

Test without restarting anything: `node --test dot_config/cloudflared/restart.test.mjs`.

## OpenAI model allowlist

The managed OpenCode V2 plugin at
`dot_config/opencode/plugins/openai-allowlist/index.js` limits OpenAI to
GPT-6.1 Terra, GPT-6.1 Sol, GPT-6 Luna, GPT-6 Luna Fast and GPT-6 Astra.
Other OpenAI models, including future catalog additions, are disabled on every
catalog rebuild. Other providers are unchanged. Edit the plugin's `allowedModels`
set to change the selection, then run `chezmoi apply`. The redundant OpenChamber
`hiddenModels` list is removed from preferences and legacy settings on apply.

Test: `node --test tests/openai-allowlist.test.mjs tests/opencode-config.test.mjs`.

## Tool version cleanup

After `chezmoi apply`, preview unused older Mise installations on Linux:

```sh
mise run tools:cleanup
mise run tools:cleanup -- --dry-run
mise run tools:cleanup -- --apply
```

Preview is the default. Global configured versions must already be installed.
The helper protects global selections (including resolved ranges such as Node 24)
and versions required by any configuration Mise has tracked. Only numeric releases
older than a globally selected, installed replacement are candidates. Newer,
unconfigured tools, refs and prereleases are left alone. No config edits, upgrades,
cache sweeps, service restarts or process termination are performed.

Before uninstalling anything, the task performs a read-only `/proc` scan
using `sudo -n /usr/bin/python3` (root inspection is required even for preview).
The task first probes noninteractive sudo access. If authentication is needed,
it runs `sudo -v` with inherited terminal input/output so sudo asks for a password
interactively; the helper never reads the password. Passwordless sudo needs no prompt.
The scan checks executables, working directories, absolute arguments, mapped files and open files;
inode matching through each process root detects shared nspawn bind mounts too.
Busy old versions are skipped with tool/PID information only. Versions Mise does
not consider prunable and unverifiable/symlinked install paths are skipped too.
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
service running; `codex:setup` and `openchamber:setup` perform the lifecycle
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
Existing always-on skills in `dot_agents/skills/` remain unchanged.

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
installation, or Git configuration changes occur. Windows directory symlinks
require Developer Mode or suitable privileges; link failures are reported.

Links point to the deployed catalog, not the Git checkout: update with
`chezmoi apply`. Activation links remain local and are not managed by chezmoi.
Do not commit project links containing machine-specific absolute paths; optionally
exclude individual links through that project's `.git/info/exclude`. To deactivate,
remove only the chosen activation symlink, not its catalog directory.

Both skills require Python 3.10+ and internet access, use only the Python standard
library, and send questions to the respective public documentation AI service.
Do not include secrets in questions. Their scripts and original mocked tests were
ported from `ai-personal`; no live AI requests are needed to run these tests:

```sh
node --test dot_config/skills/setup.test.mjs
python3 -B -m unittest discover -s dot_local/share/my-opencode/optional-skills/tests
```

Run `mise run shell:setup` after `chezmoi apply` and `mise install` to install
portable Bash and optional Fish startup integration on Linux/macOS. This is not a
bare-OS bootstrap: it assumes the repository's generated files and Mise are
available. Zsh and service/OS-wide environment setup are out of scope. No Codex,
model, credentials, network access, sudo, or AI requests are needed; setup never
runs implicitly. Use `mise run shell:setup -- --check` for a read-only structural
preflight, or `mise run shell:setup -- --dry-run` to preview planned file changes.
The check does not source startup files or secret values; it reports validators,
Fish config root, Bash login entrypoint, cache state, planned paths, and blockers.
Fish syntax/runtime checks run only when Fish is installed. Startup fixtures cover
bounded generic patterns; they do not certify any CachyOS-shipped defaults.

The installer backs up changed files privately under
`~/.local/state/shell-init-backups`, syntax-checks proposed files, and installs
idempotent hooks in `.bashrc`, `.profile`, and existing `.bash_profile` or
`.bash_login`. The shared environment is initialized before distro `.bashrc`
early-return guards; a separate PATH-only finalizer runs after profile/interactive
customizations so stock PATH prepends cannot leave duplicates or reverse the
baseline. Existing profile content is preserved. Only existing `~/bin`,
`~/.local/bin`, and Mise shims are normalized; unrelated PATH entries keep their
order and position around that baseline, and custom interactive PATH additions
remain effective. Mise activation is interactive-only. Caller-provided secrets,
including empty values, take precedence over managed defaults. Setup reads secret
names from the manifest but never prints secret values.

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

Only when no browser is found does setup install Google Chrome Stable. This
fallback supports Debian-family Linux (Debian/Ubuntu IDs or exact Debian/Ubuntu
`ID_LIKE` tokens, including Linux Mint) on amd64; Windows, macOS, other
distributions and architectures fail explicitly. It requires root or sudo and
internet access, downloads Google's official `.deb` over HTTPS, and installs it
with apt, including dependencies. Google's package may configure its apt
repository for future updates. Setup does not launch Chrome, change browser
profiles, or run automatically during `mise install`.
Test host validation without installing anything:
`node --test dot_config/chrome/setup.test.mjs`.

## Shared native Docker

`docker:setup` is opt-in and deterministic, for Debian/Ubuntu amd64/arm64.
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
forwarding; pinned trust, identity and endpoint are preserved. A healthy daemon
does not need to be restarted for these SSH changes.

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

The service discovers published ports roughly every 10 seconds, creates IPv4
and IPv6 loopback SSH forwards, retries failed tunnels, and removes forwards
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

Run `mise run codex:setup` after applying chezmoi and installing tools with Mise
to start the native Codex app-server daemon, or restart it if already running.
This briefly interrupts an existing daemon. Check its status and versions with
`codex app-server daemon version`.

Run `mise run openchamber:setup` after applying chezmoi to install and start
OpenChamber's native user startup service on port 3000. This disables any previous
startup service and stops the existing OpenChamber instance on that port first;
instances on other ports are left alone. It briefly interrupts an existing server.
Check the service with `openchamber startup status`.

### OpenChamber preferences

Chezmoi merges the approved OpenChamber preferences into
`~/.config/openchamber/preferences.json` and selected instance settings into
`~/.config/openchamber/settings.json`. Edit the allowlists in
`.chezmoitemplates/openchamber/`: `preferences.json` owns the model defaults,
hidden models and selected UI/notification preferences,
including the explicitly pinned `showReasoningTraces: true`; `settings.json`
owns the five disabled agent tools and default permission mode.
The PWA app name (`pwaAppName`) is unmanaged and can differ on each machine;
existing local names are preserved and fresh installs use the app default.
The default model is `openai/gpt-6.1-terra` with its default variant; apply
removes any old explicit `defaultVariant` from both preference files.
**The managed permission mode is `auto` (Accept everything).**

**The repository is authoritative for every allowlisted key.** Each apply
overwrites conflicting local values, including booleans set to `false`, and
replaces the hidden-model list rather than combining it with local choices.
A newer local preference timestamp does not give a local value priority.
Only keys outside the allowlists are preserved (except the retired overrides
explicitly removed below). This precedence applies to OpenChamber; the separate
Codex/OpenCode local-model preservation rules are described below.

The `modify_private_*.json` templates preserve unrelated keys, credentials,
projects and session state. Themes are not managed: existing choices on every
surface are left alone, and fresh installs use OpenChamber's defaults.
Sidebar project sort order is also unmanaged (the app default is `manual`).
Small-model selection uses OpenChamber's default resolver, following OpenCode's
configured `agents.title.model`. Apply removes the retired `smallModelUseDefault`,
`smallModelOverride` and `smallModelVariant` keys from both files so old overrides
cannot win over that default; no custom small-model value is stored.
They do not introduce empty/default preferences (except the explicitly pinned
reasoning display), recent history, or device-only
state. Other unmanaged entries are left alone, not deleted. Both files are
private (0600 on Unix). Preference timestamps are generated only when a managed
value changes, not copied from the original machine or refreshed on every apply.
Malformed JSON and unsupported preference document versions are refused.

Apply with `chezmoi apply ~/.config/openchamber/preferences.json ~/.config/openchamber/settings.json`,
then reload clients to pick up the stored preferences. UI changes to managed
values are local edits until the next apply restores the allowlist; update the
allowlists to make those changes permanent. This targets the default data
directory, not a custom `OPENCHAMBER_DATA_DIR`. Back up existing files outside
Git before applying on another machine, and avoid simultaneous UI saves while
applying; the two-file update does not lock the running OpenChamber server.

Verify with `node --test tests/openchamber-config.test.mjs`.

This is a chezmoi source directory. Its `dot_codex/modify_config.toml` template
updates `~/.codex/config.toml` in place: it enforces the Rawroute defaults while
retaining other Codex settings, including project trust entries and Windows
sandbox preferences. Codex can continue to add unrelated settings without those
being discarded on the next `chezmoi apply`.
The model defaults to `gpt-6-luna` only when the `model` field is absent;
an existing local model selection is preserved, including during Rawroute switches.

OpenCode follows the same modify-in-place pattern. `dot_config/opencode/modify_opencode.json`
updates managed provider routing and model limits while retaining local model choices,
agent configuration, and unrelated settings. Rawroute switches use this merge too.
`gpt-6-luna-fast` shares Luna's limits: 680,000 context, 552,000 input, 128,000 output.

RawRoute includes `atria-dawn` in place of the retired `step-5-preview` (removed
from existing configs on apply). Atria Dawn was not listed in models.dev when
configured, so its metadata uses the official `zhipuai/glm-5.2` entry from
`https://models.dev/api.json` as a fallback, with context overridden to 512,000
tokens, max output to 65,536 tokens, and input to 446,464 tokens (context minus
max output). This includes text-only input/output,
tools, temperature, reasoning toggle and high/max effort, release date and
pricing metadata. These are fallback estimates, not verified Atria Dawn
capabilities, release date or RawRoute prices.

RawRoute also includes `deepseek-v4.1-flash-1017`, using the official DeepSeek
`deepseek-flash` metadata from `https://models.dev/api.json` (canonical model
`deepseek/deepseek-v4.1-flash-1017`). Context is explicitly 1,000,000 tokens,
max output is overridden to 262,144 tokens, and input is 737,856 tokens (context minus output).
It accepts text and images and supports tools, reasoning toggle and low/high/max
effort. Pricing is copied from the DeepSeek entry, not verified RawRoute pricing.

The `dot_config/opencode/agents/modify_*.md` templates refresh repo-managed agent
instructions and permissions while preserving each existing frontmatter `model`
(including its variant). Missing model fields use the defaults in
`.chezmoitemplates/opencode-agents/`: `general` and `explore` default to
`openai/gpt-6-luna-fast#xhigh`, and `reviewer` to `openai/gpt-6-astra#low`.
Build and plan inherit the session model unless a local model is set.
Existing selections, including older repo defaults, stay selected; remove an
agent's `model` field to adopt the current repo default on the next apply.

Verify with `node --test tests/opencode-config.test.mjs dot_config/rawroute/setup.test.mjs`.

### Rawroute endpoint opt-in

Both Codex and OpenCode default to `https://ccs.halotec.my.id/v1` using
`CCS_HALOTEC_API_KEY`. After applying these task assets, opt into the local route
**on this machine only**:

```sh
mise run provider:local -- --dry-run
mise run provider:local
# Restore the default endpoint and key reference:
mise run provider:default
```

Local mode uses `https://rawroute.qilin-elver.ts.net/v1` and
`CCS_HALOTEC_LOCAL_API_KEY`, mapped from Bitwarden item `ccs.halotec local API` (password).
Run `secrets:setup` separately and open a new initialized shell first; switching
requires the local key in the invoking environment but never prints or embeds it.
No network/model calls or automatic secret sync are performed.

The separate OpenCode `rawroute` provider has its own endpoint switch:

```sh
mise run rawroute:default
mise run rawroute:local -- --dry-run
mise run rawroute:local
```

Default mode uses `https://rawroute.qzz.io/v1` with `RAWROUTE_API_KEY`.
Local mode uses `https://rawroute.qilin-elver.ts.net/v1` with
`RAWROUTE_LOCAL_API_KEY`, which must already be in the invoking environment.
These tasks only apply OpenCode configuration; they do not switch Codex,
the `openai` provider route controlled by `provider:*`, or model selections.
The separate local-mode marker persists across chezmoi applies. Backups,
rollback, and `--dry-run` work like `provider:*`; no models are added.

Mode is stored in `~/.config/rawroute/local-enabled`, never in Git. Both templates
check this marker, so later ordinary `chezmoi apply` preserves local mode until
explicit opt-out. Existing machines remain default when the marker is absent.
The task applies **only** the Codex and OpenCode targets, creates private backups
under `~/.local/state/rawroute-backups`, and restores both target files and the
previous marker on failure. Symlink targets and concurrent switches are refused.
Keep backups private: pre-existing configs may contain credentials.

The applied `source.json` records the actual chezmoi source used to install the
task. If that checkout moves, reapply the task assets or pass
`--source /absolute/path/to/checkout`; setup verifies ownership before writing.
`--dry-run` validates inputs without creating a marker or applying any targets.
Existing applications/services may require a separate restart to reload config
or newly synced secrets; switching does not restart them.

Tests use synthetic credentials and an isolated temporary home:
`node --test dot_config/rawroute/setup.test.mjs` (chezmoi required for render tests).

The default Rawroute provider reads its credential from `CCS_HALOTEC_API_KEY`; no key is
stored in this repository or in `config.toml`. The existing
`dot_config/secrets/manifest.json` already maps that environment variable from
Bitwarden. Set it up with `mise run secrets:setup` if it is not available in new
processes yet.

Apply this source with `chezmoi apply`. The TOML is parsed and re-serialized, so
formatting and comments may change. Tables use flat section headers without
extra nesting indentation or redundant parent sections. Formatting is checked
against the parsed data; unusual whitespace-sensitive values retain the original
encoder formatting when needed. All other TOML values are retained; the
literal `experimental_bearer_token` under `model_providers.rawroute` is removed.
If reviewing a diff from a config that still has a literal token, avoid printing
or sharing the removed line.
