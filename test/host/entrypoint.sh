#!/bin/sh
set -e
gid=$(stat -c %g /var/run/docker.sock)
getent group "$gid" >/dev/null || groupadd -g "$gid" hostdocker
usermod -aG "$(getent group "$gid" | cut -d: -f1)" agentbox
install -d -m 700 -o agentbox -g agentbox /home/agentbox/.ssh
printf '%s\n' "$AUTHORIZED_KEY" > /home/agentbox/.ssh/authorized_keys
chown agentbox:agentbox /home/agentbox/.ssh/authorized_keys
exec /usr/sbin/sshd -D -e
