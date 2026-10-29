# Isolated installed browser

## Discover the executable

Respect the user's browser choice. Otherwise prefer Chrome, then Edge, then Chromium or Brave. If a requested browser is absent, report that rather than silently substituting another.

- **Windows:** check `Get-Command`, then browser `App Paths` registrations in HKCU/HKLM including the 32-bit registry view. Check existing files beneath `%LOCALAPPDATA%`, `%ProgramFiles%`, and `%ProgramFiles(x86)%`: `Google/Chrome/Application/chrome.exe`, `Microsoft/Edge/Application/msedge.exe`, `Chromium/Application/chrome.exe`, `BraveSoftware/Brave-Browser/Application/brave.exe`. Ignore unset roots; validate with `Test-Path -PathType Leaf`.
- **Linux:** prefer Chrome, then Edge, Chromium, or Brave. Check `PATH` for `google-chrome`, `google-chrome-stable`, `microsoft-edge`, `microsoft-edge-stable`, `chromium`, `chromium-browser`, `brave-browser`, and `brave-browser-stable`. If needed, check `/opt/google/chrome/{google-chrome,chrome}`, `/opt/microsoft/msedge/{microsoft-edge,msedge}`, `/snap/bin/chromium`, `/usr/lib/chromium/chromium`, and `/opt/brave.com/brave/brave-browser`. Validate executable access and a bounded `--version` response that identifies the browser and version; this does not verify headless/CDP startup. Preserve the discovered launcher path, including Snap dispatchers. Snap packaging/runtime permissions may affect launching. The `chrome:setup` task recognizes known Chrome/Chromium/Edge/Brave Flatpak app IDs to avoid installing a native replacement, but does not configure or launch Flatpak apps for isolated mode.
- **macOS:** inspect `/Applications` and `~/Applications` for the executable inside Chrome, Edge, Chromium, or Brave `.app` bundles.

If no usable installed browser exists, report it and ask the user to install one. Do not run `playwriter browser install` or download a browser via Playwright, Puppeteer, or mise. Distinguish launch errors from a missing installation.

## Launch and connect

Launch the verified absolute executable with a fresh task-specific temporary `--user-data-dir`, `--remote-debugging-port=0`, and `--headless=new`. Use a visible window only when the user requests one or needs to interact with it. Never reuse or copy a personal profile, pass a personal profile name such as `Default`, or attach through auto-discovery.

Read `DevToolsActivePort` from this new profile: line 1 is the port and line 2 the browser WebSocket path. Wait for that file with a bounded readiness check; if the browser exits or the deadline expires, report the launch failure and clean up this task. Connect to `ws://127.0.0.1:<port><path>` explicitly:

```text
playwriter session new --direct ws://127.0.0.1:<port>/devtools/browser/<id>
```

Do not use bare `--direct` (auto-discovery) or rely on `--browser headless` to select the executable/profile. The explicit launch works with an installed Edge as well as Chrome without extension setup.

Windows PowerShell launch example, after discovering `$browserExe`:

```powershell
$taskProfile = Join-Path $env:TEMP ('browser-use-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $taskProfile | Out-Null
$browserProcess = Start-Process -FilePath $browserExe -ArgumentList @(
  '--headless=new', '--remote-debugging-port=0',
  ('--user-data-dir="' + $taskProfile + '"'),
  '--no-first-run', '--no-default-browser-check', 'about:blank'
) -WindowStyle Hidden -PassThru
$portFile = Join-Path $taskProfile 'DevToolsActivePort'
$deadline = (Get-Date).AddSeconds(20)
while (-not (Test-Path -LiteralPath $portFile)) {
  if ((Get-Date) -ge $deadline) { throw 'Browser CDP startup timed out' }
  Start-Sleep -Milliseconds 100
}
$endpointLines = Get-Content -LiteralPath $portFile
$taskEndpoint = 'ws://127.0.0.1:' + $endpointLines[0] + $endpointLines[1]
mise exec -- playwriter session new --direct $taskEndpoint
```

Keep the profile path, process identity, endpoint, and returned session ID for cleanup. On Unix use the same flags with correctly quoted arguments and record the child PID. Keep CDP local; do not expose it to the LAN.

Create the task page using a JavaScript file:

```js
state.page = await context.newPage();
await state.page.goto('https://example.com', { waitUntil: 'domcontentloaded' });
console.log(await state.page.evaluate(() => navigator.userAgent));
console.log(await snapshot({ page: state.page }));
```

## Cleanup

Close task-created pages and delete only the task session. Then terminate only the browser processes belonging to the recorded task profile/PID. Never terminate all Chrome/Edge processes by name. Delete the temporary profile only after verifying its resolved absolute path is the task-created directory inside the temporary root; use native filesystem operations, not constructed shell deletion commands.

For failure or cancellation, inspect recorded state and perform the same scoped cleanup. When changing browser or launch options, create a fresh profile/session and observe page state again; do not replay external side effects automatically. Recording through Playwriter's extension API is unavailable in direct CDP mode.
