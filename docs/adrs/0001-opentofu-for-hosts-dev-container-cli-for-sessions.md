---
status: accepted
date: 2026-10-18
decision-makers: Stefan Stührmann
---

# OpenTofu for hosts, the Dev Container CLI for sessions

## Context and Problem Statement

agentbox creates session hosts on several providers — Hetzner first, then local Docker and AWS — and runs sessions on them. Every provider needs a server, storage that outlives it, a firewall, and a way in that need not be public SSH: Tailscale on Hetzner, SSM on AWS. What does agentbox build on, and what does it write itself?

## Decision Drivers

* Public SSH can be closed on every provider that offers another way in
* Each provider's infrastructure is maintained by someone who follows its API
* Creating, stopping and deleting a host leaves nothing half-built or billed by mistake
* agentbox stays a thin layer that one person can maintain

## Considered Options

* OpenTofu modules with the vendors' providers, and the Dev Container CLI
* DevPod and its providers
* agentbox's own code against each provider's API
* Terraform instead of OpenTofu

## Decision Outcome

Chosen option: "OpenTofu modules with the vendors' providers, and the Dev Container CLI", because both are the standards the other options are built on, with the infrastructure maintained by the vendors and the session lifecycle by the Dev Container spec's own CLI. agentbox ships one OpenTofu module per provider and the glue around the two: clones, labels, agent forwarding, the `~/.ssh` entries, the check for unpushed work.

It shaped the views `containers`, `deployment` and `createHost`.

### Consequences

* Good, because `hetznercloud/hcloud`, `tailscale/tailscale` and `hashicorp/aws` follow their APIs, and agentbox does not
* Good, because a failed create rolls back, `tofu destroy` deletes, and a plan shows changes before they happen
* Good, because stopping a host is one variable: the server goes, the volume stays, which is what Hetzner's billing of stopped servers needs
* Bad, because `tofu` must be installed on the developer's machine
* Bad, because each host's state lives on the developer's machine, and a lost state means importing or deleting the host's resources by hand; once the state holds a secret, it is encrypted with OpenTofu's state encryption

### Confirmation

The scenarios under `features/hosts/` run against each module with `tofu` stubbed, and against Hetzner in a manual run before a release.

## Pros and Cons of the Options

### DevPod and its providers

* Good, because it creates the host and the session in one tool
* Bad, because the Hetzner provider connects to the server's public IP on port 22 and takes no cloud-init of its own, so closing public SSH means forking it
* Bad, because DevPod's Tailscale support works only with Loft's platform
* Bad, because the project has seen little activity since 2025

### agentbox's own code against each provider's API

* Good, because it adds no dependency
* Bad, because agentbox would write and maintain creation, rollback and deletion for every provider

### Terraform instead of OpenTofu

* Good, because it is the original and widely installed; the modules run on both
* Bad, because it is under the Business Source License since 1.6, while OpenTofu stays MPL 2.0 under the Linux Foundation and adds state encryption
