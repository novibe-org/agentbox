# Defined before every script that runs on the host.

# Where agentbox keeps its state. Hosts created by DevPod keep it on their volume
# at /home/devpod.
host_root() {
  if [ -d /var/lib/agentbox ]; then echo /var/lib/agentbox; else echo /home/devpod/.agentbox; fi
}

# The Dev Container CLI, kept under tools. The state directory's parent may belong
# to root, so npm's and Docker's state stay there too.
host_dc() {
  local t
  t=$(host_root)/tools
  PATH=$t/node/bin:$PATH DOCKER_CONFIG=$t/docker npm_config_cache=$t/npm \
    "$t/node_modules/.bin/devcontainer" "$@" </dev/null
}
