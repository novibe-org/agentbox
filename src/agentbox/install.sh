#!/usr/bin/env bash
# Runs as root at image build time.
set -euo pipefail

USER_HOME=${_REMOTE_USER_HOME:-/home/node}
USERNAME=${_REMOTE_USER:-node}
BIN=/usr/local/bin

LAZYGIT=0.65.1
DELTA=0.19.2
HELIX=25.07.1
YAZI=26.9.1

apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
  ca-certificates curl git openssh-server ripgrep unzip xz-utils >/dev/null
rm -rf /var/lib/apt/lists/*

curl -LsSf "https://github.com/jesseduffield/lazygit/releases/download/v$LAZYGIT/lazygit_${LAZYGIT}_linux_x86_64.tar.gz" | tar -xz -C "$BIN" lazygit
curl -LsSf "https://github.com/dandavison/delta/releases/download/$DELTA/delta-$DELTA-x86_64-unknown-linux-musl.tar.gz" | tar -xz -C "$BIN" --strip-components=1 "delta-$DELTA-x86_64-unknown-linux-musl/delta"
mkdir -p /usr/local/share/helix
curl -LsSf "https://github.com/helix-editor/helix/releases/download/$HELIX/helix-$HELIX-x86_64-linux.tar.xz" | tar -xJ -C /usr/local/share/helix --strip-components=1
ln -sf /usr/local/share/helix/hx "$BIN/hx"
curl -LsSfo /tmp/yazi.zip "https://github.com/sxyazi/yazi/releases/download/v$YAZI/yazi-x86_64-unknown-linux-musl.zip"
unzip -joq /tmp/yazi.zip yazi-x86_64-unknown-linux-musl/yazi yazi-x86_64-unknown-linux-musl/ya -d "$BIN" && rm /tmp/yazi.zip
if command -v corepack >/dev/null; then corepack enable --install-directory "$BIN" pnpm; fi

# Login shells over SSH don't see containerEnv, so repeat it here.
cat > /etc/environment <<ENV
PATH=$USER_HOME/.local/bin:/usr/local/share/npm-global/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
CLAUDE_CONFIG_DIR=/agentbox/claude
GH_CONFIG_DIR=/agentbox/gh
GIT_CONFIG_GLOBAL=/agentbox/git/config
npm_config_store_dir=/agentbox/pnpm-store
COREPACK_ENABLE_DOWNLOAD_PROMPT=0
EDITOR=hx
ENV

# The global git config is the shared identity on the host, so stack settings go in the system config.
git config --system core.pager delta
git config --system interactive.diffFilter "delta --color-only"
git config --system delta.navigate true
git config --system delta.line-numbers true
git config --system merge.conflictStyle zdiff3
git config --system url."git@github.com:".insteadOf "https://github.com/"
ssh-keyscan -t ed25519 github.com >> /etc/ssh/ssh_known_hosts 2>/dev/null

mkdir -p "$USER_HOME/.config/lazygit" "$USER_HOME/.ssh"
cat > "$USER_HOME/.config/lazygit/config.yml" <<'YAML'
git:
  diffRenderers:
    - command: delta --dark --paging=never --line-numbers
YAML
chown -R "$USERNAME:$USERNAME" "$USER_HOME/.config" "$USER_HOME/.ssh"
chmod 700 "$USER_HOME/.ssh"

cat >> /etc/bash.bashrc <<'SH'
[ "$PWD" = "$HOME" ] && for d in /workspaces/*/; do cd "$d"; break; done
SH
