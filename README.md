<img src=".github/icon.svg" alt="" width="96" height="96" align="right" />

# agentbox

One container per coding-agent session, on a host of your own, built with the [Dev Container CLI](https://github.com/devcontainers/cli). Each session gets its own clone of a workspace repo; you reach it over SSH straight into the container.

agentbox is three things:

- **A devcontainer Feature**, `ghcr.io/novibe-org/agentbox/agentbox`: sshd, helix, yazi, lazygit, delta, ripgrep, Cloudflare's [security-audit](https://github.com/cloudflare/security-audit-skill) skill, and the mounts that share session state across containers.
- **A CLI**, `agentbox`, that creates hosts and creates, opens, lists and deletes sessions from your machine.
- **A session API**, `agentboxd`, on each host, which creates its sessions and sets them up, whether your machine stays connected or not.

## Isolation

Sessions are isolated from each other and from your laptop, not from your accounts. Every session sees the same Claude Code login, GitHub login and git identity, and clones and pushes GitHub over HTTPS with that login. Your SSH agent is still forwarded in while you are connected. An agent in a session can push wherever you can.

## Setup at a glance

1. [Install the CLI](#the-cli) and [OpenTofu](https://opentofu.org/docs/intro/install/).
2. [Create a session host](#a-host-on-hetzner): `agentbox host create box2 --provider hetzner`.
3. [Make a workspace repo](#a-workspace) whose devcontainer uses the Feature.
4. `agentbox new <id> <owner/workspace> --host box2`, then [log in once](#log-in-once).

## The session host

A host is a server that `agentbox host create` made: Docker, Node, the Dev Container CLI and `agentboxd`, with a volume at `/var/lib/agentbox`, owned by uid 1000, that holds the shared state mounted into every session:

| Host                           | Container              | Holds                       |
| ------------------------------ | ---------------------- | --------------------------- |
| `/var/lib/agentbox/claude`     | `/agentbox/claude`     | Claude Code login, settings |
| `/var/lib/agentbox/gh`         | `/agentbox/gh`         | GitHub CLI login            |
| `/var/lib/agentbox/git`        | `/agentbox/git`        | git identity (`config`)     |
| `/var/lib/agentbox/pnpm-store` | `/agentbox/pnpm-store` | pnpm package store          |

The `security-audit` skill is installed in Claude Code's managed skills folder, `/etc/claude-code/.claude/skills/`, so it is in every session without touching the shared config.

agentboxd creates these directories if they are missing, and clones each session's workspace repo into `/var/lib/agentbox/sessions/<id>`, mounted at `/workspaces/<id>`. A session's container carries the label `agentbox.session=<id>`. The container user must be uid 1000, as `node` is in the Node images.

A workspace can share its own state the same way: keep it in another directory under `/var/lib/agentbox` and add a `mounts` entry to its `devcontainer.json`. The directory must exist before the session is created, or Docker creates it empty and owned by root.

### A host on Hetzner

`agentbox host create` creates the host with [OpenTofu](https://opentofu.org) and the module in [`modules/hetzner`](modules/hetzner): a server with Docker, the `agentbox` user and `agentboxd` of the CLI's version, a volume mounted at `/var/lib/agentbox`, and a firewall that lets in SSH only. Session clones and the shared logins live on the volume; containers and images live on the server's own disk.

Create an API token with read and write access in the [Hetzner Console](https://console.hetzner.com), under your project's Security > API tokens, then:

```bash
export HCLOUD_TOKEN=<token>
agentbox host create box2 --provider hetzner
```

The server is a `cpx32` (4 vCPU, 8 GB) in Nuremberg with a 50 GB volume. Each host keeps its OpenTofu state and its own SSH key in `~/.agentbox/hosts/<name>`; keep that directory, as it is what deletes the host later. `agentbox host create` refuses a name you already have, and returns once agentboxd reports the host healthy.

The CLI writes every host it creates, and the way into sessions, to `~/.ssh/agentbox.conf`, and puts `Include agentbox.conf` at the top of `~/.ssh/config`. `ssh box2` reaches the host, and `<id>.agentbox` a session.

### Other hosts

Hosts agentbox did not create have no agentboxd, and this version runs no sessions on them. Hosts created with DevPod, such as an earlier `claude-box`, keep working with [agentbox 0.1.0](https://github.com/novibe-org/agentbox/tree/v0.1.0) and Feature `:2`.

### The session API

agentboxd serves the API in [`agentboxd/openapi.yaml`](agentboxd/openapi.yaml) on a Unix socket, `/run/agentboxd/agentboxd.sock`, that only the `agentbox` user can open. No port is open for it: the CLI reaches it over SSH with `ssh <host> agentboxd dial-stdio`, as Docker's CLI reaches `dockerd`. It keeps one record per session, whether its setup finished or why it failed; the labelled containers and the clones hold the rest.

```bash
ssh box2 'curl -s --unix-socket /run/agentboxd/agentboxd.sock http://agentboxd/health'   # what the host can do
ssh box2 journalctl -u agentboxd                                                        # its log
```

The CLI and agentboxd change together, so the CLI refuses a host whose agentboxd is on another version.

## A workspace

A workspace is a git repo whose `.devcontainer` uses the Feature and clones the projects it works on:

```jsonc
// .devcontainer/devcontainer.json
{
  "name": "myworkspace",
  "image": "mcr.microsoft.com/devcontainers/typescript-node:22",
  "runArgs": ["--restart=unless-stopped"],
  "features": {
    "ghcr.io/anthropics/devcontainer-features/claude-code:1": {},
    "ghcr.io/devcontainers/features/github-cli:1": {},
    "ghcr.io/novibe-org/agentbox/agentbox:3": {}
  },
  "postCreateCommand": "bash .devcontainer/setup.sh"
}
```

```bash
# .devcontainer/setup.sh
set -euo pipefail
for repo in app plugins; do
  [ -d "projects/$repo/.git" ] || git clone "https://github.com/myorg/$repo.git" "projects/$repo"
done
(cd projects/app && pnpm install --frozen-lockfile)
```

Sessions clone and push GitHub over HTTPS with the shared GitHub login, or without credentials for a public repo before anyone has logged in; the Feature rewrites `git@github.com:` URLs to HTTPS, so existing setups keep working. agentboxd runs the setup without your machine, so it cannot use your SSH agent.

`agentbox rm` checks the workspace repo and every repo under `projects/` for unpushed work before deleting.

Good habits for a workspace repo:

- **Restart with the host**: `runArgs: ["--restart=unless-stopped"]`, as above, brings sessions back after the host or Docker restarts.
- **Ignore `projects/`** in its `.gitignore`. The cloned repos stay independent; `git add projects/` would turn them into gitlinks.
- **Keep `setup.sh` idempotent**: guard each clone, as above, so a rebuild doesn't fail on what is already there.
- **Install from lockfiles** (`--frozen-lockfile`, `npm ci`). With the shared pnpm store, a second session installs mostly from cache.
- **Check in `.claude/settings.json`** with the plugins and marketplaces the sessions need, so every session starts with the same Claude Code setup.
- **Add a `CLAUDE.md`** that names the repos under `projects/` and what each is for.

## The CLI

Install a release, and keep it on your `PATH`:

```bash
curl -fsSL https://github.com/novibe-org/agentbox/releases/download/v0.2.1/agentbox-darwin-arm64 -o ~/.local/bin/agentbox
chmod +x ~/.local/bin/agentbox
```

The CLI is one binary with nothing else to install: `agentbox-darwin-arm64` for Apple silicon, `agentbox-darwin-x64` for Intel Macs, `agentbox-linux-x64` for Linux. `agentbox --help` lists the commands.

It is written in TypeScript with [Commander](https://github.com/tj/commander.js) and compiled with [Bun](https://bun.sh); see [ADR 0002](docs/adrs/0002-commander-on-bun-compiled-to-one-binary.md). `npm ci && npm run build` builds it from a checkout into `dist/agentbox`.

Name the host and the workspace repo, or run from inside a checkout of the repo:

```bash
agentbox new fix-login myorg/workspace --host box2   # create a session and open it
agentbox new fix-login --host box2                   # same, from this directory's origin
agentbox open fix-login  # reconnect
agentbox ls
agentbox rm fix-login
```

`agentbox new` asks the host's agentboxd to create the session, records its host in `~/.agentbox/sessions/<id>`, and opens it once it is set up. The host sets it up whatever happens to your machine meanwhile. A session id is unique across your hosts. `open`, `rm` and `<id>.agentbox` find the session by its record; `<id>.agentbox` goes straight into the session's container through the host, and starts the container first if it is stopped.

`open` uses [cmux](https://cmux.dev) when run inside it, plain `ssh` otherwise.

### Configuration

| Variable           | Default                   | Meaning                                                                  |
| ------------------ | ------------------------- | ------------------------------------------------------------------------ |
| `AGENTBOX_MACHINE` |                           | SSH host for sessions created without `--host`                           |
| `AGENTBOX_REPO`    | this directory's `origin` | Workspace repo for `new`: a git URL, `owner/name` or `owner/name@branch` |
| `AGENTBOX_PUBKEY`  | `~/.ssh/id_ed25519.pub`   | Public key authorized in each new session                                |
| `HCLOUD_TOKEN`     |                           | API token of the Hetzner project hosts are created in                    |

Sessions created before `--host` have no record and go to `AGENTBOX_MACHINE`. Some tools run `ProxyCommand` without your shell profile, so set it where they see it too, such as `launchctl setenv AGENTBOX_MACHINE agent-host` on macOS.

`AGENTBOX_PUBKEY` must match the key SSH offers to `*.agentbox`. If you use another key, set both the variable and an `IdentityFile` with `IdentitiesOnly yes` in the `*.agentbox` block.

## Log in once

The logins live on the host, not in the container, so the first session sets them up for every later one. A private workspace repo needs the GitHub login before its first session, as the host clones it: log in on the host once with `ssh -t box2 GH_CONFIG_DIR=/var/lib/agentbox/gh gh auth login`.

```bash
claude                                   # log in to Claude Code
gh auth login                            # log in to GitHub
git config --global user.name  "Your Name"
git config --global user.email "you@example.com"
```

Deleting a session keeps them; only deleting the directories under `/var/lib/agentbox` on the host removes them.

## cmux

cmux opens links clicked in the terminal in its own browser. To open them in your Mac's browser instead, while keeping the session's forwarded dev servers in cmux, add this to `~/.config/cmux/cmux.json` and reload with ⌘⇧,:

```jsonc
"browser": {
  "hostsToOpenInEmbeddedBrowser": ["localhost", "*.localhost", "127.0.0.1", "::1", "0.0.0.0"]
}
```

Set `"openTerminalLinksInCmuxBrowser": false` instead to send every link out, localhost included.

## Best practices

- **One session per task.** Name it after the task (`fix-login`) and `agentbox rm` it once the work is merged. Sessions are cheap; a stale one still holds a clone and a container.
- **Push before you leave a session.** `rm` refuses to delete unpushed work, but losing the host loses it.
- **Let agents push branches, not `main`.** They act with your accounts; branch protection on your repos is the guard rail.
- **Rebuild instead of repairing.** If a session's environment drifts, `agentbox rm` and `agentbox new` with the same id start clean from the workspace repo.
- **Bring a stopped session back** with `agentbox open <id>`, which starts its container. Sessions without the restart policy stay down after the host reboots until then.
- **Watch the disk.** `ssh box2 df -h /var/lib/agentbox` shows the volume; `docker system prune` on the host clears old images after Feature updates.
