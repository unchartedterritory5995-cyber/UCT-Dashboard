#!/bin/bash
# Run as root on the runner host, after Docker starts. Idempotent.
# Creates the CI bridge and limits it to outbound public internet: containers cannot reach each other,
# the host, the LAN, cloud metadata, or a tailnet. A job that needs a private address fails, on purpose.
set -euo pipefail
NET=uct-ci
BR=br-uctci
SUBNET=172.31.250.0/24

if ! docker network inspect "$NET" >/dev/null 2>&1; then
  docker network create --driver bridge --subnet "$SUBNET" --ipv6=false \
    -o com.docker.network.bridge.name="$BR" \
    -o com.docker.network.bridge.enable_icc=false "$NET" >/dev/null
fi

# FORWARD path: container to anywhere off this host.
iptables -N UCT-CI 2>/dev/null || iptables -F UCT-CI
for cidr in 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.0.0/16 100.64.0.0/10 127.0.0.0/8 224.0.0.0/4 240.0.0.0/4; do
  iptables -A UCT-CI -d "$cidr" -j REJECT --reject-with icmp-admin-prohibited
done
iptables -A UCT-CI -j RETURN
iptables -C DOCKER-USER -i "$BR" -j UCT-CI 2>/dev/null || iptables -I DOCKER-USER 1 -i "$BR" -j UCT-CI

# INPUT path: container to this host itself. DOCKER-USER never sees this traffic, so it needs its own
# rule. Docker's embedded DNS answers inside the container's namespace and is unaffected.
iptables -C INPUT -i "$BR" -j REJECT --reject-with icmp-admin-prohibited 2>/dev/null \
  || iptables -I INPUT 1 -i "$BR" -j REJECT --reject-with icmp-admin-prohibited

echo "uct-ci firewall: $BR limited to public internet, icc off"
