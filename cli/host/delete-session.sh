# $1 session id.
set -euo pipefail
c=$(docker ps -aq --filter "label=agentbox.session=$1" | head -1)
# The CLI builds <name>-features, then <name>-features-uid on top for the container.
img=$(docker inspect -f '{{.Config.Image}}' "$c")
docker rm -f "$c" >/dev/null
docker rmi "$img" "${img%-uid}" >/dev/null 2>&1 || true
rm -rf "$(host_root)/sessions/$1"
