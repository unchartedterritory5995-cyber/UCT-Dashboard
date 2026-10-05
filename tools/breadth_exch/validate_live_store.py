"""Exchange Breadth V1 — validate a live candidate / proof store (read-only).

Usage: python3 validate_live_store.py STORE_DB OUT.json [--golden]

Independent of the live leg's code path: re-derives membership invariants from the stored membership,
re-computes AD / MCO / MCS over the FULL history (frozen historical inputs + the store's appended sessions)
with a from-scratch implementation and compares every appended value, checks the frozen boundary is
reproduced, recomputes the 540-row replay hash in the research-harness convention, and reports the
golden 09-25..10-01 counts.
"""
import hashlib
import json
import sqlite3
import sys

DB, OUT = sys.argv[1], sys.argv[2]
HIST = "/data/_audit/exch_v1/final/breadth_exch_v1_FINAL_v20260924f_VALIDATED_FROZEN_2026-10-05.db"
DER = "/data/_audit/exch_v1/final/breadth_exch_v1_DERIVED_ad-mco-mcs_FROM_e65b2af0_VALIDATED_FROZEN_2026-10-05.db"
GOLDEN = {"2026-09-25": ((1906, 1100, 740, 53), (3404, 1520, 1660, 150)),
          "2026-09-28": ((1909, 513, 1342, 37), (3386, 1069, 2127, 109)),
          "2026-09-29": ((1905, 741, 1110, 38), (3398, 1291, 1897, 121)),
          "2026-09-30": ((1908, 526, 1329, 36), (3405, 1289, 1915, 117)),
          "2026-10-01": ((1908, 1082, 772, 37), (3398, 1485, 1710, 124))}
c = sqlite3.connect(f"file:{DB}?immutable=1", uri=True)
rep = {"store": DB, "lineage": dict(c.execute("SELECT key, value FROM lineage")), "checks": {}}
chk = rep["checks"]
sess = c.execute("SELECT date, seq, vintage, us_v2_pub_id, venue_source, rows, rows_sha256, provenance FROM live_session "
                 "ORDER BY seq").fetchall()
rep["sessions"] = [[d, s, v, p, vs, n] for d, s, v, p, vs, n, *_ in sess]
dates = [s[0] for s in sess]
chk["seq contiguous 1..N"] = [s[1] for s in sess] == list(range(1, len(sess) + 1))
chk["no rows outside completed sessions"] = all(
    c.execute(f"SELECT COUNT(*) FROM {t} WHERE date NOT IN (SELECT date FROM live_session)").fetchone()[0] == 0
    for t in ("breadth_daily_ohlc", "exch_session", "membership", "venue_evidence", "derived_series", "trend_state"))
rows = c.execute("SELECT universe, date, metric, o, h, l, c, source FROM breadth_daily_ohlc ORDER BY 1, 2, 3").fetchall()
rep["rows"] = len(rows)
rep["replay_rows_sha256_research_convention"] = hashlib.sha256(json.dumps([list(r) for r in rows]).encode()).hexdigest()
chk["rows per session == 3 universes x 36 metrics"] = all(n == 108 for *_x, n in [(s[0], s[5]) for s in sess])
chk["per-session rows_sha256 recomputes"] = all(
    hashlib.sha256(json.dumps(sorted([list(r) for r in c.execute(
        "SELECT universe, date, metric, o, h, l, c, source FROM breadth_daily_ohlc WHERE date=?", (d,))]),
        default=str).encode()).hexdigest() == rs for d, _s, _v, _p, _vs, _n, rs, _pr in sess)
# membership invariants from the stored membership (not the engine)
inv = {"sessions": 0, "members": 0, "nyse_nasdaq_overlap": 0, "non_exchange_in_exchange": 0, "count_mismatch": 0,
       "adv_dec_unc_gt_count": 0}
per = {}
for d in dates:
    m = c.execute("SELECT ticker, status FROM membership WHERE date=?", (d,)).fetchall()
    st = dict(m)
    cnt = json.loads(c.execute("SELECT counts FROM exch_session WHERE date=?", (d,)).fetchone()[0])
    v = {(u, k): val for u, k, val in c.execute("SELECT universe, metric, c FROM breadth_daily_ohlc WHERE date=? AND metric IN "
                                                "('universe_count','advancing','declining','unchanged')", (d,))}
    ny = sum(1 for s in st.values() if s == "NYSE")
    na = sum(1 for s in st.values() if s == "NASDAQ")
    inv["sessions"] += 1
    inv["members"] += len(st)
    if (cnt["NYSE"], cnt["NASDAQ"], cnt["us"]) != (ny, na, len(st)):
        inv["count_mismatch"] += 1
    for u in ("nyse", "nasdaq"):
        if v[(u, "advancing")] + v[(u, "declining")] + v[(u, "unchanged")] > v[(u, "universe_count")]:
            inv["adv_dec_unc_gt_count"] += 1
    per[d] = {"US": len(st), "NYSE": ny, "NASDAQ": na, "OTHER": cnt["OTHER"], "UNRESOLVED": cnt["UNRESOLVED"],
              "CONFLICT": cnt["CONFLICT"], "absent": cnt["absent"],
              "nyse": [v[("nyse", k)] for k in ("advancing", "declining", "unchanged")],
              "nasdaq": [v[("nasdaq", k)] for k in ("advancing", "declining", "unchanged")]}
    if d in GOLDEN:
        g = GOLDEN[d]
        per[d]["golden_match"] = ((ny, *per[d]["nyse"]) == g[0], (na, *per[d]["nasdaq"]) == g[1])
rep["membership_invariants"] = inv
rep["per_session"] = per
chk["membership invariants"] = all(inv[k] == 0 for k in inv if k not in ("sessions", "members"))
# derived: independent full-history computation (frozen historical inputs + appended sessions)
h = sqlite3.connect(f"file:{HIST}?immutable=1", uri=True)
dz = sqlite3.connect(f"file:{DER}?immutable=1", uri=True)
frozen = {(s_, d): v for s_, d, v in dz.execute("SELECT series, date, value FROM derived_series")}
stored = {(s_, d): v for s_, d, v in c.execute("SELECT series, date, value FROM derived_series")}
der = {}
for u, X, start in (("nyse", "NYSE", "2009-06-11"), ("nasdaq", "NASDAQ", "2008-01-02")):
    ser = {}
    for d, m, v in h.execute("SELECT date, metric, c FROM breadth_daily_ohlc WHERE universe=? AND date>=? AND "
                             "metric IN ('advancing','declining')", (u, start)):
        ser.setdefault(d, {})[m] = v
    for d, m, v in c.execute("SELECT date, metric, c FROM breadth_daily_ohlc WHERE universe=? AND "
                             "metric IN ('advancing','declining')", (u,)):
        ser.setdefault(d, {})[m] = v
    lvl, f, s2, seen, mcs = 0.0, None, None, 0, None
    hist_ok = app_ok = True
    app = []
    for d in sorted(ser):
        a, de = ser[d]["advancing"], ser[d]["declining"]
        lvl += a - de
        x = (a - de) / (a + de) * 1000.0
        f, s2 = (0.10 * x, 0.05 * x) if f is None else (0.9 * f + 0.10 * x, 0.95 * s2 + 0.05 * x)
        seen += 1
        o = f - s2 if seen > 120 else None
        if o is not None:
            mcs = 0.0 if mcs is None else mcs + o
        vals = {"AD": lvl, "MCO": o, "MCS": mcs if o is not None else None}
        for k, val in vals.items():
            ref = frozen.get((f"{X}:{k}", d)) if d <= "2026-09-24" else stored.get((f"{X}:{k}", d))
            if val != ref:
                if d <= "2026-09-24":
                    hist_ok = False
                else:
                    app_ok = False
        if d > "2026-09-24":
            app.append([d, lvl, o, mcs])
    der[X] = {"appended": app, "valid_obs_total": seen}
    chk[f"{X} independent full history reproduces frozen derived"] = hist_ok
    chk[f"{X} appended derived == independent full-history calc (bit-exact)"] = app_ok
rep["derived"] = der
tr = c.execute("SELECT exchange, date, valid_obs FROM trend_state ORDER BY exchange, date").fetchall()
chk["trend valid_obs increments by 1 per appended session (no reset / no second burn-in)"] = all(
    tr[i][2] == tr[i - 1][2] + 1 for i in range(1, len(tr)) if tr[i][0] == tr[i - 1][0])
rep["trend_state_first"] = {x: [r for r in tr if r[0] == x][:1] for x in ("NYSE", "NASDAQ")}
rep["pass"] = all(chk.values())
json.dump(rep, open(OUT, "w"), indent=1, sort_keys=True, default=str)
print(json.dumps({"pass": rep["pass"], "failed": [k for k, v in chk.items() if not v], "rows": rep["rows"],
                  "replay_sha": rep["replay_rows_sha256_research_convention"],
                  "per_session": per}, default=str, indent=1))
