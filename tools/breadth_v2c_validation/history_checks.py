"""PHASES 11, 12, 14, 15, 17 — body-only census, body-vs-30m precedence evidence,
three-way comparison, time-series continuity, serving shape. SQLite only.
"""
import collections
import json
import math
import os
import shutil
import sqlite3
import statistics as st
import time

from common import ORIG_V2, PROD, SCRATCH, V1, ro, write

c = ro(SCRATCH)
R = {}

def load(conn, where=""):
    return {(u, d, m): (o, h, l, cc, s) for u, d, m, o, h, l, cc, s in conn.execute(
        "SELECT universe,date,metric,o,h,l,c,source FROM breadth_daily_ohlc " + where)}

new = load(c)
old = load(ro(ORIG_V2))
v1 = load(ro(V1))
prod = load(ro(PROD))
R["row_counts"] = {"corrected": len(new), "orig_v2": len(old), "v1": len(v1), "prod_snapshot": len(prod)}
R["prod_sources"] = {"%s|%s" % kv: n for kv, n in collections.Counter((k[0], v[4]) for k, v in prod.items()).most_common()}

# ── PHASE 11: body census ────────────────────────────────────────────────────
body = {k: v for k, v in new.items() if v[4].endswith("_body")}
R["body_total"] = len(body)
R["body_pct_of_artifact"] = round(100.0 * len(body) / len(new), 3)
R["body_by_universe"] = dict(collections.Counter(k[0] for k in body))
R["body_by_year"] = dict(sorted(collections.Counter(k[1][:4] for k in body).items()))
R["body_by_metric"] = dict(collections.Counter(k[2] for k in body).most_common())
R["body_by_universe_year"] = {u: dict(sorted(collections.Counter(k[1][:4] for k in body if k[0] == u).items()))
                              for u in ("uct", "us", "nasdaq", "nyse")}
per_ud = collections.Counter((k[0], k[1]) for k in body)
R["body_metrics_per_universe_session"] = dict(sorted(collections.Counter(per_ud.values()).items()))
R["whole_session_body"] = sorted("%s|%s" % k for k, n in per_ud.items() if n >= 30)
# how the original V2 held the same keys (it deleted rejected pct rows and kept the rest)
R["body_keys_in_orig_v2"] = dict(collections.Counter(
    ("absent" if k not in old else ("orig_flat" if old[k][1] == old[k][2] else "orig_full_candle"))
    for k in body))
# range of the same key in the orig V2 when it had one (what the body withholds)
wr = [old[k][1] - old[k][2] for k in body if k in old and old[k][1] > old[k][2]]
R["orig_v2_range_on_body_keys"] = {"n": len(wr), "median": st.median(wr) if wr else None,
                                   "p90": sorted(wr)[int(len(wr) * .9)] if wr else None}
# range context: full-candle ranges for the same metric, to see whether body keys cluster
# on volatile sessions
rng = collections.defaultdict(list)
for k, v in new.items():
    if not v[4].endswith("_body"):
        rng[k[2]].append(v[1] - v[2])
R["full_candle_range_median_by_metric"] = {m: round(st.median(x), 3) for m, x in rng.items()}
samp = sorted(body)[:: max(1, len(body) // 12)][:12]
R["body_samples"] = [{"key": k, "stored": new[k], "orig_v2": old.get(k), "v1": v1.get(k),
                      "prod": prod.get(k)} for k in samp]

# ── PHASE 12: body vs production intraday_recon (30m) ────────────────────────
def cmp(keys):
    d = collections.defaultdict(list)
    for k in keys:
        a, p = new[k], prod[k]
        for i, f in enumerate("ohlc"):
            d[f].append(a[i] - p[i])
        d["range_new"].append(a[1] - a[2]); d["range_prod"].append(p[1] - p[2])
    out = {"n": len(keys)}
    for f, x in d.items():
        ax = [abs(v) for v in x]
        out[f] = {"median_abs": round(st.median(ax), 4) if ax else None,
                  "mean": round(st.mean(x), 4) if x else None,
                  "exact_share": round(sum(1 for v in ax if v < 1e-9) / len(ax), 4) if ax and f in "ohlc" else None}
    return out
ov_body = [k for k in body if k in prod and prod[k][4] == "intraday_recon"]
ov_path = [k for k, v in new.items() if not v[4].endswith("_body") and k in prod and prod[k][4] == "intraday_recon"]
ov_body_cr = [k for k in body if k in prod and prod[k][4] == "close_recon"]
R["phase12"] = {
    "body_keys_overlapping_prod_intraday_recon": cmp(ov_body),
    "path_keys_overlapping_prod_intraday_recon": cmp(ov_path),
    "body_keys_overlapping_prod_close_recon": cmp(ov_body_cr),
    "body_keys_with_no_prod_row": sum(1 for k in body if k not in prod),
    "prod_intraday_recon_by_year": dict(sorted(collections.Counter(k[1][:4] for k, v in prod.items() if v[4] == "intraday_recon").items())),
    "overlap_by_metric_body": dict(collections.Counter(k[2] for k in ov_body).most_common()),
}
# per-year close disagreement, path rows vs prod intraday_recon — F1 decay signature
byy = collections.defaultdict(list)
for k in ov_path:
    byy[k[1][:4]].append(abs(new[k][3] - prod[k][3]))
R["phase12"]["path_vs_prod_close_absdiff_by_year"] = {y: round(st.median(x), 3) for y, x in sorted(byy.items())}

# ── PHASE 14: three-way ──────────────────────────────────────────────────────
def three(ref, name):
    agg = collections.defaultdict(lambda: collections.defaultdict(list))
    for k, a in new.items():
        b = ref.get(k)
        if b is None:
            continue
        agg[(k[0], k[2])][k[1][:4]].append(a[3] - b[3])
    out = {}
    for (u, m), yrs in sorted(agg.items()):
        out["%s|%s" % (u, m)] = {y: {"n": len(x), "med_abs": round(st.median([abs(v) for v in x]), 3),
                                     "med": round(st.median(x), 3),
                                     "exact": round(sum(1 for v in x if abs(v) < 1e-9) / len(x), 3)}
                                 for y, x in sorted(yrs.items())}
    return out
R["phase14_vs_orig_v2"] = three(old, "orig_v2")
R["phase14_vs_v1"] = three(v1, "v1")
R["phase14_vs_prod"] = three(prod, "prod")
R["phase14_keys_only_in_corrected_vs_orig"] = len(set(new) - set(old))
R["phase14_keys_only_in_orig_vs_corrected"] = len(set(old) - set(new))

# ── PHASE 15: continuity ─────────────────────────────────────────────────────
ser = collections.defaultdict(list)
for (u, d, m), v in sorted(new.items(), key=lambda kv: kv[0][1]):
    ser[(u, m)].append((d, v[3], v[1], v[2], v[4]))
flags = []
summary = {}
for (u, m), xs in sorted(ser.items()):
    cs = [x[1] for x in xs]
    diffs = [b - a for a, b in zip(cs, cs[1:])]
    med = st.median(diffs)
    mad = st.median([abs(v - med) for v in diffs]) or 1e-9
    z = [(abs(v - med) / (1.4826 * mad), i) for i, v in enumerate(diffs)]
    top = sorted(z, reverse=True)[:5]
    runs, cur = [], 1
    for a, b in zip(cs, cs[1:]):
        cur = cur + 1 if a == b else 1
        runs.append(cur)
    zero_run, zr = 0, 0
    for v in cs:
        zr = zr + 1 if v == 0 else 0
        zero_run = max(zero_run, zr)
    summary["%s|%s" % (u, m)] = {"n": len(cs), "first": xs[0][0], "last": xs[-1][0],
                                 "max_flat_run": max(runs) if runs else 1, "max_zero_run": zero_run,
                                 "top_robust_z": [(round(zz, 1), xs[i][0], xs[i + 1][0], cs[i], cs[i + 1]) for zz, i in top]}
    for zz, i in top:
        if zz > 12:
            flags.append({"u": u, "m": m, "z": round(zz, 1), "from": xs[i][0], "to": xs[i + 1][0],
                          "c_from": cs[i], "c_to": cs[i + 1], "src_to": xs[i + 1][4]})
R["phase15_series"] = summary
R["phase15_flags"] = sorted(flags, key=lambda f: -f["z"])[:300]
R["phase15_flag_count"] = len(flags)
# universe_count day-over-day swings (denominator changes)
uc = {}
for u in ("uct", "us", "nasdaq", "nyse"):
    xs = ser[(u, "universe_count")]
    jumps = sorted(((abs(b[1] / a[1] - 1), a[0], b[0], a[1], b[1]) for a, b in zip(xs, xs[1:])), reverse=True)[:8]
    uc[u] = [(round(j, 4), a, b, x, y) for j, a, b, x, y in jumps]
R["phase15_universe_count_largest_daily_changes"] = uc
# 2011 exchange start: us vs nasdaq+nyse around the boundary
R["phase15_2011_boundary"] = {m: {u: [(x[0], x[1]) for x in ser[(u, m)] if "2010-12-27" <= x[0] <= "2011-01-07"]
                                  for u in ("us", "nasdaq", "nyse")} for m in ("pct_above_50sma", "universe_count", "new_52w_highs")}

# ── PHASE 17: serving shape ──────────────────────────────────────────────────
TR = ("live", "intraday_recon_1m", "intraday_recon", "close_recon")
def timeit(conn, sql, args, n=5):
    ts = []
    for _ in range(n):
        t = time.perf_counter(); rows = conn.execute(sql, args).fetchall(); ts.append(time.perf_counter() - t)
    return {"ms_median": round(st.median(ts) * 1000, 2), "rows": len(rows),
            "plan": [r[3] for r in conn.execute("EXPLAIN QUERY PLAN " + sql, args)]}
qs = {
    "history_one_metric": ("SELECT date,o,h,l,c FROM breadth_daily_ohlc WHERE universe=? AND metric=? AND source IN (?,?,?,?) ORDER BY date", ("nyse", "pct_above_50sma") + TR),
    "recent_250_one_metric": ("SELECT date,o,h,l,c FROM breadth_daily_ohlc WHERE universe=? AND metric=? AND source IN (?,?,?,?) AND date>=? ORDER BY date", ("us", "pct_above_50sma") + TR + ("2025-09-11",)),
    "all_metrics_one_universe_full": ("SELECT date,metric,o,h,l,c FROM breadth_daily_ohlc WHERE universe=? AND source IN (?,?,?,?)", ("us",) + TR),
    "distinct_dates": ("SELECT DISTINCT date FROM breadth_daily_ohlc WHERE universe=? AND source IN (?,?,?,?) ORDER BY date", ("uct",) + TR),
    "one_date_all_metrics": ("SELECT metric,o,h,l,c FROM breadth_daily_ohlc WHERE universe=? AND date=?", ("nasdaq", "2020-03-16")),
}
R["phase17_as_is"] = {k: timeit(c, *v) for k, v in qs.items()}
tmp = "/tmp/v2c_serving_probe.db"
if os.path.exists(tmp):
    os.remove(tmp)
shutil.copyfile(SCRATCH, tmp)
os.chmod(tmp, 0o644)
w = sqlite3.connect(tmp)
w.execute("CREATE INDEX idx_probe_umd ON breadth_daily_ohlc(universe, metric, date)")
w.commit()
R["phase17_with_production_style_index"] = {k: timeit(w, *v) for k, v in qs.items()}
w.close(); os.remove(tmp)
R["phase17_note"] = "index measured on a throwaway /tmp copy (deleted); the frozen artifact and scratch copy are untouched"
print(write("history_checks.json", R))
print(json.dumps({k: R[k] for k in ("row_counts", "body_total", "body_pct_of_artifact", "body_by_universe",
                                    "body_by_year", "body_metrics_per_universe_session", "body_keys_in_orig_v2",
                                    "phase12", "phase15_flag_count", "phase17_as_is",
                                    "phase17_with_production_style_index")}, indent=1, default=str)[:12000])
