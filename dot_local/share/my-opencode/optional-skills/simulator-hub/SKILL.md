---
name: simulator-hub
description: Use the Simulator Hub API to view or control an Android emulator, manage control leases, start or stop the AVD, and issue or revoke client tokens.
---

# Simulator Hub

## Connection and roles

These variables configure the **caller**, not the server process:

| Variable | Value |
| --- | --- |
| `SIMULATOR_HUB_BASE_URL` | API URL including `/v1`. Defaults to `http://127.0.0.1:8787/v1`. |
| `SIMULATOR_HUB_CLIENT_TOKEN` | Client bearer token for status, screenshots, and control. |
| `SIMULATOR_HUB_ADMIN_TOKEN` | Admin bearer token. Required only for admin calls; never used as a fallback for a client call. |

Define these Bash helpers once. They read the URL and token from your environment and send `Authorization: Bearer <token>`. To override a value for one call, prefix the command with `VARIABLE=value`. Use `--json` for JSON request bodies.

```bash
hub_request() {
  local base=${SIMULATOR_HUB_BASE_URL:-http://127.0.0.1:8787/v1} token=$1 path=$2
  shift 2
  curl -fsS -H "Authorization: Bearer $token" "$@" "${base%/}/$path"
}
api()   { hub_request "${SIMULATOR_HUB_CLIENT_TOKEN:?Set SIMULATOR_HUB_CLIENT_TOKEN}" "$@"; }
admin() { hub_request "${SIMULATOR_HUB_ADMIN_TOKEN:?Set SIMULATOR_HUB_ADMIN_TOKEN}" "$@"; }

# Optional on this host: load the installed client token if none was supplied.
: "${SIMULATOR_HUB_CLIENT_TOKEN:=$(<"$HOME/.config/simulator-hub/client.token")}"
api me      # Returns your id and role: client or admin
api devices # Lists managed AVDs with stable id, display name, status, and control

# One-call override: use the URL and matching credential for another hub.
SIMULATOR_HUB_BASE_URL=https://hub.example.org/v1 SIMULATOR_HUB_CLIENT_TOKEN="$OTHER_HUB_TOKEN" api devices
```

## Client: view and control the emulator

`GET /devices` returns `{"devices":[{"id":"SimulatorHub_API_35","name":"SimulatorHub API 35","status":"ready","control":"free"}]}` for the configured AVD. `status` is `stopped`, `booting`, or `ready`. `control` is `free` or `in_use`: a ready device can be viewed while leased. To send input, acquire a lease rather than relying on the list snapshot.

When the device is `ready`, `GET /device/screenshot` returns a **binary PNG**. No lease is required: `api device/screenshot -o frame.png`. For a live preview, request the next frame after the previous download completes.

Only one client can hold the control lease at a time. Every input request needs **both the holder’s bearer token and `X-Lease-Id`**. To tap once and release control on exit (Bash and `jq`):

```bash
(
  set -euo pipefail
  lease=$(api lease -X POST | jq -er .id)
  header="X-Lease-Id: $lease"
  trap 'api lease -X DELETE -H "$header" >/dev/null' EXIT
  api device/input -H "$header" --json '{"type":"tap","x":120,"y":300}'
)
```

Coordinates are pixels in the current screenshot, not percentages. For a swipe, send `{"type":"swipe","x1":120,"y1":600,"x2":120,"y2":200,"duration":300}` (milliseconds). For a key press, send `{"type":"key","key":"HOME"}`; supported keys are `HOME`, `BACK`, and `ENTER`.

For longer sessions, send `PUT /lease` with the lease header **before the 30-second lease expires**. Renewal resets the timer; input does not. Release with `DELETE /lease`. After expiry or a server restart, acquire a new ID with `POST /lease`. If an input request times out, check the screen before retrying: the input may already have taken effect.

## Admin: manage access and device lifecycle

To issue a client token, use `admin` with `SIMULATOR_HUB_ADMIN_TOKEN`. On the server host, this example loads `HUB_ADMIN_TOKEN` if the caller has not set an override, then saves the response to `openchamber-token.json`:

```bash
(
  set -eC; umask 077
  if [[ -z ${SIMULATOR_HUB_ADMIN_TOKEN:-} ]]; then
    . "$HOME/.config/simulator-hub/server.env"
    SIMULATOR_HUB_ADMIN_TOKEN=$HUB_ADMIN_TOKEN
  fi
  admin tokens --json '{"name":"openchamber"}' > "$HOME/.config/simulator-hub/openchamber-token.json"
)
```

| Admin endpoint | Effect |
| --- | --- |
| `POST /tokens` | Send `{"name":"..."}` to receive `{id, token}`. The secret is returned only once. Give `token` to the client backend; keep `id` for revocation. |
| `GET /tokens` | List `{id, name}` records. No secrets are returned. |
| `DELETE /tokens/:id` | Revoke the client token and its lease. Other tokens remain valid. |
| `POST /device/start`, `POST /device/stop` | Start or stop the configured AVD. Poll until `ready`. Server setting `HUB_AUTOSTART=1` attempts startup once per service start; a manual stop lasts until the next explicit start or service restart. |
| `DELETE /lease` | Force-release the active lease without `X-Lease-Id`. The previous holder’s lease ID becomes invalid. |

**Troubleshooting:** `400`: check the JSON and input fields. `401`: bearer token missing, invalid, or revoked. `403`: wrong role, or the lease is missing, expired, or not yours. `409`: a lease is already held (acquire), or the device is not ready (input or screenshot). `503` on a status check: verify ADB connectivity on the emulator host.
