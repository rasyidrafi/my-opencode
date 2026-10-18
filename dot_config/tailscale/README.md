# Tailscale setup

Apply this repository with `chezmoi apply`, then run in an interactive terminal:

```sh
mise run tailscale:setup
```

Install Tailscale yourself first and ensure its service is running. The helper
supports Windows and Linux; it does not install Tailscale.

- Already Running on `qilin-elver.ts.net`: finish without changes or elevation.
- Target account disconnected: reconnect with `tailscale up`.
- Another account active: switch to a matching saved profile if available,
  otherwise run `tailscale login` to add/select an account.
- No account: run `tailscale login`.

Linux uses sudo for changes (unless already root). Windows requests Administrator
access through UAC when needed; follow the login link in the elevated window.
Choose **muhammand.rafi25@gmail.com** and **qilin-elver.ts.net** in the browser.
Tailscale has no CLI flag to force that email. Existing accounts are not logged
out or removed, but only one account is active at a time.

Success requires status `Running` and the exact target MagicDNS suffix. A wrong
tailnet, cancelled login, unavailable service, or pending connection results in
an error, not a success message. Browser login waits for user completion; after
the CLI returns, connection verification waits up to 30 seconds.

Run decision-flow tests without changing the network:

```sh
node --test dot_config/tailscale/setup.test.mjs
```
