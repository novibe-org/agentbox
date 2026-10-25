#!/bin/sh
# Sets up an agentbox host: k3s, whose sessions run with the Sysbox runtime.
# cloud-init runs it at the first boot; it can run again without harm.
set -eu

SYSBOX_VERSION=0.7.1
SYSBOX_SHA256=9d6d5484f980d0a17f86c492c1262015c2afb66280bdb97215b79fde6a0261c5
K3S_VERSION=v1.36.5+k3s1
STATE=/var/lib/agentbox

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates fuse3 jq >/dev/null

if ! command -v sysbox-runc >/dev/null; then
  curl -fsSLo /tmp/sysbox.deb "https://github.com/nestybox/sysbox/releases/download/v$SYSBOX_VERSION/sysbox-ce_${SYSBOX_VERSION}.linux_amd64.deb"
  echo "$SYSBOX_SHA256  /tmp/sysbox.deb" | sha256sum -c -
  apt-get install -y -qq /tmp/sysbox.deb >/dev/null
  rm /tmp/sysbox.deb
fi

# Ubuntu's fusermount3 profile forbids the FUSE mounts Sysbox makes for each container.
if [ -f /etc/apparmor.d/fusermount3 ]; then
  printf '%s\n' 'mount fstype=fuse -> /var/lib/sysboxfs/**,' 'umount /var/lib/sysboxfs/**,' > /etc/apparmor.d/local/fusermount3
  apparmor_parser -r /etc/apparmor.d/fusermount3
fi

mkdir -p /var/lib/rancher/k3s/agent/etc/containerd/config-v3.toml.d "$STATE/storage"
cat > /var/lib/rancher/k3s/agent/etc/containerd/config-v3.toml.d/sysbox.toml <<'EOF'
[plugins."io.containerd.cri.v1.runtime".containerd.runtimes.sysbox-runc]
  runtime_type = "io.containerd.runc.v2"
[plugins."io.containerd.cri.v1.runtime".containerd.runtimes.sysbox-runc.options]
  BinaryName = "/usr/bin/sysbox-runc"
  SystemdCgroup = true
EOF

# The Kubernetes API answers the host and its pods only; the CLI reaches it through an SSH tunnel.
cat > /etc/systemd/system/agentbox-api-guard.service <<'EOF'
[Unit]
Description=Close the Kubernetes API to all but the host and its pods
Before=k3s.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/sh -c 'iptables -C INPUT -p tcp --dport 6443 -j AGENTBOX-API 2>/dev/null || { iptables -N AGENTBOX-API; iptables -A AGENTBOX-API -s 127.0.0.0/8 -j RETURN; iptables -A AGENTBOX-API -s 10.42.0.0/16 -j RETURN; iptables -A AGENTBOX-API -j DROP; iptables -I INPUT -p tcp --dport 6443 -j AGENTBOX-API; }'
ExecStart=/bin/sh -c 'ip6tables -C INPUT -p tcp --dport 6443 ! -s ::1 -j DROP 2>/dev/null || ip6tables -I INPUT -p tcp --dport 6443 ! -s ::1 -j DROP'

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now agentbox-api-guard.service >/dev/null 2>&1

if ! command -v k3s >/dev/null; then
  curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION="$K3S_VERSION" sh -s - server \
    --write-kubeconfig-mode 600 \
    --default-local-storage-path "$STATE/storage" \
    --disable traefik --disable servicelb >/dev/null
fi

# A pod can be created once the node is ready and the default service account exists.
until k3s kubectl get nodes 2>/dev/null | grep -q ' Ready'; do sleep 2; done
until k3s kubectl get serviceaccount default >/dev/null 2>&1; do sleep 2; done
k3s kubectl apply -f - >/dev/null <<'EOF'
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: sysbox-runc
handler: sysbox-runc
EOF
