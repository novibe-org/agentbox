---
status: accepted
date: 2026-10-23
decision-makers: Stefan Stührmann
---

# A module change never replaces a running host

## Context and Problem Statement

A host's server gets the Hetzner module's cloud-init as its user data, and Hetzner replaces a server whose user data changes. Every change to cloud-init in a new release, such as joining the tailnet, would replace every existing host's server when it is next applied, and stop the sessions on it. How does a module change reach a host that is already running?

## Decision Drivers

* A running host's sessions keep running through an update
* The developer never loses a session to a change they did not ask for
* agentbox stays a thin layer that one person can maintain

## Considered Options

* cloud-init runs at the first boot only; later changes reach a host through agentboxd
* A changed cloud-init replaces the server, and the volume carries the state across
* Configuration management, such as Ansible, run against every host on each change

## Decision Outcome

Chosen option: "cloud-init runs at the first boot only; later changes reach a host through agentboxd", because it is the only option that never stops a session: the Hetzner module ignores changes to the server's user data, and a change a running host needs is a call on agentboxd's API, as ADR 0003 has the host do its own work.

It shaped the view `containers`.

### Consequences

* Good, because applying a new release's module never replaces a server
* Good, because each change that existing hosts need is an explicit, tested call, not a side effect of the next apply
* Bad, because a host's cloud-init shows how it was created, not how it is now
* Bad, because a change to cloud-init reaches only new hosts unless agentboxd also learns it

## Pros and Cons of the Options

### A changed cloud-init replaces the server, and the volume carries the state across

* Good, because every host is built from the same cloud-init
* Bad, because every session's container is lost on each such change

### Configuration management, such as Ansible, run against every host on each change

* Good, because a host's state follows its configuration, whatever changes
* Bad, because it is a second tool and a second way into the host, beside agentboxd
