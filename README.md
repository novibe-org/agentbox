<img src=".github/icon.svg" alt="" width="96" height="96" align="right" />

# agentbox

One container per coding-agent session, on a host of your own, built with the [Dev Container CLI](https://github.com/devcontainers/cli). Each session gets its own clone of a workspace repo; you reach it over SSH straight into the container.

agentbox is three things:

- **A devcontainer Feature**, `ghcr.io/novibe-org/agentbox/agentbox`: sshd, helix, yazi, lazygit, delta, ripgrep, Cloudflare's [security-audit](https://github.com/cloudflare/security-audit-skill) skill, and the mounts that share session state across containers.
- **A CLI**, `agentbox`, that creates hosts and creates, opens, lists and deletes sessions from your machine.
- **A Helm chart** for one session: a pod on the host's [k3s](https://k3s.io) that runs with [Sysbox](https://github.com/nestybox/sysbox), has its own Docker, and sets its session up whether your machine stays connected or not.

## Isolation

Sessions are isolated from each other and from your laptop, not from your accounts. Every session sees the same Claude Code login, GitHub login and git identity, and clones and pushes GitHub over HTTPS with that login. Your SSH agent is still forwarded in while you are connected. An agent in a session can push wherever you can.

## Setup at a glance

1. [Install the CLI](#the-cli): `brew install novibe-org/tap/agentbox`, which brings [OpenTofu](https://opentofu.org/docs/intro/install/) along.
2. [Create a session host](#a-host-on-hetzner): `agentbox host create devbox --provider hetzner`.
3. [Make a workspace repo](#a-workspace) whose devcontainer uses the Feature.
4. `agentbox new <id> <owner/workspace> --host devbox`, then [log in once](#log-in-once).

## The session host

A host is a server that `agentbox host create` made: k3s, whose session pods run with the Sysbox runtime, and a volume at `/var/lib/agentbox`, owned by uid 1000, that holds the shared state mounted into every session:

| Host                           | Container              | Holds                       |
| ------------------------------ | ---------------------- | --------------------------- |
| `/var/lib/agentbox/claude`     | `/agentbox/claude`     | Claude Code login, settings |
| `/var/lib/agentbox/gh`         | `/agentbox/gh`         | GitHub CLI login            |
| `/var/lib/agentbox/git`        | `/agentbox/git`        | git identity (`config`)     |
| `/var/lib/agentbox/pnpm-store` | `/agentbox/pnpm-store` | pnpm package store          |

The `security-audit` skill is installed in Claude Code's managed skills folder, `/etc/claude-code/.claude/skills/`, so it is in every session without touching the shared config.

A session is a pod named after it, with the label `agentbox.session=<id>`. It clones the workspace repo onto its own volume at `/workspaces/<id>` and runs the repo's dev container in its own Docker, so the session can run containers, or a local Kubernetes cluster, without reaching the host's. Root in a session is not root on the host: Sysbox maps it to an unprivileged user. The dev container user must be uid 1000, as `node` is in the Node images.

The shared directories are on the volume, mounted `nosuid,nodev`, and every session can write them.

### A host on Hetzner

`agentbox host create` creates the host with [OpenTofu](https://opentofu.org) and the module in [`modules/hetzner`](modules/hetzner): an Ubuntu server with the `agentbox` user, a volume mounted at `/var/lib/agentbox`, and a firewall that lets in SSH only, or nothing for a host on your tailnet. Its cloud-init runs [`provision.sh`](modules/hetzner/provision.sh), which installs k3s and Sysbox and closes the Kubernetes API to all but the host and its pods. Session workspaces and the shared logins live on the volume; the sessions' images live on the server's own disk.

Create an API token with read and write access in the [Hetzner Console](https://console.hetzner.com), under your project's Security > API tokens, then:

```bash
export HCLOUD_TOKEN=<token>
agentbox host create devbox --provider hetzner
```

The server is a `cpx32` (4 vCPU, 8 GB) in Nuremberg with a 50 GB volume. Each host keeps its OpenTofu state and its own SSH key in `~/.agentbox/hosts/<name>`; keep that directory, as it is what deletes the host later. `agentbox host create` refuses a name you already have, and returns once k3s runs with Sysbox; it keeps the host's kubeconfig there too. A host created by an agentbox before 0.5 runs agentboxd, not k3s, and has to be created again.

The CLI writes every host it creates, and the way into sessions, to `~/.ssh/agentbox.conf`, and puts `Include agentbox.conf` at the top of `~/.ssh/config`. `ssh devbox` reaches the host, and `<id>.agentbox` a session.

#### On your tailnet

With `--tailnet` the host joins your [tailnet](https://tailscale.com/kb/1136/tailnet) and its firewall opens no port: you reach it over the tailnet only, still with OpenSSH and the host's own key. The module in [`modules/tailscale`](modules/tailscale) creates a single-use auth key tagged `tag:agentbox`, and the host's SSH entry names it by its MagicDNS name.

Create an [OAuth client](https://tailscale.com/kb/1215/oauth-clients) with write access to auth keys for `tag:agentbox`, then:

```bash
export TAILSCALE_OAUTH_CLIENT_ID=<id> TAILSCALE_OAUTH_CLIENT_SECRET=<secret>
agentbox host create devbox --provider hetzner --tailnet
```

A host you already have moves onto your tailnet with `agentbox host update devbox --tailnet`. Its sessions keep running; its firewall closes only once you reach the host over the tailnet, so a policy that keeps you out leaves it open as before.

Tailscale's default policy lets every device reach every other, so the coding agents on the host could reach your other devices. Give `tag:agentbox` no access of its own in your [tailnet policy](https://tailscale.com/kb/1337/policy-syntax), in place of the default rule that allows everything:

```json
{
  "tagOwners": { "tag:agentbox": ["autogroup:admin"] },
  "grants": [
    { "src": ["autogroup:member"], "dst": ["tag:agentbox"], "ip": ["22"] }
  ]
}
```

### Other hosts

Hosts agentbox did not create run no sessions of this version. Hosts created with DevPod, such as an earlier `claude-box`, keep working with [agentbox 0.1.0](https://github.com/novibe-org/agentbox/tree/v0.1.0) and Feature `:2`.

### Kubernetes on the host

The CLI reaches the host's Kubernetes API through an SSH tunnel, as no port is open for it, with [Helm](https://helm.sh) and [kubectl](https://kubernetes.io/docs/reference/kubectl/), which it needs on your machine (`brew install helm kubernetes-cli`). You can use them yourself the same way:

```bash
ssh -N -L 6443:127.0.0.1:6443 devbox &
kubectl --kubeconfig ~/.agentbox/hosts/devbox/kubeconfig get pods        # the sessions
kubectl --kubeconfig ~/.agentbox/hosts/devbox/kubeconfig logs fix-login  # a session's setup
helm --kubeconfig ~/.agentbox/hosts/devbox/kubeconfig list               # one release per session
```

The session chart is part of the CLI, so a session is made by the chart of the agentbox that created it.

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

Sessions clone and push GitHub over HTTPS with the shared GitHub login, or without credentials for a public repo before anyone has logged in; the Feature rewrites `git@github.com:` URLs to HTTPS, so existing setups keep working. The session pod runs the setup without your machine, so it cannot use your SSH agent.

`agentbox rm` checks the workspace repo and every repo under `projects/` for unpushed work before deleting.

Good habits for a workspace repo:

- **Ignore `projects/`** in its `.gitignore`. The cloned repos stay independent; `git add projects/` would turn them into gitlinks.
- **Keep `setup.sh` idempotent**: guard each clone, as above, so a rebuild doesn't fail on what is already there.
- **Install from lockfiles** (`--frozen-lockfile`, `npm ci`). With the shared pnpm store, a second session installs mostly from cache.
- **Check in `.claude/settings.json`** with the plugins and marketplaces the sessions need, so every session starts with the same Claude Code setup.
- **Add a `CLAUDE.md`** that names the repos under `projects/` and what each is for.

## The CLI

Install it with [Homebrew](https://brew.sh), which also installs OpenTofu:

```bash
brew install novibe-org/tap/agentbox
```

`brew upgrade agentbox` picks up new releases. Without Homebrew, download a release and keep it on your `PATH`:

```bash
curl -fsSL https://github.com/novibe-org/agentbox/releases/download/v0.2.1/agentbox-darwin-arm64 -o ~/.local/bin/agentbox
chmod +x ~/.local/bin/agentbox
```

The CLI is one binary with nothing else to install: `agentbox-darwin-arm64` for Apple silicon, `agentbox-darwin-x64` for Intel Macs, `agentbox-linux-x64` for Linux. `agentbox --help` lists the commands.

It is written in TypeScript with [Commander](https://github.com/tj/commander.js) and compiled with [Bun](https://bun.sh); see [ADR 0002](docs/adrs/0002-commander-on-bun-compiled-to-one-binary.md). `npm ci && npm run build` builds it from a checkout into `dist/agentbox`.

Name the host and the workspace repo, or run from inside a checkout of the repo:

```bash
agentbox new fix-login myorg/workspace --host devbox   # create a session and open it
agentbox new fix-login --host devbox                   # same, from this directory's origin
agentbox open fix-login  # reconnect
agentbox ls
agentbox rm fix-login
```

`agentbox new` installs the session's chart on the host, records its host in `~/.agentbox/sessions/<id>`, and opens the session once it is set up; a failed setup is shown with its reason. The pod sets itself up whatever happens to your machine meanwhile. A session id is unique across your hosts. `open`, `rm` and `<id>.agentbox` find the session by its record; `<id>.agentbox` goes straight into the session's dev container, through `kubectl exec` on the host.

`open` uses [cmux](https://cmux.dev) when run inside it, plain `ssh` otherwise.

### Configuration

| Variable           | Default                   | Meaning                                                                  |
| ------------------ | ------------------------- | ------------------------------------------------------------------------ |
| `AGENTBOX_MACHINE` |                           | SSH host for sessions created without `--host`                           |
| `AGENTBOX_REPO`    | this directory's `origin` | Workspace repo for `new`: a git URL, `owner/name` or `owner/name@branch` |
| `AGENTBOX_PUBKEY`  | `~/.ssh/id_ed25519.pub`   | Public key authorized in each new session                                |
| `HCLOUD_TOKEN`     |                           | API token of the Hetzner project hosts are created in                    |
| `TAILSCALE_OAUTH_CLIENT_ID`, `TAILSCALE_OAUTH_CLIENT_SECRET` | | OAuth client of the tailnet that `--tailnet` hosts join |

Sessions created before `--host` have no record and go to `AGENTBOX_MACHINE`. Some tools run `ProxyCommand` without your shell profile, so set it where they see it too, such as `launchctl setenv AGENTBOX_MACHINE agent-host` on macOS.

`AGENTBOX_PUBKEY` must match the key SSH offers to `*.agentbox`. If you use another key, set both the variable and an `IdentityFile` with `IdentitiesOnly yes` in the `*.agentbox` block.

## Log in once

The logins live on the host, not in the container, so the first session sets them up for every later one. A private workspace repo needs the GitHub login before its first session, as the host clones it: log in on the host once with `ssh -t devbox GH_CONFIG_DIR=/var/lib/agentbox/gh gh auth login`.

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
- **After a reboot** Kubernetes starts the session pods again, and each rebuilds its dev container from the workspace on its volume.
- **Watch the disk.** `ssh devbox df -h /var/lib/agentbox` shows the volume; each session keeps its own images, which go with `agentbox rm`.
