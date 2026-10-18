# Dotfiles

Run `mise run shell:setup` after `chezmoi apply` and `mise install` to have
Codex inspect and standardize your current Bash environment (Linux/macOS).
Set up Codex's model/provider and authentication first: the launcher requires
`codex exec` and `$CODEX_HOME/config.toml` (default `~/.codex/config.toml`).
For this repository's Rawroute configuration, make `CCS_HALOTEC_API_KEY`
available first via `mise run secrets:setup` and a new terminal. Custom-provider
authentication is handled by Codex, not gated on `codex login status`.

The task sends `~/.config/shell/PROMPT.txt` to `codex exec -`, rooted at your
home directory, with `workspace-write`, no interactive approval prompts, and an
ephemeral session. It uses your configured model/provider and makes model API
requests. It edits your shell initialization when invoked; it is not a dry run
and does not run during `mise install` or `chezmoi apply`.

The prompt tells Codex to preserve dynamic user customizations, centralize shared
environment loading, retain interactive-only Bash features, make private backups,
respect chezmoi ownership, and verify multiple shell modes without exposing
credentials. Read or customize `dot_config/shell/PROMPT.txt` before applying.
This is AI-driven migration, not a deterministic installer; inspect its final
verification report for partial completion or access limitations. A clean process
without `BASH_ENV` and systemd/cron need explicit integration. Existing processes
are not updated; open a new shell afterward.

Codex references: [non-interactive mode](https://developers.openai.com/codex/noninteractive)
and [CLI reference](https://developers.openai.com/codex/cli/reference).

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

Run `mise run azure-mnt-cache:setup` to opt into Linux cache redirection to
`/mnt/cache/<username>` in new Bash/Zsh shells. The task installs shell loaders;
it does not move or delete existing caches, configure mounts, or use sudo.
Source `~/.config/azure-mnt-cache/cache.sh` to activate in the current shell.
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

The Rawroute provider reads its credential from `CCS_HALOTEC_API_KEY`; no key is
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
