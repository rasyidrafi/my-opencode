# Shared secrets setup

Tools live in mise, configuration lives in chezmoi, secret values live in Bitwarden.
This directory contains only the helper and a manifest of references, never values.

## Setup (Windows and Linux)

1. Apply this repository with chezmoi and run `mise install`.
2. Run `mise run secrets:setup` in an interactive terminal.
3. Enter your Bitwarden master password (and login/2FA on a new machine).
4. GitHub CLI is ready immediately: run `gh auth status` in the same terminal.
   For other environment secrets, start a new terminal/application. On Windows, sign out/in if the parent launcher
   still has an old environment. On Linux, a new bash/zsh terminal or SSH login
   loads the generated environment.

The helper unlocks once per run, syncs, fetches all declared secrets, installs
them and locks the vault in its cleanup handler. Forced termination/power loss
can prevent cleanup; use `bw lock` if a run is interrupted. No session is saved.
On initial login, Bitwarden may ask for your master password during both login
and unlock. On later runs only unlock is necessary.

Windows uses user-scoped Registry environment values. Linux writes a mode-0600
shell file in a mode-0700 directory and adds an idempotent loader to bash/zsh
profiles, preserving existing content. Custom ZDOTDIR, fish, services, cron,
containers and Linux GUI sessions require their own loading configuration.
This does not update already-running processes or the invoking shell.

## Add a secret

GitHub CLI authentication uses `output: "gh-auth"`: the password field of
`github.com TOKEN` is passed over stdin to `gh auth login --hostname github.com
--with-token`, then setup checks the saved login with `gh auth status`.
GitHub CLI stores the credential using its credential store (or its normal config
fallback if a credential store is unavailable). It works immediately in the
current terminal. The token is not exported as an environment variable.
Setup removes the old Windows user `GH_TOKEN` variable and rebuilds the Linux
environment file without it. If an existing shell already inherited `GH_TOKEN`
or `GITHUB_TOKEN`, unset that variable because it overrides gh's saved login.

Add a reference to `manifest.json`, apply it with chezmoi, then rerun setup:

```json
{
  "name": "ANOTHER_API_KEY",
  "item": "Bitwarden item UUID or unique name",
  "field": "custom:token",
  "output": "env"
}
```

Fields: `login.password`, `login.username`, `notes`, or `custom:FIELD_NAME`.
Prefer item UUIDs when sharing across machines; names must be unique.
Use `output: "file"` for credentials that should not enter every child process.
That writes `~/.config/secrets/generated/NAME`, with restricted permissions.
The consuming application must be configured to read that file.

SSH passwords are not automatically consumed by OpenSSH from ENV or these files.
For unattended SSH, prefer an SSH key and agent. Do not export SSH passwords
globally just to avoid a login prompt. A file output can support tools that
explicitly accept password files, but does not configure SSH authentication.

## Updating and removing

Rerun setup after changing a value in Bitwarden. Existing local values are
overwritten only after all references have been retrieved and validated.
Writes across multiple destinations are not a transaction.
Removing an entry does not remove old Windows user variables, existing file
outputs, or variables inherited by running processes. Remove those explicitly;
on Linux the generated export file is rebuilt with the current entries.
If chezmoi manages your shell profiles, keep the generated loader block in those
source files too so a later apply does not remove it.

Local ENV/files contain plaintext credentials. They are not vault-encrypted;
programs running as your user can access them. File outputs on Windows are in
a directory restricted to your Windows account. User ENV is available broadly
to that user's new processes. Never add generated output or rendered credentials
to chezmoi/Git, and do not paste secret values into chat or logs.

Validate references without accessing the vault:

```text
mise run secrets:setup --check
```
