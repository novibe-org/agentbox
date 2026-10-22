FROM ubuntu:24.04
RUN apt-get update -qq \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
    ca-certificates curl docker.io docker-buildx git openssh-server sudo xz-utils >/dev/null \
  && rm -rf /var/lib/apt/lists/* \
  && curl -fsSL https://nodejs.org/dist/v22.12.0/node-v22.12.0-linux-x64.tar.xz | tar -xJ -C /opt \
  && mv /opt/node-v22.12.0-linux-x64 /opt/node \
  && PATH=/opt/node/bin:$PATH npm i -g -s @devcontainers/cli@0.89.0 \
  && userdel -r ubuntu \
  && useradd -m -u 1000 -s /bin/bash agentbox \
  && echo 'agentbox ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/agentbox \
  && git config --system --add safe.directory '*' \
  && mkdir -p /run/sshd
COPY entrypoint.sh /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
