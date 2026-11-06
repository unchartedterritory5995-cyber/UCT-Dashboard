#!/bin/bash
# NOT sudo. It grants nothing. Two workflow steps run exactly this:
#     sudo mkdir -p /data && sudo chown "$(id -u):$(id -g)" /data
# The image already gives /data to the job user, so both are safe to run unprivileged. A real sudo
# needs a setuid binary, which `no-new-privileges` disables and this image does not ship.
# Anything else fails loudly, so a new workflow step that needs root is found, not faked.
if [ "$*" = "mkdir -p /data" ]; then
  exec mkdir -p /data
fi
if [ "$*" = "chown $(id -u):$(id -g) /data" ]; then
  exec chown "$(id -u):$(id -g)" /data
fi
echo "uct-ci sudo shim: refused (only the /data setup is allowed): $*" >&2
exit 1
