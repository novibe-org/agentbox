#!/bin/sh
# Runs in a session pod: its own Docker, the workspace clone, then the workspace's dev container.
set -eu

dockerd-entrypoint.sh dockerd >/var/log/dockerd.log 2>&1 &
until docker info >/dev/null 2>&1; do sleep 1; done

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
