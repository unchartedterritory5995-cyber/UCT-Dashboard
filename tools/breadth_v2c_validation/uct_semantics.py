"""PHASE 10b — what the retrospective UCT membership does to the NUMBERS.

(1) SYMBOL REUSE: replay UCT on sample sessions twice — as stored, and with every pinned
    symbol excluded before the start of its CURRENT continuous trading segment (a >60
    session gap in the raw grouped files marks a handoff or a relisting). The difference
    is the contribution of securities that are not today's UCT company.
(2) The pinned list vs the collector's own point-in-time `universe_list` snapshots
    (2026-01-02 onward, copied read-only from the web volume beforehand if present).
"""
import collections
import json
import os
import sys

from common import GROUPED, PINNED_UCT, calendar, write
import oracle as O

dates = sys.argv[1].split(",")
cal = calendar()
ci = {d: i for i, d in enumerate(cal)}
pin = json.load(open(PINNED_UCT))["tickers"]
pinset = set(pin)
pres = collections.defaultdict(list)
for i, d in enumerate(cal):
    for k in json.load(open(os.path.join(GROUPED, "%s_0.json" % d))):
        if k in pinset:
            pres[k].append(i)
cur_start = {}
for t, idx in pres.items():
    s = idx[0]
    for a, b in zip(idx, idx[1:]):
        if b - a > 60:
            s = b
    cur_start[t] = cal[s]

S3 = O.s3()
res = {}
for D in dates:
    df = O.load_minutes(D, S3)
    O.membership(D, set())            # loads the reference map + pinned list once
    O._UCT = list(pin)
    base = O.replay(D, ("uct",), df=df)
    O._UCT = [t for t in pin if cur_start.get(t, "9999") <= D]
    orig_membership = O.membership
    def filtered(DD, traded, _keep=set(O._UCT)):
        m = orig_membership(DD, traded)
        m["uct"] = [t for t in m["uct"] if t in _keep]
        return m
    O.membership = filtered
    alt = O.replay(D, ("uct",), df=df)
    O.membership = orig_membership
    O._UCT = list(pin)
    diff = {}
    for m, x in base["uct"].items():
        if m.startswith("_") or m not in alt["uct"]:
            continue
        diff[m] = {"stored_basis_close": x["c"], "current_segment_only_close": alt["uct"][m]["c"],
                   "delta": round(alt["uct"][m]["c"] - x["c"], 4)}
    res[D] = {"members_asis": base["_sizes"]["uct"], "members_current_segment_only": alt["_sizes"]["uct"],
              "excluded": base["_sizes"]["uct"] - alt["_sizes"]["uct"], "metrics": diff}
    print(D, res[D]["members_asis"], res[D]["members_current_segment_only"],
          {k: v["delta"] for k, v in diff.items() if k in ("pct_above_50sma", "pct_above_200sma", "new_52w_highs", "new_52w_lows", "advancing", "declining", "hi_ratio")}, flush=True)
out = {"reuse_effect": res}
snap = "/data/_audit/validation/v2c_final/collector_universe_2026-09-21.json"
if os.path.exists(snap):
    col = set(json.load(open(snap)))
    out["pinned_vs_collector_2026_09_21"] = {"pinned": len(pinset), "collector": len(col),
                                             "in_both": len(pinset & col),
                                             "pinned_only": sorted(pinset - col)[:60], "pinned_only_n": len(pinset - col),
                                             "collector_only": sorted(col - pinset)[:60], "collector_only_n": len(col - pinset)}
    print(json.dumps(out["pinned_vs_collector_2026_09_21"])[:3000])
print(write("uct_semantics.json", out))
