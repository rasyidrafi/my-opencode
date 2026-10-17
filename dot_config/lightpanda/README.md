# Lightpanda containers on Windows and Linux

The helper automatically selects `wslc.exe` on Windows and `docker` on Linux.
Lightpanda runs as a Linux container on both platforms. macOS is not supported
by this helper.

- Windows: WSL 2.9.3+ is required (`wsl --update`, then `wslc version`).
  Docker Desktop is not required.
- Linux (including a WSL Linux shell): install Docker Engine, start its daemon,
  and ensure the current user can run `docker info` successfully without sudo.
  Use a local Docker daemon so the CDP readiness check can reach its published port.
  The helper does not install Docker or change user permissions.

Chezmoi distributes this helper and the mise tasks. The selected runtime manages the image and
container; mise provides the commands, rather than installing the browser binary.

```sh
mise run lightpanda:start
mise run lightpanda:status
mise run lightpanda:stop
mise run lightpanda:update
```

Start creates the container or reuses it, then checks the CDP endpoint.
Connect automation clients to `http://127.0.0.1:9222` (CDP).
The port is published only on loopback. The image is
`docker.io/lightpanda/browser:nightly`, following Lightpanda's Docker documentation.
Update pulls the image, recreates this helper's container, and starts it;
active sessions and data in its writable layer are discarded. No persistent volume
is configured. Start is manual after reboot; no login/autostart service is installed.
Containers not labeled as managed by this helper are never replaced.

Troubleshooting: `wslc container logs lightpanda` on Windows,
or `docker container logs lightpanda` on Linux.

Sources:
- https://lightpanda.io/docs/run-locally/installation/docker
- https://learn.microsoft.com/en-us/windows/wsl/tutorials/wsl-containers
