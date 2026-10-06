"""Exchange Breadth V1 — prove later snapshots + the append never reassigned a HISTORICAL session.

Usage: python3 history_sid_check.py STATE.json DATED_IDS_RLE.json OUT.json

Fresh causal replay of the frozen history only (2008-01-02..2026-09-24, ledger keys), then for EVERY
historical population member-session: SID(fresh replay) == SID(final state after B1, B2, B3 + append).
"""
import json
import os
import sys

STATE, RLE, OUT = sys.argv[1:4]
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import identity_model as im  # noqa: E402

X = "/data/_audit/exch_v1"
pop = json.load(open(X + "/population.json"))
S = pop["sessions"]
iend = max(i for i, d in enumerate(S) if d <= "2026-09-24")
rle = json.load(open(RLE))
members = [[] for _ in range(iend + 1)]
for ident, e in pop["identities"].items():
    segs, k = rle.get(ident, []), 0
    for a, b in e["runs"]:
        for i in range(a, min(b, iend) + 1):
            while k < len(segs) and segs[k][1] < i:
                k += 1
            cik = figi = None
            if k < len(segs) and segs[k][0] <= i <= segs[k][1]:
                cik, figi = segs[k][2], segs[k][3]
            members[i].append((e["ticker"], ident, cik, figi))
fresh = im.IdentityState(S)
for i in range(iend + 1):
    fresh.observe(i, members[i], "LEDGER")
final = json.load(open(STATE))["ticker_index"]


def sid_final(t, d):
    hit = [sid for a, b, sid in final.get(t, ()) if a <= d <= b]
    return hit[0] if len(hit) == 1 else ("MULTI" if hit else None)


n = diff = 0
ex = []
for i in range(iend + 1):
    for t, *_ in members[i]:
        n += 1
        a, b = fresh.sid_at(t, i), sid_final(t, S[i])
        if a != b:
            diff += 1
            if len(ex) < 20:
                ex.append([t, S[i], a, b])
rep = {"historical_member_sessions": n, "sid_differences": diff, "examples": ex, "pass": diff == 0}
json.dump(rep, open(OUT, "w"), indent=1)
print(json.dumps(rep))
