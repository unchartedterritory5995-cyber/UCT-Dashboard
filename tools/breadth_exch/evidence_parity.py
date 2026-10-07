"""Exchange Breadth V1 — LIVE venue evidence vs the ACCEPTED ledger on a session both cover (read-only).

Usage: python3 evidence_parity.py TOOLS_DIR PROOF_DB SESSION OUT_DIR

Acquires the session's dated venue lists + SIP tape for every US member the proof store recorded for that
session (cached under OUT_DIR), classifies them with live_core.classify_session (the worker's exact
path), and compares each member's live status with the status the accepted frozen ledger gave it.
"""
import collections
import gzip
import json
import os
import sqlite3
import sys

TOOLS, DB, D, OUT = sys.argv[1:5]
sys.path.insert(0, TOOLS)
import acquire_dated_venues as adv     # noqa: E402
import acquire_tape_and_build as atb   # noqa: E402
import breadth_venue_ledger as vl      # noqa: E402
import live_core as lc                 # noqa: E402

os.makedirs(OUT, exist_ok=True)
c = sqlite3.connect(f"file:{DB}?immutable=1", uri=True)
mem = dict(c.execute("SELECT ticker, status FROM membership WHERE date=?", (D,)))
dp = os.path.join(OUT, f"dated_{D}.json.gz")
if not os.path.exists(dp):
    with gzip.open(dp, "wt") as fh:
        json.dump(adv.fetch_day(D, adv._key()), fh)
dated = json.load(gzip.open(dp, "rt"))
tp = os.path.join(OUT, f"tape_{D}.json")
tapes = json.load(open(tp)) if os.path.exists(tp) else {}
need = [t for t in mem if t not in tapes]
if need:
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=8) as ex:
        for t, v in zip(need, ex.map(lambda t: atb.tape(t, D), need)):
            tapes[t] = v
    json.dump(tapes, open(tp, "w"), sort_keys=True)
live = lc.classify_session(D, sorted(mem), dated, tapes, vl)
pairs = collections.Counter((mem[t], live[t]["status"]) for t in mem)
diff = [[t, mem[t], live[t]] for t in sorted(mem) if mem[t] != live[t]["status"]]
exch = [x for x in diff if x[1] in ("NYSE", "NASDAQ") or x[2]["status"] in ("NYSE", "NASDAQ")]
rep = {"session": D, "members": len(mem), "agree": sum(v for (a, b), v in pairs.items() if a == b),
       "pairs_ledger_vs_live": {f"{a}->{b}": v for (a, b), v in sorted(pairs.items())},
       "differences": len(diff), "exchange_affecting_differences": len(exch), "examples": diff[:40],
       "tape_probes": len(tapes), "dated_venues": {k: len(v) for k, v in dated.items()}}
json.dump(rep, open(os.path.join(OUT, f"EVIDENCE_PARITY_{D}.json"), "w"), indent=1, sort_keys=True, default=str)
print(json.dumps({k: rep[k] for k in ("session", "members", "agree", "differences", "exchange_affecting_differences",
                                       "pairs_ledger_vs_live")}, default=str))
for x in diff[:25]:
    print(x)
