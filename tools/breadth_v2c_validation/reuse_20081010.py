"""PHASE 2 — reproduce and explain the 2008-10-10 UCT population change."""
import collections, json
from common import write
import oracle as O
import oracle2

D = "2008-10-10"
df = O.load_minutes(D, O.s3())
traded = set(df["ticker"].unique())
pin = json.load(open("/data/_audit/validation/pinned_uct_universe.json"))["tickers"]
old = [t for t in pin if t in traded]                       # V2c's retrospective UCT
allowed = oracle2.identity_allowed_fn()
L = json.load(open("/data/_audit/v2cc/inputs/uct_identity_table_v3.json"))["tickers"]
def rule(t):
    for s0, s1, frm, r, det in L.get(t, ()):
        if s0 <= D <= s1:
            return (r if (frm and D >= frm) else r + ("_BEFORE_ADOPTION" if frm else "")), det
    return "NO_SEGMENT", None
kept = [t for t in old if allowed(t, D)]
dropped = [t for t in old if not allowed(t, D)]
# the earlier >60-session-gap estimate
cal = oracle2.CAL
gap_drop = set()
for t in old:
    idx = [i for i, d in enumerate(cal) if t in oracle2.gfile(d, False)] if False else None
R = {"date": D, "old_retrospective_members": len(old), "identity_kept": len(kept), "identity_dropped": len(dropped),
     "dropped_by_rule": dict(collections.Counter(rule(t)[0] for t in dropped)),
     "dropped_examples": [(t, *rule(t)) for t in sorted(dropped)[:60]]}
print(write("reuse_20081010.json", R))
print(json.dumps({k: v for k, v in R.items() if k != "dropped_examples"}, indent=1))
for x in R["dropped_examples"][:30]:
    print(x)
