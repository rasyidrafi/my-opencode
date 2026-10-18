# Dotfiles

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
