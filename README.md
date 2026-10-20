# Dotfiles

Run `chezmoi init --source /absolute/path/to/this/checkout` (after `cd` into it;
effectively `$(pwd)` at that moment) to generate `~/.config/chezmoi/chezmoi.toml`
with `sourceDir` recorded by `.chezmoi.toml.tmpl`. Re-run that form after moving
the checkout; bare `chezmoi init` without a source generates no config.

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
are not automatically shared. Keep cache setup separate: its Docker cache option
requires a local daemon, not an SSH context.

Test without installing packages or changing Docker:
`node --test dot_config/docker-setup/setup.test.mjs`.

Run `mise run azure-mnt-cache:setup` to opt into Linux cache redirection to
`/mnt/cache/<username>` in new Bash/Zsh/Fish shells. The task installs shell
loaders; Fish activation requires the shell:setup Fish loader and sources
`cache.fish`. It does not move or delete existing caches, configure mounts, or
use sudo.
Source `~/.config/azure-mnt-cache/cache.sh` (Fish: `cache.fish`) to activate in
the current shell.
If `/mnt` is not mounted or its cache directories cannot be created/accessed,
home cache defaults are used. An administrator may need to provision the private
user cache directory first. This checks mount availability, not Azure disk identity.
Temporary Azure disks can lose all cached files. Already-running applications and
systemd services do not receive these shell environment changes automatically.
When Docker is installed, setup also creates a local `docker-container` Buildx
builder named `azure-mnt-cache`. Its BuildKit state volume is a bind-backed local
volume at `/mnt/cache/<username>/docker-buildkit`. New shells select this builder
through `BUILDX_BUILDER`; builds load results into Docker by default. Image and
application volume storage remain unchanged. Existing builder caches are not
migrated or pruned. Run setup again after a temporary disk reset, before building.
Docker access without sudo is required, and only a local Unix-socket context is
supported. BuildKit runs a privileged helper container, as usual for this driver.

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
