---
status: accepted
date: 2026-10-19
decision-makers: Stefan Stührmann
---

# A session API on the host

## Context and Problem Statement

A developer keeps one host and creates and deletes many sessions on it, often several a day. Creating one clones the workspace, builds its container and runs its setup, which takes minutes. So far the CLI on the developer's machine has done all of it by sending shell scripts to the host over SSH, so the host has no say over its own sessions and a dropped connection breaks a session halfway. How do the CLI and the host share the work on sessions?

## Decision Drivers

* A session's setup finishes without the developer's machine
* The host's sessions follow one contract that the CLI and later clients use, and that tests drive
* No port opens on the host, and every provider's way in works: SSH today, Tailscale and AWS SSM next
* agentbox stays a thin layer that one person can maintain

## Considered Options

* agentboxd, an HTTP API on a Unix socket on the host, reached over SSH
* Shell scripts the CLI sends over SSH
* A host agent: the CLI's binary run over SSH, one command per call
* An OpenTofu provider with a session resource

## Decision Outcome

Chosen option: "agentboxd, an HTTP API on a Unix socket on the host, reached over SSH", because the host then owns its sessions: it sets them up in the background whatever the developer's machine does, and reports their state, its health and its version through one API. The CLI reaches the socket as Docker's CLI reaches `dockerd` over `ssh://`, through `agentboxd dial-stdio` on the host, so SSH stays the only way in and its keys the only credentials.

agentboxd is the CLI's codebase, compiled for Linux with it, installed of the CLI's version by the host's cloud-init and run by systemd. It keeps one record per session under `/var/lib/agentbox/sessions`, whether its setup finished or why it failed, so a restart neither passes an unfinished session as ready nor forgets a failed one; the containers labelled `agentbox.session` and the clones next to the records hold the rest. It clones from GitHub over HTTPS with the host's GitHub login, or without one for a public repo, and the Feature points sessions' git at HTTPS too, so setup needs no forwarded agent. Creating the host, its key and its SSH entry stay with the CLI and OpenTofu.

It shaped the views `containers`, `deployment`, `createHost`, `createSession` and `refuseTakenSession`.

### Consequences

* Good, because a session is created by one request and set up by the host, so the developer's machine can sleep once it is accepted
* Good, because readiness after creating a host is the API's health check, not a probe of the host's mounts
* Good, because stopping, starting and listing sessions, and clients other than the CLI, extend the API rather than the shell
* Bad, because agentboxd is a service to install, update and keep at the CLI's version; the CLI refuses a host on another version
* Bad, because hosts agentbox did not create have no agentboxd and run no sessions of this version, until a slice adds them
* Bad, because sessions clone and push GitHub over HTTPS with the shared GitHub login instead of the developer's forwarded SSH key

### Confirmation

The scenarios under `features/sessions/` create and refuse sessions through agentboxd, running in the test host as on a real one.

## Pros and Cons of the Options

### Shell scripts the CLI sends over SSH

* Good, because the host needs nothing but SSH, Docker and the Dev Container CLI
* Bad, because the work runs only while the developer's connection lasts
* Bad, because the host's logic is shell strings that no contract describes and no tool checks

### A host agent: the CLI's binary run over SSH, one command per call

* Good, because the host's logic is typed code, as DevPod's agent does it
* Bad, because the work still runs only while the developer's connection lasts
* Bad, because there is no place for what runs between calls, such as a health check or a setup in the background

### An OpenTofu provider with a session resource

* Good, because hosts and sessions would be managed alike
* Bad, because sessions are short-lived and created with one command, not declared in files and applied
* Bad, because a provider needs an API to talk to, and is written in Go
