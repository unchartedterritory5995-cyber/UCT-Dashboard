# UCT CI runner image: one fresh container per job, destroyed after it.
#
# Base matches what `ubuntu-latest` really is today. Read from real job logs (run 42156582311,
# 2026-11-06): "Image: ubuntu-26.04 / Version: 20261101.186.1", OS 26.04.1. The runner-images README
# still maps ubuntu-latest to 24.04; the logs win. Re-read a job log when bumping this.
#
# Pinned here: base (digest), runner, Node, Python (sha256 of each tarball).
# NOT version-pinned: Ubuntu's apt packages. They follow the base's archive at build time, so every
# build records them in /etc/uct-ci/image-manifest.txt, and the gate lane runs a built image by its
# sha256 ID, never a rebuild-by-tag (launcher.py refuses a tag).
FROM ubuntu:26.04@sha256:6a06111c3b0a8600feadb270aec771dc239bf407b25625f93f44ab00e11f4d3c

ARG RUNNER_VERSION=2.338.2
ARG RUNNER_SHA256=baebf204307bac6193480852732f0aba2ae97b6c5597c244f4d5558390147c40
ARG NODE_VERSION=20.20.2
ARG NODE_RELEASE=20.20.2-23521894959
ARG NODE_SHA256=cc47fc6eb872f905f48c85397856e8a097b2020bb65b394e728af606bfb6e1a9
ARG PYTHON_VERSION=3.12.16
ARG PYTHON_RELEASE=3.12.16-40260402378
ARG PYTHON_SHA256=635e1e2c9914bf144c977d6d14d8b6aaee2e3edcd7681d171e314016c73168f7

ENV AGENT_TOOLSDIRECTORY=/opt/hostedtoolcache \
    RUNNER_TOOL_CACHE=/opt/hostedtoolcache \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    TZ=UTC

# What jobs assume from the hosted image, and no more. ffmpeg and tesseract are absent on purpose:
# the hosted image has neither, and adding them would change which tests skip.
RUN set -eux; \
    export DEBIAN_FRONTEND=noninteractive; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      ca-certificates curl wget git git-lfs tar gzip xz-utils zstd unzip jq file procps \
      iproute2 lsb-release tzdata build-essential pkg-config libffi-dev libssl-dev zlib1g-dev \
      libicu-dev libkrb5-3 liblttng-ust1t64 libsqlite3-0 openssh-client; \
    rm -rf /var/lib/apt/lists/*

# Same UID as the hosted runner user. No sudo package, no setuid path to root: see sudo-shim.sh.
RUN set -eux; \
    groupadd -g 1001 runner; \
    useradd -u 1001 -g 1001 -m -d /home/runner -s /bin/bash runner; \
    mkdir -p /data /home/runner/work /home/runner/actions-runner /opt/hostedtoolcache /etc/uct-ci

RUN set -eux; \
    cd /home/runner/actions-runner; \
    curl -fsSL -o /tmp/runner.tgz "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz"; \
    echo "${RUNNER_SHA256}  /tmp/runner.tgz" | sha256sum -c -; \
    tar xzf /tmp/runner.tgz; rm /tmp/runner.tgz

# Pre-seeded tool cache: setup-node and setup-python find these and download nothing.
RUN set -eux; \
    d=/opt/hostedtoolcache/node/${NODE_VERSION}/x64; mkdir -p "$d"; \
    curl -fsSL -o /tmp/node.tgz "https://github.com/actions/node-versions/releases/download/${NODE_RELEASE}/node-${NODE_VERSION}-linux-x64.tar.gz"; \
    echo "${NODE_SHA256}  /tmp/node.tgz" | sha256sum -c -; \
    tar xzf /tmp/node.tgz -C "$d"; rm /tmp/node.tgz; touch "${d}.complete"; \
    mkdir /tmp/py; cd /tmp/py; \
    curl -fsSL -o /tmp/py.tgz "https://github.com/actions/python-versions/releases/download/${PYTHON_RELEASE}/python-${PYTHON_VERSION}-linux-26.04-x64.tar.gz"; \
    echo "${PYTHON_SHA256}  /tmp/py.tgz" | sha256sum -c -; \
    tar xzf /tmp/py.tgz; rm /tmp/py.tgz; bash ./setup.sh; cd /; rm -rf /tmp/py

COPY entrypoint.sh /usr/local/bin/uct-ci-entrypoint
COPY sudo-shim.sh /usr/local/bin/sudo
COPY isolation_probe.sh /usr/local/bin/uct-ci-isolation-probe

RUN set -eux; \
    chmod 0755 /usr/local/bin/uct-ci-entrypoint /usr/local/bin/sudo /usr/local/bin/uct-ci-isolation-probe; \
    chown -R 1001:1001 /data /home/runner /opt/hostedtoolcache; \
    find / -xdev -perm /6000 -type f -exec chmod a-s {} + 2>/dev/null || true; \
    { echo "base=ubuntu:26.04@sha256:6a06111c3b0a8600feadb270aec771dc239bf407b25625f93f44ab00e11f4d3c"; \
      echo "runner=${RUNNER_VERSION} node=${NODE_VERSION} python=${PYTHON_VERSION}"; \
      dpkg-query -W -f='${Package}=${Version}\n'; } > /etc/uct-ci/image-manifest.txt

USER 1001:1001
WORKDIR /home/runner
ENV PATH=/opt/hostedtoolcache/node/20.20.2/x64/bin:/opt/hostedtoolcache/Python/3.12.16/x64/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    LD_LIBRARY_PATH=/opt/hostedtoolcache/Python/3.12.16/x64/lib
ENTRYPOINT ["/usr/local/bin/uct-ci-entrypoint"]
