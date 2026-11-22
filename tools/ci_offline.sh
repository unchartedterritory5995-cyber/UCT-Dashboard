#!/usr/bin/env bash
# tools/ci_offline.sh -- run a command with NO NETWORK, as the calling user (Linux CI runners only).
#
#   tools/ci_offline.sh npx vitest run src/components/chart/engine/ast/
#   tools/ci_offline.sh --self-check      # exit 0 only if egress is refused AND loopback works
#
# WHY (2026-11-15, .github/workflows/pine-heavy.yml). The Pine heavy jobs run on COMMITTED fixtures
# only. Licence-held material (docs/pine/LICENSING.md, tools/vendor_harness/licence_held.py) lives in
# an out-of-git store on the owner's machine and must never be fetched. The workflow pins every
# store env var to an empty directory; this wrapper is the second, independent half: the command
# runs in a fresh network namespace whose only interface is loopback, so a test that tries to
# fetch anything fails loudly (ENETUNREACH) instead of quietly passing on downloaded data.
#
# How: `sudo unshare --net` creates the namespace (GitHub's runner user has password-less sudo),
# brings `lo` up (tests bind 127.0.0.1), then drops back to the caller's uid/gid with `setpriv`
# before running the command, so nothing under test runs as root and files it writes stay owned by
# the runner. PATH and the rest of the environment are carried through (see the last lines).
set -euo pipefail

if [ "$(uname -s)" != "Linux" ]; then
  echo "ci_offline.sh: Linux only (network namespaces); refusing to run '$*' with the network on" >&2
  exit 2
fi
if [ "$#" -eq 0 ]; then
  echo "usage: tools/ci_offline.sh <command> [args...] | --self-check" >&2
  exit 2
fi

if [ "$1" = "--self-check" ]; then
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  # 1. Control: the same probe WITHOUT the wrapper must reach the network, or the check below
  #    proves nothing (a runner with no egress at all would pass it vacuously).
  if ! node -e "require('dns').lookup('github.com',e=>process.exit(e?1:0))"; then
    echo "ci_offline self-check: INCONCLUSIVE -- this runner cannot resolve github.com even without the wrapper" >&2
    exit 2
  fi
  # 2. Inside the wrapper: DNS and a raw TCP connect to a public address must both fail.
  if "$here/ci_offline.sh" node -e "require('dns').lookup('github.com',e=>process.exit(e?0:1))" \
     && "$here/ci_offline.sh" node -e "const s=require('net').connect(443,'1.1.1.1');s.setTimeout(3000,()=>process.exit(0));s.on('connect',()=>process.exit(1));s.on('error',()=>process.exit(0))"; then
    :
  else
    echo "ci_offline self-check: FAILED -- the wrapped command reached the network" >&2
    exit 1
  fi
  # 3. Loopback must still work (vitest workers and the pytest twins bind 127.0.0.1).
  "$here/ci_offline.sh" node -e "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{const p=s.address().port;require('net').connect(p,'127.0.0.1',function(){this.end();s.close();process.exit(0)}).on('error',()=>process.exit(1))})"
  # 4. And the command runs as the caller, never as root.
  who="$("$here/ci_offline.sh" id -u)"
  if [ "$who" != "$(id -u)" ]; then
    echo "ci_offline self-check: FAILED -- the wrapped command ran as uid $who, not $(id -u)" >&2
    exit 1
  fi
  # 5. And the caller's environment reaches it: a variable set here, and HOME (a wrapped command
  #    that sees root's HOME looks for the capture store under /root and cannot read it).
  if ! CI_OFFLINE_SENTINEL=carried "$here/ci_offline.sh" bash -c \
       'test "${CI_OFFLINE_SENTINEL:-}" = carried && test "$HOME" = "$1"' ci_offline "$HOME"; then
    echo "ci_offline self-check: FAILED -- the caller's environment did not reach the wrapped command" >&2
    exit 1
  fi
  echo "ci_offline self-check: OK (egress refused, loopback up, uid $who, environment carried)"
  exit 0
fi

uid="$(id -u)"
gid="$(id -g)"
# The caller's environment is carried through a FILE, not through sudo. GitHub's runners answer
# `sudo --preserve-env` with "preserving the entire environment is not supported" and drop it all:
# on the first run (43769127101) the store pins, the lane switch, the verdict directory, HOME and
# NODE_OPTIONS never reached the tests, so the "runtime-on" leg measured the production lane and
# no leg wrote its verdicts. The file is the caller's own (mode 600), is read after the drop back
# to the caller's uid, and is removed before the command starts.
envf="$(mktemp)"
export -p > "$envf"
inner='. "$1"; rm -f "$1"; shift; exec "$@"'
exec sudo env "PATH=$PATH" unshare --net -- \
  bash -c 'ip link set lo up && exec setpriv --reuid="$0" --regid="$1" --init-groups -- bash -c "$2" ci_offline "${@:3}"' \
  "$uid" "$gid" "$inner" "$envf" "$@"
