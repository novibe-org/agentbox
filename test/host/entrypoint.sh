#!/bin/sh
set -e
gid=$(stat -c %g /var/run/docker.sock)
getent group "$gid" >/dev/null || groupadd -g "$gid" hostdocker
usermod -aG "$(getent group "$gid" | cut -d: -f1)" agentbox
install -d -m 700 -o agentbox -g agentbox /home/agentbox/.ssh
printf '%s\n' "$AUTHORIZED_KEY" > /home/agentbox/.ssh/authorized_keys
chown agentbox:agentbox /home/agentbox/.ssh/authorized_keys
rm -f /etc/ssh/ssh_host_*
printf '%s\n' "$HOST_KEY" > /etc/ssh/ssh_host_ed25519_key
chmod 600 /etc/ssh/ssh_host_ed25519_key
ssh-keygen -y -f /etc/ssh/ssh_host_ed25519_key > /etc/ssh/ssh_host_ed25519_key.pub
exec /usr/sbin/sshd -D -e
