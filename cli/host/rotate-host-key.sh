# Runs as root; prints the new public host key.
set -euo pipefail
k=/etc/ssh/ssh_host_ed25519_key
rm -f "$k.new" "$k.new.pub"
ssh-keygen -q -t ed25519 -N '' -C '' -f "$k.new"
mv "$k.new" "$k" && mv "$k.new.pub" "$k.pub"
if [ -s /run/sshd.pid ]; then kill -HUP "$(cat /run/sshd.pid)"; else systemctl reload ssh; fi
cut -d' ' -f1,2 "$k.pub"
