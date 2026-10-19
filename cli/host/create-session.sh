# $1 session id, $2 repo URL, $3 branch or empty.
set -euo pipefail
d=$(host_root)/sessions/$1
if [ -n "$(docker ps -aq --filter "label=agentbox.session=$1")" ]; then
  echo "Session $1 exists: agentbox open $1, or agentbox rm $1 first" >&2
  exit 1
fi
# Clone fresh every time. A clone left by an earlier session may carry changes its
# agent made, and devcontainer.json's initializeCommand runs on the host.
rm -rf "$d"
GIT_SSH_COMMAND="ssh -o StrictHostKeyChecking=accept-new" git clone -q ${3:+-b "$3"} -- "$2" "$d"
# The Dev Container CLI writes a lockfile into the clone unless the repo has one, which
# would leave every session with uncommitted work. Use a committed one; else write none.
lock=--no-lockfile
[ ! -f "$d/.devcontainer/devcontainer-lock.json" ] && [ ! -f "$d/.devcontainer-lock.json" ] || lock=
host_dc up --workspace-folder "$d" --id-label "agentbox.session=$1" --skip-post-create $lock >/dev/null
