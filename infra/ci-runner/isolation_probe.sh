#!/bin/bash
# Isolation proof, run INSIDE a CI container. Prints one PASS/FAIL line per claim and exits 1 if any
# claim fails. It prints names and counts, never file contents or variable values.
#
#   uct-ci-isolation-probe            # all checks
#   PROBE_EXPECT_CPUS=4 PROBE_EXPECT_MEM_GIB=8 uct-ci-isolation-probe    # also pin the cgroup limits
#   PROBE_BLOCKED_HOSTS="192.168.1.1 172.17.0.1" uct-ci-isolation-probe  # also prove no route there
#
# Run on an ordinary machine this must FAIL: that is the control proving it can say no.
fails=0
pass() { echo "PASS $1"; }
fail() { echo "FAIL $1"; fails=$((fails + 1)); }

# ---- identity
if [ "$(id -u)" != "0" ]; then pass "non-root uid=$(id -u)"; else fail "running as root"; fi
capeff=$(awk '/^CapEff/{print $2}' /proc/self/status 2>/dev/null)
if [ "$capeff" = "0000000000000000" ]; then pass "no effective capabilities"; else fail "effective capabilities present (${capeff:-unreadable})"; fi
nnp=$(awk '/^NoNewPrivs/{print $2}' /proc/self/status 2>/dev/null)
if [ "$nnp" = "1" ]; then pass "no-new-privileges set"; else fail "no-new-privileges not set (${nnp:-unreadable})"; fi
seccomp=$(awk '/^Seccomp:/{print $2}' /proc/self/status 2>/dev/null)
if [ "$seccomp" = "2" ]; then pass "seccomp filter active"; else fail "seccomp filter not active (${seccomp:-unreadable})"; fi
suid=$(find / -xdev -perm /6000 -type f 2>/dev/null | wc -l)
if [ "$suid" = "0" ]; then pass "no setuid/setgid files"; else fail "$suid setuid/setgid files"; fi

# ---- host filesystem
for p in /mnt/c /mnt/d /mnt/wsl /mnt/wslg /c /Users /usr/lib/wsl /run/WSL /host /hostfs; do
  if [ -e "$p" ] && [ -n "$(ls -A "$p" 2>/dev/null)" ]; then fail "host path visible: $p"; else pass "host path absent or empty: $p"; fi
done
hostfs=$(awk '$3 ~ /^(9p|drvfs|virtiofs|nfs|nfs4|cifs|fuse.*)$/ {n++} END {print n+0}' /proc/mounts 2>/dev/null)
if [ "$hostfs" = "0" ]; then pass "no host-type mounts"; else fail "$hostfs host-type mounts in /proc/mounts"; fi
# Docker bind-mounts these itself (docker-init read-only, from --init). Anything else is a host mount.
binds=$(awk '$3 ~ /^ext[234]$|^xfs$|^btrfs$/ && $2 !~ /^\/etc\/(hosts|hostname|resolv\.conf)$/ && $2 != "/usr/sbin/docker-init" {n++} END {print n+0}' /proc/mounts 2>/dev/null)
if [ "$binds" = "0" ]; then pass "no bind mounts beyond Docker's own"; else fail "$binds block-device mounts beyond Docker's own"; fi

# ---- Docker control plane
for s in /var/run/docker.sock /run/docker.sock /run/containerd/containerd.sock; do
  if [ -e "$s" ]; then fail "container runtime socket present: $s"; else pass "no socket at $s"; fi
done
if command -v docker >/dev/null 2>&1; then fail "docker CLI present"; else pass "no docker CLI"; fi

# ---- credentials and siblings (names only)
for p in "$HOME/.ssh" "$HOME/.aws" "$HOME/.azure" "$HOME/.kube" "$HOME/.docker" "$HOME/.config/gh" \
         "$HOME/.claude" "$HOME/.git-credentials" "$HOME/.netrc" "$HOME/.npmrc" "$HOME/.pypirc" \
         "$HOME/.config/uct-ci"; do
  if [ -e "$p" ]; then fail "credential path present: $p"; else pass "no credential path: $p"; fi
done
keys=$(find / -xdev \( -name 'id_rsa' -o -name 'id_ed25519' -o -name 'id_ecdsa' -o -name '*.pem.key' \) \
       -not -path '/proc/*' -not -path '/sys/*' -not -path '/home/runner/work/*' 2>/dev/null | wc -l)
if [ "$keys" = "0" ]; then pass "no SSH private keys on disk"; else fail "$keys SSH private key files"; fi
envhits=$(env | cut -d= -f1 | grep -E -c '(^GH_|^GITHUB_TOKEN$|_API_KEY$|_SECRET|_PASSWORD$|^RAILWAY|^AWS_|^BROWSERSTACK|PAT$)' )
envset=0
for n in $(env | cut -d= -f1 | grep -E '(^GH_|^GITHUB_TOKEN$|_API_KEY$|_SECRET|_PASSWORD$|^RAILWAY|^AWS_|^BROWSERSTACK|PAT$)'); do
  if [ -n "${!n}" ]; then envset=$((envset + 1)); fi
done
if [ "$envset" = "0" ]; then pass "no credential-shaped env values set ($envhits names, all blank)"; else fail "$envset credential-shaped env vars have values"; fi
if [ -z "${ACTIONS_RUNNER_INPUT_JITCONFIG:-}" ]; then pass "JIT config not in this process's env"; else fail "JIT config visible in env"; fi

# ---- sibling repos: exactly the workspace under test, nothing else
repos=$(find / -xdev -type d -name .git -not -path '/proc/*' -not -path '/sys/*' 2>/dev/null | wc -l)
if [ "$repos" -le "${PROBE_MAX_REPOS:-1}" ]; then pass "git repositories on disk: $repos (max ${PROBE_MAX_REPOS:-1})"; else fail "$repos git repositories on disk (max ${PROBE_MAX_REPOS:-1})"; fi

# ---- limits
if [ -r /sys/fs/cgroup/cpu.max ]; then
  read -r quota period < /sys/fs/cgroup/cpu.max
  if [ "$quota" = "max" ]; then fail "no CPU limit"; else pass "CPU limit $((quota / period)) cpus"; fi
  if [ -n "${PROBE_EXPECT_CPUS:-}" ] && [ "$quota" != "max" ]; then
    if [ "$((quota / period))" = "$PROBE_EXPECT_CPUS" ]; then pass "CPU limit matches $PROBE_EXPECT_CPUS"; else fail "CPU limit is $((quota / period)), expected $PROBE_EXPECT_CPUS"; fi
  fi
else
  fail "cpu.max unreadable"
fi
if [ -r /sys/fs/cgroup/memory.max ]; then
  mem=$(cat /sys/fs/cgroup/memory.max)
  if [ "$mem" = "max" ]; then fail "no memory limit"; else pass "memory limit $((mem / 1073741824)) GiB"; fi
  if [ -n "${PROBE_EXPECT_MEM_GIB:-}" ] && [ "$mem" != "max" ]; then
    if [ "$((mem / 1073741824))" = "$PROBE_EXPECT_MEM_GIB" ]; then pass "memory limit matches $PROBE_EXPECT_MEM_GIB GiB"; else fail "memory limit is $((mem / 1073741824)) GiB, expected $PROBE_EXPECT_MEM_GIB"; fi
  fi
else
  fail "memory.max unreadable"
fi
swap=$(cat /sys/fs/cgroup/memory.swap.max 2>/dev/null)
if [ "$swap" = "0" ]; then pass "no swap"; else fail "swap limit is ${swap:-unreadable}"; fi
pids=$(cat /sys/fs/cgroup/pids.max 2>/dev/null)
if [ -n "$pids" ] && [ "$pids" != "max" ]; then pass "pids limit $pids"; else fail "no pids limit"; fi

# ---- network: outbound public yes, private ranges no
for h in ${PROBE_BLOCKED_HOSTS:-}; do
  if timeout 3 bash -c "exec 3<>/dev/tcp/$h/${PROBE_BLOCKED_PORT:-445}" 2>/dev/null; then
    fail "reached blocked host $h"
  else
    pass "cannot reach blocked host $h"
  fi
done

# ---- Windows dispatch
printf 'MZ' > /tmp/.probe-pe && chmod +x /tmp/.probe-pe
timeout 3 /tmp/.probe-pe >/dev/null 2>&1
rc=$?
rm -f /tmp/.probe-pe
if [ "$rc" = "124" ]; then fail "a PE file hung, so a binfmt handler is still claiming it"; else pass "a PE file is not dispatched to Windows (rc=$rc)"; fi

echo "isolation probe: $fails failure(s)"
if [ "$fails" -eq 0 ]; then exit 0; fi
exit 1
