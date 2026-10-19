# $1 session id.
set -euo pipefail
host_dc run-user-commands --workspace-folder "$(host_root)/sessions/$1" \
  --id-label "agentbox.session=$1" --remote-env SSH_AUTH_SOCK=/tmp/agentbox-agent.sock >/dev/null
