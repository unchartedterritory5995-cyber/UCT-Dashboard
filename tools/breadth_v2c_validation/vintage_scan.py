"""PHASE 7 — is the grouped ADJUSTED cache on ONE adjustment vintage?

`massive.get_grouped_daily_closes` caches split-ADJUSTED closes durably on the premise
that a settled date "never changes". For adjusted data that is false: every later split
restates every earlier adjusted close. The corrected pass builds levels (380 sessions),
the F1 factor (adj_D/raw_D) and the close from these files, so files fetched either side
of a split would put one name on two bases.

Per name, per consecutive pair of that name's sessions:
    f_D = adj_D / raw_D            (cumulative split factor as of the file's fetch)
A REAL corporate action on D+1: raw jumps, adjusted is continuous, f steps.
A VINTAGE BREAK:                 raw is continuous, adjusted jumps, f steps.
Also recorded: every f step at all (the corporate-action calendar the data implies), and
the fetch-time of each file so a break can be tied to the fetch boundary.
"""
import collections
import json
import math
import os
import time

from common import GROUPED, calendar, write

cal = calendar()
mt = {d: os.stat(os.path.join(GROUPED, "%s_1.json" % d)).st_mtime for d in cal}
prev_f, prev_raw, prev_adj, prev_d = {}, {}, {}, {}
events, breaks = [], []
steps_by_year = collections.Counter()
t0 = time.time()
for i, d in enumerate(cal):
    a = json.load(open(os.path.join(GROUPED, "%s_1.json" % d)))
    r = json.load(open(os.path.join(GROUPED, "%s_0.json" % d)))
    for t, av in a.items():
        rv = r.get(t)
        if not isinstance(av, (int, float)) or not isinstance(rv, (int, float)) or av <= 0 or rv <= 0:
            continue
        f = av / rv
        pf = prev_f.get(t)
        if pf is not None:
            step = f / pf
            if abs(math.log(step)) > math.log(1.02):
                r_raw = rv / prev_raw[t]
                r_adj = av / prev_adj[t]
                ev = {"t": t, "from": prev_d[t], "to": d, "f_step": round(step, 6),
                      "raw_ratio": round(r_raw, 4), "adj_ratio": round(r_adj, 4),
                      "fetch_from": time.strftime("%Y-%m-%dT%H:%MZ", time.gmtime(mt[prev_d[t]])),
                      "fetch_to": time.strftime("%Y-%m-%dT%H:%MZ", time.gmtime(mt[d]))}
                # vintage break: adjusted moves by roughly the step while raw does not
                if abs(math.log(r_adj)) > math.log(1.35) and abs(math.log(r_raw)) < math.log(1.15):
                    breaks.append(ev)
                steps_by_year[d[:4]] += 1
                if len(events) < 200000:
                    events.append(ev)
        prev_f[t], prev_raw[t], prev_adj[t], prev_d[t] = f, rv, av, d
    if i % 500 == 0:
        print(i, d, len(events), len(breaks), round(time.time() - t0), flush=True)

res = {"sessions": len(cal), "first": cal[0], "last": cal[-1],
       "fetch_window": [time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(min(mt.values()))),
                        time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(max(mt.values())))],
       "fetch_boundaries": [(cal[j], cal[j + 1],
                             time.strftime("%Y-%m-%dT%H:%MZ", time.gmtime(mt[cal[j]])),
                             time.strftime("%Y-%m-%dT%H:%MZ", time.gmtime(mt[cal[j + 1]])))
                            for j in range(len(cal) - 1) if abs(mt[cal[j + 1]] - mt[cal[j]]) > 3600],
       "factor_steps": len(events), "factor_steps_by_year": dict(sorted(steps_by_year.items())),
       "vintage_breaks": breaks,
       "vintage_break_count": len(breaks),
       "sample_real_actions": [e for e in events if e["t"] in ("AAPL", "TSLA", "NVDA", "AMZN", "GOOGL", "GOOG", "BCPC", "TPC")][:40]}
print(write("vintage_scan.json", res))
print(json.dumps({k: v for k, v in res.items() if k not in ("vintage_breaks", "sample_real_actions")}, indent=1))
print("BREAKS", json.dumps(breaks[:60], indent=0))
