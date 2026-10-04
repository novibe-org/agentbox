# agentbox

One container per coding-agent session, on a remote Docker host managed by [DevPod](https://devpod.sh). Each session gets its own clone of a workspace repo; you reach it over SSH straight into the container.

agentbox is two things:

- **A devcontainer Feature**, `ghcr.io/novibe-org/agentbox/agentbox`: sshd, helix, yazi, lazygit, delta, ripgrep, and the mounts that share session state across containers.
- **A CLI**, `bin/agentbox`, that creates, opens, lists and deletes sessions from your machine.

## Isolation

Sessions are isolated from each other and from your laptop, not from your accounts. Every session sees the same Claude Code login, GitHub login and git identity, and your SSH agent is forwarded in. An agent in a session can push wherever you can.

## The session host

Any x86_64 Docker host registered as a DevPod machine. Shared state lives under `/home/devpod` on the host, owned by uid 1000, and is mounted into every session:

| Host                         | Container             | Holds                    |
| ---------------------------- | --------------------- | ------------------------ |
| `/home/devpod/claude-config` | `/agentbox/claude`    | Claude Code login, settings |
| `/home/devpod/gh-config`     | `/agentbox/gh`        | GitHub CLI login         |
| `/home/devpod/git-config`    | `/agentbox/git`       | git identity (`config`)  |
| `/home/devpod/pnpm-store`    | `/agentbox/pnpm-store`| pnpm package store       |

`agentbox new` creates these directories if they are missing. The container user must be uid 1000, as `node` is in the Node images.

## A workspace

A workspace is a git repo whose `.devcontainer` uses the Feature and clones the projects it works on:

```jsonc
// .devcontainer/devcontainer.json
{
  "name": "myworkspace",
  "image": "mcr.microsoft.com/devcontainers/typescript-node:22",
  "features": {
    "ghcr.io/anthropics/devcontainer-features/claude-code:1": {},
    "ghcr.io/devcontainers/features/github-cli:1": {},
    "ghcr.io/novibe-org/agentbox/agentbox:1": {}
  },
  "postCreateCommand": "bash .devcontainer/setup.sh"
}
```

```bash
# .devcontainer/setup.sh
set -euo pipefail
for repo in app plugins; do
  [ -d "projects/$repo/.git" ] || git clone "git@github.com:myorg/$repo.git" "projects/$repo"
done
(cd projects/app && pnpm install --frozen-lockfile)
```

`agentbox rm` checks the workspace repo and every repo under `projects/` for unpushed work before deleting.

## The CLI

Put `bin/agentbox` on your `PATH`, tell it which machine hosts sessions, and add this to `~/.ssh/config`:

```bash
export AGENTBOX_MACHINE=my-devpod-machine
```

```
Host *.agentbox
  User node
  ProxyCommand agentbox proxy %h
  ForwardAgent yes
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
  LogLevel error
```

`<id>.agentbox` goes straight into the session's container through the host, bypassing DevPod's slower SSH path.

From inside a workspace checkout:

```bash
agentbox new fix-login   # create a session from this repo's origin and open it
agentbox open fix-login  # reconnect
agentbox ls
agentbox rm fix-login
```

`open` uses [cmux](https://cmux.dev) when run inside it, plain `ssh` otherwise.
