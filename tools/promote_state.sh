#!/usr/bin/env bash
# promote_state.sh write-pending '<decision json>' '<current blob sha or empty>'
# Makes deploy-gate-state/pending-promotion.json equal to the decision's `pending` (a record, or null = delete).
# I/O only. DRY_RUN=yes prints what it would do and writes nothing. Needs GH_TOKEN with contents: write.
set -uo pipefail
[ "${1:-}" = "write-pending" ] || { echo "usage: promote_state.sh write-pending <decision json> <blob>"; exit 2; }
DEC=$2; BLOB=${3:-}
REC=$(printf '%s' "$DEC" | python3 -c 'import json,sys; p=json.load(sys.stdin).get("pending"); print("" if p is None else json.dumps(p, sort_keys=True))')
API="/repos/${GITHUB_REPOSITORY}/contents/pending-promotion.json"
if [ -z "$REC" ]; then
  if [ -z "$BLOB" ]; then echo "pending-state: nothing pending (unchanged)"; exit 0; fi
  if [ "${DRY_RUN:-no}" = "yes" ]; then echo "DRY RUN: would CLEAR the pending record"; exit 0; fi
  gh api --method DELETE "$API" -f message="pending promotion cleared" -f branch=deploy-gate-state -f sha="$BLOB" >/dev/null \
    && echo "pending-state: CLEARED" \
    || { echo "::warning title=pending record not cleared::the next run re-reads it and decides again (Already promoted is idempotent)"; exit 0; }
  exit 0
fi
if [ "${DRY_RUN:-no}" = "yes" ]; then echo "DRY RUN: would WRITE the pending record $REC"; exit 0; fi
CONTENT=$(printf '%s\n' "$REC" | base64 -w0)
if [ -n "$BLOB" ]; then
  gh api --method PUT "$API" -f message="pending promotion $REC" -f branch=deploy-gate-state -f content="$CONTENT" -f sha="$BLOB" >/dev/null
else
  gh api --method PUT "$API" -f message="pending promotion $REC" -f branch=deploy-gate-state -f content="$CONTENT" >/dev/null
fi
RC=$?
if [ "$RC" = "0" ]; then echo "pending-state: WRITTEN $REC"; else echo "::warning title=pending record not written::$REC"; fi
exit "$RC"
