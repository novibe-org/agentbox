# Feature 1.x mounted shared state straight from /home/devpod, so move it once and
# leave links for those sessions. Then install Node and the Dev Container CLI, and
# make room for the sessions' clones.
set -euo pipefail
r=$(host_root)
for pair in claude-config:claude gh-config:gh git-config:git pnpm-store:pnpm-store; do
  old=/home/devpod/${pair%%:*} new=$r/${pair#*:}
  if [ "$r" = /home/devpod/.agentbox ] && [ -d "$old" ] && [ ! -L "$old" ] && [ ! -e "$new" ]; then
    sudo install -d -o 1000 -g 1000 "$r"
    sudo mv "$old" "$new" && sudo ln -s "$new" "$old"
  fi
  sudo install -d -o 1000 -g 1000 "$new"
done
t=$r/tools
sudo install -d -o 1000 -g 1000 "$t" "$r/sessions"
cd "$t"
if [ ! -x node/bin/node ]; then
  curl -fsSL https://nodejs.org/dist/v22.12.0/node-v22.12.0-linux-x64.tar.xz | tar xJ
  mv node-v22.12.0-linux-x64 node
fi
if [ "$(host_dc --version 2>/dev/null)" != 0.89.0 ]; then
  PATH=$t/node/bin:$PATH npm_config_cache=$t/npm npm i -s --prefix "$t" @devcontainers/cli@0.89.0
fi
