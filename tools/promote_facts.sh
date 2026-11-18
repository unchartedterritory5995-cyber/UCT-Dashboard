#!/usr/bin/env bash
# promote_facts.sh <candidate sha> <pending.json> : the git facts tools/promote_decision.py decides on, as JSON.
# I/O only — no decision is made here. Fetches master and production fresh (they may have moved during a wait).
#   candidate        the SHA
#   on_master        candidate ⊑ origin/master
#   prod_in_cand     origin/production ⊑ candidate   (a fast-forward is possible)
#   cand_in_prod     candidate ⊑ origin/production   ("Already promoted", and the stale-SHA guard)
#   pending          the pending record (or null); pending_in_cand / pending_in_prod: its SHA ⊑ candidate / production
#   master_tip       recorded for the summary and the tests' control ONLY; it is never a target
set -euo pipefail
SHA=$1; PEND=$2
git fetch --no-tags --quiet origin master production 2>/dev/null || git fetch --no-tags --quiet origin master
anc() { git merge-base --is-ancestor "$1" "$2" 2>/dev/null && echo true || echo false; }
TIP=$(git rev-parse origin/master)
PROD=$(git rev-parse --verify --quiet origin/production || echo "")
PSHA=$(python3 -c 'import json,sys; p=json.load(open(sys.argv[1])); print((p or {}).get("sha") or "")' "$PEND")
ON_MASTER=$(anc "$SHA" "$TIP")
if [ -n "$PROD" ]; then PIC=$(anc "$PROD" "$SHA"); CIP=$(anc "$SHA" "$PROD"); else PIC=false; CIP=false; fi
if [ -n "$PSHA" ] && git cat-file -e "${PSHA}^{commit}" 2>/dev/null; then
  PINC=$(anc "$PSHA" "$SHA"); if [ -n "$PROD" ]; then PINP=$(anc "$PSHA" "$PROD"); else PINP=false; fi
else PINC=false; PINP=false; fi
python3 - "$PEND" <<PY
import json, sys
print(json.dumps({"candidate": "$SHA", "master_tip": "$TIP", "production": "$PROD" or None,
                  "on_master": $( [ "$ON_MASTER" = true ] && echo True || echo False ),
                  "prod_in_cand": $( [ "$PIC" = true ] && echo True || echo False ),
                  "cand_in_prod": $( [ "$CIP" = true ] && echo True || echo False ),
                  "pending": json.load(open(sys.argv[1])),
                  "pending_in_cand": $( [ "$PINC" = true ] && echo True || echo False ),
                  "pending_in_prod": $( [ "$PINP" = true ] && echo True || echo False )}))
PY
