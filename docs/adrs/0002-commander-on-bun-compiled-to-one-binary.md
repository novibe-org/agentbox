---
status: accepted
date: 2026-10-19
decision-makers: Stefan Stührmann
---

# Commander on Bun, compiled to one binary per platform

## Context and Problem Statement

The CLI is a Bash script of some 360 lines that parses its own arguments and grows with every slice: host creation now, then access, removal, stopping and more providers. What is it written in, and how does it reach the developer's machine?

## Decision Drivers

* Argument parsing, subcommands and help come from a widely used library, not agentbox's own code
* Installing the CLI needs nothing else on the developer's machine
* `agentbox proxy` starts fast, as it runs on every SSH connection to a session
* agentbox stays a thin layer that one person can maintain

## Considered Options

* Commander on Bun, compiled to one binary per platform
* Crust instead of Commander
* oclif instead of Commander
* yargs instead of Commander
* Node instead of Bun, published to npm
* Deno instead of Bun
* Bash, as it is

## Decision Outcome

Chosen option: "Commander on Bun, compiled to one binary per platform", because Commander is the most used argument parser for JavaScript and covers what agentbox needs, and `bun build --compile` turns the CLI into one file that installs with `curl` and starts in milliseconds. The CLI is TypeScript against `node:` APIs only, so moving to Node changes the build, not the code.

It shaped the views `containers` and `deployment`.

### Consequences

* Good, because subcommands, flags and `--help` are declared, not parsed by hand
* Good, because CI cross-compiles `darwin-arm64`, `darwin-x64` and `linux-x64` binaries and attaches them to the release, and nothing is published to a registry
* Good, because the scenarios run the built binary as they ran the script, so they carry over unchanged
* Bad, because each binary is some 80 MB, most of it the Bun runtime
* Bad, because Bun is a second runtime next to the Node that Cucumber and the session containers use

### Confirmation

The scenarios under `features/` run against the compiled binary in CI, and `agentbox proxy` is timed in a manual run on macOS before the first release.

## Pros and Cons of the Options

### Crust instead of Commander

* Good, because it generates a SKILL.md and an MCP server from the commands, so agents can drive the CLI
* Good, because it compiles to a binary with Bun itself
* Bad, because it is pre-1.0, started in 2026, and has one main maintainer
* Bad, because agents run inside sessions, not on the developer's machine where the CLI runs, and `--help` already tells an agent what it needs

### oclif instead of Commander

* Good, because it brings plugins, generators and installers for large CLIs
* Bad, because it is heavy for a handful of subcommands: one class per command, a command manifest and plugin loading
* Bad, because it discovers commands from the file system by default, which works against one compiled binary

### yargs instead of Commander

* Good, because it is about as widely used and parses as well
* Bad, because its chained, untyped builder reads worse in TypeScript than Commander's

### Node instead of Bun, published to npm

* Good, because it is the runtime the rest of novibe already uses
* Bad, because the developer's machine needs Node and npm before agentbox installs
* Bad, because it starts several times slower than Bun, on every SSH connection to a session
* Bad, because one binary from Node needs its single executable application build, more steps than `bun build --compile`

### Deno instead of Bun

* Good, because `deno compile` builds one binary as well, and its permission model can restrict what the CLI does
* Bad, because the permissions do not help a CLI whose job is running `ssh`, `tofu` and `docker`
* Bad, because Commander and other npm packages run through `npm:` specifiers and Deno's Node compatibility, which is more friction than Bun

### Bash, as it is

* Good, because it needs nothing to build, and the script is already written and released as v0.1.0
* Bad, because every subcommand and flag is parsed by hand, and each slice adds more
