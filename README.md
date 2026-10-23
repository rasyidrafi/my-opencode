# Dotfiles

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

After `chezmoi apply`, run `mise run cloudflared:restart` on Linux/systemd to
restart the existing system `cloudflared.service`. The task refuses missing,
inactive, failed or non-running services; it does not install, enable or start
an inactive tunnel. Restart briefly interrupts the tunnel. It uses systemd
`try-restart` and verifies the service is running afterward (not tunnel connectivity).
Non-root users use sudo with interactive terminal input when a password is needed;
root runs systemctl directly. No tunnel credentials or unit contents are printed.

Test without restarting anything: `node --test dot_config/cloudflared/restart.test.mjs`.

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
the deterministic Bash and Fish environment on Linux/macOS. No Codex, model,
credentials, network access, sudo, or AI requests are needed. Setup never runs
implicitly. Preview with `mise run shell:setup -- --dry-run`.

The installer syntax-checks proposed files, backs up changed files privately under
`~/.local/state/shell-init-backups`, and installs idempotent hooks in `.bashrc`,
`.profile`, and existing `.bash_profile`/`.bash_login`. It preserves custom profile
content; symlinks, unsupported inline loaders, invalid syntax and ambiguous hooks
fail explicitly rather than being guessed. Existing AI-generated shared loaders
require review and `--replace-legacy-loader` (also supported with `--dry-run`).
Fish terminals get the same managed PATH order, secrets and cache hooks through a
confined manager at `~/.config/fish/conf.d/my-opencode.fish`, which sources
`~/.config/shell/env.fish`; Fish user configuration is never modified.
Backups contain sensitive configuration: keep them private.

The shared loader orders `~/bin`, `~/.local/bin`, mise shims, then the remaining
PATH. Mise activation is interactive-only. Caller-provided secrets, including empty
values, take precedence over managed defaults. Existing generated exports are
supported using names from the secrets manifest; credentials are never parsed or
printed by setup. Secrets/cache helper reruns recognize installed integration.
Cache remains opt-in via `azure-mnt-cache:setup`; existing direct cache integration
is migrated. Workboxes without opt-in remain unaffected.

Keep host-specific additions in `~/.config/shell/local.sh` (Bash-only: Fish
cannot source Bash snippets, so mirror any host-specific Fish needs in your Fish
config). Custom absolute
`BASH_ENV` hooks are preserved through a private legacy wrapper; ambiguous cycles
require manual migration. Templates in `dot_config/shell/templates` are the source
of truth; rerun setup after applying updates. Generated loaders are not chezmoi
targets, so applying the repo does not overwrite local opt-in choices.
Open a new shell afterward. Clean Bash processes without `BASH_ENV`, systemd,
cron and GUI launchers require explicit integration; this task changes none of
those services. Test without editing the real home:
`node --test dot_config/shell/setup.test.mjs dot_config/azure-mnt-cache/setup.test.mjs`.

Run `mise run chrome:setup` after `chezmoi apply` to opt into installing Google
Chrome Stable for `browser-use`. Currently supports Debian/Ubuntu Linux on amd64
only; Windows, macOS, other distributions and architectures fail explicitly.
Requires root or sudo and internet access. Downloads the official Google `.deb`
over HTTPS and installs it with apt, including dependencies. Google's package may
configure its apt repository for future updates. If Chrome Stable already runs,
setup leaves it unchanged. This task does not launch Chrome, change browser
profiles, or run automatically during `mise install`. Headless use needs no desktop.
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
and a readiness marker prevent Docker/containerd from silently storing data on root
when `/mnt` is unavailable or a migration is incomplete.

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

Run `mise run openchamber:setup` after applying chezmoi to install and start
OpenChamber's native user startup service on port 3000. This disables any previous
startup service and stops the existing OpenChamber instance on that port first;
instances on other ports are left alone. It briefly interrupts an existing server.
Check the service with `openchamber startup status`.

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
mise run rawroute:local -- --dry-run
mise run rawroute:local
# Restore the default endpoint and key reference:
mise run rawroute:default
```

Local mode uses `https://rawroute.qilin-elver.ts.net/v1` and
`CCS_LOCAL_API_KEY`, mapped from Bitwarden item `rawroute local API` (password).
Run `secrets:setup` separately and open a new initialized shell first; switching
requires the local key in the invoking environment but never prints or embeds it.
No network/model calls or automatic secret sync are performed.

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
