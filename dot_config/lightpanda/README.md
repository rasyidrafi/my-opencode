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
mise run lightpanda:start my-task
mise run lightpanda:status my-task
mise run lightpanda:stop my-task
mise run lightpanda:update
```

Each start creates a new temporary container named `lightpanda-<task-id>` with
`--rm`, no persistent volumes, and an automatically allocated loopback port.
Omit the task ID to generate a UUID. Start prints JSON containing `task`,
`container`, `status`, and `cdpUrl`, after verifying CDP readiness. Use this URL,
not a fixed port. A duplicate task ID fails without replacing the existing container.

Use one container for the entire task and one agent-browser session:

```sh
agent-browser --engine lightpanda --cdp <cdpUrl> --session <task-id> open https://example.com
agent-browser --engine lightpanda --cdp <cdpUrl> --session <task-id> get title
agent-browser --engine lightpanda --cdp <cdpUrl> --session <task-id> close
mise run lightpanda:stop <task-id>
```

Lightpanda permits one context/page per CDP connection: use `open`, not `tab new`.
Always run stop in cleanup/finally, even if a browser command or close fails.
Stop requires an explicit task ID, affects only containers with this helper's
ownership/lifecycle labels, and verifies removal. It is safe to repeat.
Startup readiness failures trigger cleanup of the newly created container.

`--rm` removes a container when stopped; it does not detect an abandoned agent task.
If the agent crashes or is forcibly terminated, run `mise run lightpanda:status`
to list leftovers, then stop the relevant task IDs. Containers do not auto-start
at login. The image stays cached between tasks.

Image: `docker.io/lightpanda/browser:nightly`. Update only pulls the image for
future tasks; running containers are left intact. No runtime is installed by this helper.
Docker on Linux must be local, running, and accessible to the current user.

Troubleshooting: `wslc container logs lightpanda-<task-id>` on Windows,
or `docker container logs lightpanda-<task-id>` on Linux.
The old persistent `lightpanda` container is not used by these tasks.

Sources:
- https://lightpanda.io/docs/run-locally/installation/docker
- https://learn.microsoft.com/en-us/windows/wsl/tutorials/wsl-containers
- https://lightpanda.io/blog/posts/how-we-built-multiclient
