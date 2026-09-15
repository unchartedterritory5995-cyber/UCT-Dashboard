#!/usr/bin/env bash
# Upload one local file into the web pod at $2 via railway ssh, gzip+base64 in chunks.
# Usage: pod_upload.sh <local file> <remote path>
#
# THIS WRITES INTO THE PRODUCTION WEB POD, AND UNTIL 2026-09-15 IT COULD NOT REPORT
# FAILURE. Four separate ways, every one of them a silent success:
#   * `set -u` only - a failing `gzip` or `base64` left B64 empty, the loop ran zero
#     times, and the script carried on;
#   * the decode step ended `| tail -2`, so the PIPELINE's status was tail's, and
#     tail returns 0 whatever happened upstream;
#   * the local and the remote sha were both PRINTED and never COMPARED - the one
#     question an upload exists to answer was left to a human eye;
#   * an abort mid-loop left a partial `<DST>.b64` on the production volume with
#     nothing to remove it.
#
# THREE THINGS MAKE IT HONEST NOW, and each fails for a different reason:
#   * `set -euo pipefail` - a failing stage IS the script's status.
#   * an EXIT/INT/TERM trap that removes the partial `<DST>.b64` ON THE POD, and the
#     half-written `<DST>` too when the decode had already run. This script wrote
#     both; leaving a truncated file at a path somebody is about to execute is worse
#     than failing loudly. It removes nothing it did not write.
#   * the remote sha is READ BACK AND COMPARED, and an ABSENT sha is a FAILED
#     invocation, never a pass - the pod printing nothing and the pod printing a
#     match are not the same fact (rule 14).
#
# The last statement is `exit 0`, deliberately. `echo` and `tail` both return 0
# whatever happened upstream, so either in final position hands the caller a success
# it never earned.
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: pod_upload.sh <local file> <remote path>" >&2
  exit 2
fi
SRC="$1"; DST="$2"
[ -r "$SRC" ] || { echo "!! cannot read local file: $SRC" >&2; exit 2; }
case "$DST" in
  /*) ;;
  *) echo "!! remote path must be absolute, got: $DST" >&2; exit 2 ;;
esac

# railway joins argv into ONE sh string on the pod, so every word here is a word
# there. Never pass a quoted compound - it does not survive the join.
pod() { MSYS_NO_PATHCONV=1 railway ssh -s web "$@"; }

STARTED=0   # a chunk was written  -> <DST>.b64 exists on the pod
DECODED=0   # the decode step ran  -> <DST> itself was created or truncated

cleanup() {
  rc=$?
  trap - EXIT
  if [ "$rc" -ne 0 ]; then
    if [ "$STARTED" -eq 1 ]; then
      echo "!! aborting (exit $rc) - removing the partial $DST.b64 on the pod" >&2
      if ! pod rm -f "$DST.b64" >/dev/null 2>&1; then
        echo "!! COULD NOT remove $DST.b64 on the pod - remove it by hand" >&2
      fi
    fi
    if [ "$DECODED" -eq 1 ]; then
      echo "!! removing $DST on the pod - this run wrote it and cannot vouch for it" >&2
      if ! pod rm -f "$DST" >/dev/null 2>&1; then
        echo "!! COULD NOT remove $DST on the pod - remove it by hand" >&2
      fi
    fi
  fi
  exit "$rc"
}
trap cleanup EXIT INT TERM

LOCAL_SHA=$(sha256sum "$SRC" | cut -d' ' -f1)
B64=$(gzip -9 -c "$SRC" | base64 -w0)
LEN=${#B64}
# NON-VACUITY: an empty payload uploads nothing, verifies nothing, and would fail
# the sha compare below for the wrong reason. Say which thing broke.
[ "$LEN" -gt 0 ] || { echo "!! gzip|base64 produced NOTHING for $SRC" >&2; exit 1; }
CH=6000
echo "upload $SRC -> $DST ($LEN b64 chars, $(( (LEN + CH - 1) / CH )) chunks, local sha $LOCAL_SHA)"

i=0; first=1
while [ "$i" -lt "$LEN" ]; do
  part=${B64:$i:$CH}
  if [ "$first" = 1 ]; then op=">"; first=0; else op=">>"; fi
  STARTED=1
  if ! pod echo "$part" "$op" "$DST.b64" >/dev/null 2>&1; then
    echo "!! chunk at offset $i of $LEN failed" >&2
    exit 1
  fi
  i=$((i + CH))
done

CMD=$(printf '%s' "base64 -d $DST.b64 | gunzip > $DST && rm -f $DST.b64 && sha256sum $DST" | base64 -w0)
DECODED=1
if ! RAW=$(pod echo "$CMD" "|" base64 -d "|" sh 2>&1); then
  echo "!! the pod refused the decode step - what it said follows:" >&2
  printf '%s' "$RAW" >&2
  echo >&2
  exit 1
fi

REMOTE_SHA=$(printf '%s' "$RAW" | grep -oE '[0-9a-f]{64}' | tail -1 || true)
if [ -z "$REMOTE_SHA" ]; then
  echo "!! the pod returned NO sha256. An empty result is a failed invocation, never" >&2
  echo "   a pass - what the pod said follows:" >&2
  printf '%s' "$RAW" >&2
  echo >&2
  exit 1
fi
if [ "$REMOTE_SHA" != "$LOCAL_SHA" ]; then
  echo "!! SHA MISMATCH - the pod does NOT hold what this machine sent." >&2
  echo "   local : $LOCAL_SHA" >&2
  echo "   remote: $REMOTE_SHA" >&2
  exit 1
fi

# Verified: the pod's copy IS this file, so the trap must not remove it from here on.
DECODED=0
echo "ok: $DST on web  sha $REMOTE_SHA  ($LEN b64 chars sent)"
exit 0
