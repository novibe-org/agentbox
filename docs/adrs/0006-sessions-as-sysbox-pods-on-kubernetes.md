---
status: accepted
date: 2026-10-25
decision-makers: Stefan Stührmann
---

# Sessions as Sysbox pods on Kubernetes

## Context and Problem Statement

agentboxd (ADR 0003) is a session API of our own on every host: it creates, lists and deletes sessions, sets them up in the background, and needs its own updates. Developers have to learn it, nothing else speaks it, and a session cannot run containers, so a workspace that develops against Kubernetes with Tilt cannot work in one. What should run sessions on a host?

## Decision Drivers

* A standard API that developers and tools already know, instead of one of our own
* A session can run its own containers and a local Kubernetes cluster, without privileges on the host
* The host stays ours: OpenTofu creates it, optionally on the tailnet, with SSH the only way in
* agentbox does not rebuild what an existing tool does better

## Considered Options

* k3s on the host, each session a pod with the Sysbox runtime, set up by a Helm chart
* Keep agentboxd, with Sysbox for the session containers
* Coder
* DevPod
* kube-hetzner as the host
* k3s on the host with privileged session pods

## Decision Outcome

Chosen option: "k3s on the host, each session a pod with the Sysbox runtime, set up by a Helm chart", because it puts sessions behind the Kubernetes API, and Sysbox gives each one its own Docker in a user namespace: root in a session is not root on the host, yet a workspace can start k3d and Tilt inside it.

The CLI keeps creating hosts with OpenTofu and wraps `helm` and `kubectl` for sessions; it reaches the host's Kubernetes API, which answers the host and its pods only, through an SSH tunnel, on the tailnet too. A session pod clones the workspace repo and runs its `devcontainer.json` with the Dev Container CLI in its own Docker. A running host changes through OpenTofu: k3s through the system-upgrade-controller, and the rest through `remote-exec` steps that the module's variables trigger. The Hetzner module is written so that it can be used, and later published, on its own.

It supersedes ADR 0003, and replaces ADR 0005's "later changes reach a host through agentboxd" with OpenTofu. It shaped the views `containers`, `deployment` and `createHost`.

### Consequences

* Good, because sessions are listed, inspected and deleted with `helm` and `kubectl`, and the CLI is a convenience on top
* Good, because a session can run containers and its own cluster without `privileged`
* Good, because agentboxd, its API and its updates go away
* Bad, because a host needs Sysbox, which supports Ubuntu and Debian and, on Ubuntu 24.04 and later, a local AppArmor rule for its FUSE mounts
* Bad, because a session with its own cluster costs about 0.5 to 1 GB of memory more
* Bad, because `remote-exec` steps are not tracked by OpenTofu and have to be idempotent
* Neutral, because what the module takes from kube-hetzner (MIT) keeps its copyright notice

### Confirmation

The scenarios under `features/` pass with sessions on k3s, in the cloud job against a real host. A spike on Ubuntu 26.04 with k3s 1.36 and Sysbox 0.7.1 ran a session pod with `hostUsers: false`, Docker in it, and k3d with Tilt inside.

## Pros and Cons of the Options

### Keep agentboxd, with Sysbox for the session containers

* Good, because it is a small change to what works
* Bad, because the session API stays our own

### Coder

* Good, because it runs workspaces, their network and their access, and is very active
* Bad, because it is AGPL with paid parts, which keeps it out of many companies
* Bad, because its dev containers need privileged Docker-in-Docker or Sysbox in every workspace, and it has no answer for Tilt

### DevPod

* Good, because it supports `devcontainer.json` natively on Docker, SSH and Kubernetes
* Bad, because it has had little activity since 2025

### kube-hetzner as the host

* Good, because it creates k3s on Hetzner with Tailscale, firewall and upgrades, and is active
* Bad, because it runs openSUSE Leap Micro with SELinux, which Sysbox does not support, and its smallest topology has two servers

### k3s on the host with privileged session pods

* Good, because it needs no Sysbox
* Bad, because a session that runs containers is root on the host
