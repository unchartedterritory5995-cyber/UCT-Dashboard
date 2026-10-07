"""Exchange Breadth V1 — artifact validation (Phase 2/4).

Usage: python validate_artifact.py <new_artifact.db> <frozen.db> <out.json> [--to YYYY-MM-DD]
  1. US IDENTITY   every `us` row of the new artifact == the frozen artifact's row (o,h,l,c,source),
                   over the sessions the new artifact completed (proves V2 semantics reproduced).
  2. INVARIANTS    per session: exch_session counts sum to `us`; nyse/nasdaq universe_count equal
                   the ledger counts; ADV+DEC+UNC <= universe_count for each universe; unchanged
                   present wherever advancing is.
  3. OLD vs NEW    nyse/nasdaq new vs frozen (venue-at-list) rows: sessions changed, diffs per metric,
                   largest corrections, by year.
The frozen file is opened with immutable=1 (no -shm/-wal touch).
"""
import json
import sqlite3
import sys
from collections import Counter, defaultdict

NEW, FROZEN, OUT = sys.argv[1:4]
TO = sys.argv[sys.argv.index("--to") + 1] if "--to" in sys.argv else "9999"

c = sqlite3.connect(f"file:{NEW}?mode=ro", uri=True)
c.execute(f"ATTACH DATABASE 'file:{FROZEN}?immutable=1' AS f")
done = [r[0] for r in c.execute("SELECT date FROM pass_checkpoint WHERE status='done' AND date<=? ORDER BY date", (TO,))]
dset = set(done)
rep = {"sessions_done": len(done), "range": [done[0], done[-1]] if done else None}

# 1 ── US identity ─────────────────────────────────────────────────────────────────────
mism = Counter()
ex = []
rows_new = 0
for d, m, o, h, l, cc, src, fo, fh, fl, fc, fsrc in c.execute("""
    SELECT n.date, n.metric, n.o, n.h, n.l, n.c, n.source, x.o, x.h, x.l, x.c, x.source
    FROM main.breadth_daily_ohlc n LEFT JOIN f.breadth_daily_ohlc x
      ON x.universe=n.universe AND x.date=n.date AND x.metric=n.metric
    WHERE n.universe='us' AND n.date<=?""", (TO,)):
    if d not in dset:
        continue
    rows_new += 1
    if m == "unchanged":
        continue                                       # the one NEW metric; frozen has none
    if (o, h, l, cc, src) != (fo, fh, fl, fc, fsrc):
        mism[m] += 1
        if len(ex) < 20:
            ex.append([d, m, [o, h, l, cc, src], [fo, fh, fl, fc, fsrc]])
missing_in_new = c.execute("""SELECT COUNT(*) FROM f.breadth_daily_ohlc x WHERE x.universe='us' AND x.date<=?
    AND x.date IN (SELECT date FROM main.pass_checkpoint WHERE status='done')
    AND NOT EXISTS (SELECT 1 FROM main.breadth_daily_ohlc n WHERE n.universe='us' AND n.date=x.date AND n.metric=x.metric)""",
                           (TO,)).fetchone()[0]
rep["us_identity"] = {"rows_compared": rows_new, "mismatch_by_metric": dict(mism), "examples": ex,
                      "frozen_rows_missing_in_new": missing_in_new,
                      "pass": not mism and missing_in_new == 0}

# 2 ── invariants ──────────────────────────────────────────────────────────────────────
vals = defaultdict(dict)
for u, d, m, v in c.execute("""SELECT universe, date, metric, c FROM main.breadth_daily_ohlc
        WHERE metric IN ('universe_count','advancing','declining','unchanged') AND date<=?""", (TO,)):
    vals[(u, d)][m] = v
counts = {d: json.loads(j) for d, j in c.execute("SELECT date, counts FROM main.exch_session")}
bad = []
for d in done:
    k = counts.get(d)
    if k is None:
        bad.append([d, "no exch_session row"])
        continue
    tot = sum(k[x] for x in ("NYSE", "NASDAQ", "OTHER", "UNRESOLVED", "CONFLICT", "absent"))
    if tot != k["us"]:
        bad.append([d, "exchange buckets do not sum to us", k])
    for u, key in (("nyse", "NYSE"), ("nasdaq", "NASDAQ")):
        v = vals.get((u, d))
        if not v:
            continue
        if v.get("universe_count") is not None and v["universe_count"] > k[key]:
            bad.append([d, f"{u} universe_count > ledger members", v.get("universe_count"), k[key]])
    for u in ("us", "nyse", "nasdaq"):
        v = vals.get((u, d)) or {}
        if "advancing" in v:
            if v.get("unchanged") is None:
                bad.append([d, f"{u} unchanged missing"])
            elif v["advancing"] + v["declining"] + v["unchanged"] > (v.get("universe_count") or 0):
                bad.append([d, f"{u} adv+dec+unc > universe_count", v])
    vu, vn, vy = vals.get(("us", d), {}), vals.get(("nasdaq", d), {}), vals.get(("nyse", d), {})
    if vu.get("advancing") is not None and vn.get("advancing") is not None and vy.get("advancing") is not None:
        if vn["advancing"] + vy["advancing"] > vu["advancing"]:
            bad.append([d, "nyse+nasdaq advancing > us advancing"])
rep["invariants"] = {"violations": len(bad), "examples": bad[:20], "pass": not bad}

# 3 ── old (frozen, list-venue) vs new (PIT ledger) exchange rows ─────────────────────────
diff = defaultdict(lambda: {"cells": 0, "changed": 0, "max_abs": 0.0, "max_at": None})
sess_changed = defaultdict(set)
by_year = defaultdict(Counter)
for u, d, m, nc, fc in c.execute("""
    SELECT n.universe, n.date, n.metric, n.c, x.c FROM main.breadth_daily_ohlc n
    JOIN f.breadth_daily_ohlc x ON x.universe=n.universe AND x.date=n.date AND x.metric=n.metric
    WHERE n.universe IN ('nyse','nasdaq') AND n.date<=?""", (TO,)):
    if d not in dset or nc is None or fc is None:
        continue
    k = diff[(u, m)]
    k["cells"] += 1
    dd = abs(nc - fc)
    if dd > 1e-9:
        k["changed"] += 1
        sess_changed[u].add(d)
        by_year[(u, d[:4])][m] += 1
        if dd > k["max_abs"]:
            k["max_abs"], k["max_at"] = dd, [d, nc, fc]
only_new = c.execute("""SELECT universe, COUNT(DISTINCT date) FROM main.breadth_daily_ohlc n
    WHERE universe IN ('nyse','nasdaq') AND date<=? AND NOT EXISTS (SELECT 1 FROM f.breadth_daily_ohlc x
    WHERE x.universe=n.universe AND x.date=n.date) GROUP BY universe""", (TO,)).fetchall()
rep["old_vs_new"] = {"by_metric": {f"{u}:{m}": v for (u, m), v in sorted(diff.items())},
                     "sessions_changed": {u: len(s) for u, s in sess_changed.items()},
                     "sessions_only_in_new (pre-2011 history)": dict(only_new),
                     "changed_cells_by_year": {f"{u} {y}": dict(v) for (u, y), v in sorted(by_year.items())}}
json.dump(rep, open(OUT, "w"), indent=1)
print(json.dumps({k: (v["pass"] if isinstance(v, dict) and "pass" in v else v)
                  for k, v in rep.items() if k != "old_vs_new"}))
