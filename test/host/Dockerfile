# Stands in for a server the Hetzner module creates: the agentbox user, sudo, Docker
# and the volume at /var/lib/agentbox. Docker is the test runner's, through its socket.
FROM ubuntu:24.04
RUN apt-get update -qq \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
    ca-certificates curl docker.io docker-buildx git openssh-server sudo xz-utils >/dev/null \
  && rm -rf /var/lib/apt/lists/* \
  && userdel -r ubuntu \
  && useradd -m -u 1000 -s /bin/bash agentbox \
  && echo 'agentbox ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/agentbox \
  && git config --system --add safe.directory '*' \
  && mkdir -p /run/sshd
COPY entrypoint.sh /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
