---
status: accepted
date: 2026-10-22
decision-makers: Stefan Stührmann
---

# OpenSSH over the tailnet as the way into a host

## Context and Problem Statement

A Hetzner host opens SSH to the whole internet, and agentboxd, the sessions and the developer's work are behind it. ADR 0001 named a way in other than public SSH for each provider, and ADR 0003 kept SSH as the only way in, with its keys as the only credentials. How does a developer reach a host that opens no port?

## Decision Drivers

* The host opens no port to the internet
* SSH and its keys stay the one way in and the one credential, so the CLI, agentboxd's `dial-stdio`, the sessions' `ProxyCommand` and the pinned host keys work unchanged, and SSM on AWS ends at the same `sshd`
* Nothing the developer must own beyond an account: no domain, no public hostname
* The connection is as direct as the networks allow, since a session is a terminal the developer types into all day

## Considered Options

* OpenSSH over the developer's tailnet
* Tailscale SSH
* Cloudflare Tunnel with Cloudflare Access
* Public SSH open only to the developer's IP addresses

## Decision Outcome

Chosen option: "OpenSSH over the developer's tailnet", because it closes every port and leaves the login as it is: the host joins the tailnet, `sshd` answers only there, and the developer's machine, already on the tailnet, reaches it by its MagicDNS name.

It shaped the views `context`, `containers`, `deployment` and `createHost`.

### Consequences

* Good, because the host's firewall opens no port, and the tailnet is a second barrier in front of the SSH keys
* Good, because nothing in agentboxd, the sessions or the CLI's SSH path changes
* Good, because connections are direct WireGuard between the developer's machine and the host, relayed only when the networks block that
* Bad, because the developer needs a tailnet and an OAuth client that may create keys tagged `tag:agentbox`
* Bad, because a host on the tailnet is out of reach for anything not on it, a CI runner included

## Pros and Cons of the Options

### Tailscale SSH

* Good, because there are no SSH keys to create, place or rotate, and access is revoked once in the tailnet
* Bad, because the login becomes the tailnet identity, so Hetzner logs in differently from SSM on AWS
* Bad, because Tailscale manages the host keys, so the CLI's pinning goes
* Bad, because check mode's browser sign-in breaks the CLI's non-interactive calls

### Cloudflare Tunnel with Cloudflare Access

* Good, because the host only dials out, so it opens no port either
* Bad, because a public hostname needs a domain on Cloudflare
* Bad, because every connection runs through Cloudflare's edge, never directly
* Bad, because the developer's machine needs `cloudflared` as the SSH `ProxyCommand`, in front of agentbox's own
* Bad, because each host needs a tunnel, a DNS record and an Access application, where a tailnet needs one key

### Public SSH open only to the developer's IP addresses

* Good, because it needs no other service
* Bad, because the port stays open, and a developer's address changes with every network they work from
