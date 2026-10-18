# Existing user browser through the extension

Use Playwriter's local extension connection when the task needs the user's open browser or existing login. Do not copy profiles or attach to a personal browser via direct CDP.

## Connect

The user installs the [Playwriter extension](https://chromewebstore.google.com/detail/playwriter/jfeammnjpkecdekppnclgkkffahnhfhe), opens the intended tab, and clicks the icon to enable it (green). Try connecting first if setup may already be complete:

```text
playwriter session new --tab-group task
```

The local relay starts automatically on `127.0.0.1:19988`; no system service or browser debugging flags are required. Browser and relay run on the same machine. If the extension is disconnected or no tab is enabled, ask the user to enable the target tab and retry; do not substitute another mode.

Use the returned session ID, never an assumed `1`. Enumerate connected tabs through `context.pages()` and select the intended tab from observed URLs. If multiple browsers are connected, use the CLI's `--browser` selector with the observed browser key. Ask if multiple plausible targets remain ambiguous.

Example JavaScript to run with `playwriter -s <id> -f <file>`:

```js
console.log(context.pages().map(p => p.url()));
```

Then select the observed target in a subsequent call:

```js
state.page = context.pages().find(p => p.url() === 'https://example.com/');
if (!state.page) throw new Error('Target tab is not connected');
console.log(await snapshot({ page: state.page }));
```

The URL is a placeholder: substitute the actual observed intended URL. Create a new tab only when the task needs it. Session state is isolated, but enabled browser tabs are shared.

## Interaction and preservation

- Click a target field immediately before `fill()` or keyboard input and verify its value afterward. In extension mode DOM focus alone can misdirect typing to the address bar.
- Do not call `browser.close()` or `context.close()`. Close only tabs created for this task or explicitly requested by the user.
- Do not copy profile directories, restart the browser, or change launchers. Preserve unrelated tabs, cookies, and settings.
- Do not use `bringToFront()` unless requested. Keep actions on the intended tab.
- On completion, close task-created temporary tabs as appropriate and run `playwriter session delete <id>`. In extension mode this removes session state and disconnects its client while leaving existing browser tabs open.

For stale connections, inspect `playwriter logfile`, reset only your session with `playwriter session reset <id>`, and select the target again. Avoid `playwriter serve restart` while other sessions are active. The user can disconnect an enabled tab through the extension.
