#!/bin/sh
# Puts the host on the developer's tailnet: join-tailnet.sh <auth key> <host name>.
# tailscaled keeps its state on the volume, so the host stays the same device.
set -eu
mkdir -p /var/lib/agentbox/tailscale /var/lib/tailscale
grep -q " /var/lib/tailscale " /etc/fstab || echo "/var/lib/agentbox/tailscale /var/lib/tailscale none bind 0 0" >> /etc/fstab
mountpoint -q /var/lib/tailscale || mount /var/lib/tailscale
command -v tailscale >/dev/null || curl -fsSL https://tailscale.com/install.sh | sh
tailscale up --auth-key="$1" --hostname="$2"
