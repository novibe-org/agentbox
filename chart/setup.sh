#!/bin/sh
# Runs in a session pod: its own Docker, the workspace clone, then the workspace's dev container.
set -eu

# Only the Unix socket: Docker's TCP port would let any pod in the cluster use this session's Docker.
dockerd-entrypoint.sh dockerd --host=unix:///var/run/docker.sock >/var/log/dockerd.log 2>&1 &
until docker info >/dev/null 2>&1; do sleep 1; done

# The path out of the pod can carry smaller packets than Docker's bridge, and image builds ignore
# Docker's MTU; clamping TCP's segment size keeps their downloads from stalling.
iptables -t mangle -C FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null ||
  iptables -t mangle -A FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu

command -v devcontainer >/dev/null || {
  apk add -q git nodejs npm
  npm install -g -s @devcontainers/cli@0.89.0
}

workspace="/workspaces/$SESSION_ID"
# The dev container works as uid 1000, as sessions on a host did.
if [ ! -d "$workspace/.git" ]; then
  git clone -q ${SESSION_BRANCH:+-b "$SESSION_BRANCH"} -- "$SESSION_REPOSITORY" "$workspace"
  chown -R 1000:1000 "$workspace"
fi
# A failed setup keeps the pod up with its reason, so it can be read instead of restarting.
log=/workspaces/.$SESSION_ID-setup.log
if ! devcontainer up --workspace-folder "$workspace" >"$log" 2>&1; then
  tail -n 40 "$log" > /run/agentbox-failed
  cat /run/agentbox-failed
  wait
fi

container=$(docker ps -q --filter "label=devcontainer.local_folder=$workspace")
docker exec -i -u 1000 "$container" sh -c 'umask 077 && mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys' <<KEY
$SESSION_AUTHORIZED_KEY
KEY
touch /run/agentbox-ready
wait
