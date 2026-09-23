"""Census of the V2c2 bounded matrix artifact vs the frozen V2c (same sessions)."""
import collections, json, statistics as st, sys
from common import FROZEN, ro, write
import oracle2

NEW = sys.argv[1]
n, o = ro(NEW), ro(FROZEN)
q = lambda c, s, a=(): c.execute(s, a).fetchall()
R = {"integrity_check": q(n, "PRAGMA integrity_check")[0][0],
     "checkpoints": dict(q(n, "SELECT status, COUNT(*) FROM pass_checkpoint GROUP BY 1")),
     "rows": q(n, "SELECT COUNT(*) FROM breadth_daily_ohlc")[0][0],
     "sources": dict(q(n, "SELECT source, COUNT(*) FROM breadth_daily_ohlc GROUP BY 1")),
     "by_universe": dict(q(n, "SELECT universe, COUNT(*) FROM breadth_daily_ohlc GROUP BY 1"))}
# invariants (same checks as the final validation)
from api.services import breadth_metrics as bm
viol = collections.Counter()
for u, d, m, a, h, l, c, s in q(n, "SELECT universe,date,metric,o,h,l,c,source FROM breadth_daily_ohlc"):
    meta = bm.METRICS.get(m, {})
    if None in (a, h, l, c) or any(x != x for x in (a, h, l, c)): viol["null_nan"] += 1; continue
    if l > a + 1e-9 or l > c + 1e-9 or h < a - 1e-9 or h < c - 1e-9 or h < l - 1e-9: viol["candle"] += 1
    if meta.get("domain") == bm.DOMAIN_PCT and (min(a, h, l, c) < 0 or max(a, h, l, c) > 100): viol["pct_domain"] += 1
    if meta.get("unit") == bm.UNIT_COUNT and any(abs(x - round(x)) > 1e-9 for x in (a, h, l, c)): viol["count_int"] += 1
    if meta.get("domain") == bm.DOMAIN_NONNEG and min(a, h, l, c) < 0: viol["nonneg"] += 1
    if m.startswith("ratio_") and (min(a, h, l, c) <= 0): viol["ratio_nonpositive"] += 1
    if s.endswith("_body") and not (a == h == l == c): viol["body_not_flat"] += 1
R["invariant_violations"] = dict(viol)
R["metrics_per_universe"] = {u: sorted({m for (m,) in q(n, "SELECT DISTINCT metric FROM breadth_daily_ohlc WHERE universe=?", (u,))})
                             for u in ("uct", "uct_backtest", "us", "nasdaq", "nyse")}
R["metric_counts"] = {u: len(v) for u, v in R["metrics_per_universe"].items()}
R["ratio_rows"] = dict(q(n, "SELECT universe, COUNT(*) FROM breadth_daily_ohlc WHERE metric='ratio_5day' GROUP BY 1"))
# session geometry per universe vs calendar
geo = collections.Counter(); short = []
for d, ub, ex, lb in q(n, "SELECT date, universe_buckets, expected_buckets, last_bar_min FROM pass_session_v2c2"):
    for u, b in json.loads(ub).items():
        k = "exact" if b == ex else ("short" if b < ex else "over")
        geo[(u, k)] += 1
        if k != "exact": short.append((d, u, b, ex, lb))
    geo[("last_bar", lb)] += 1
R["geometry"] = {"%s|%s" % k: v for k, v in geo.items()}
R["geometry_not_exact"] = short[:60]
# withheld / dual-class per session
wh = collections.defaultdict(list); dual = collections.defaultdict(list); sizes = collections.defaultdict(list)
for d, us_, w, dc in q(n, "SELECT date, universe_sizes, withheld, dual_class_members FROM pass_session_v2c2"):
    for u, v in json.loads(w).items(): wh[u].append(v)
    for u, v in json.loads(dc).items(): dual[u].append(v)
    for u, v in json.loads(us_).items(): sizes[u].append(v)
R["withheld"] = {u: {"min": min(v), "mean": round(st.mean(v), 1), "max": max(v),
                     "max_share_pct": round(max(a / b * 100 for a, b in zip(v, sizes[u])), 2)} for u, v in wh.items()}
R["dual_class_members"] = {u: {"min": min(v), "mean": round(st.mean(v), 1), "max": max(v)} for u, v in dual.items()}
# NYSE / US close/high, new vs frozen on the same sessions
def ch(c, u):
    return [cc / h for d, h, cc in q(c, "SELECT date,h,c FROM breadth_daily_ohlc WHERE universe=? AND metric='universe_count'", (u,)) if h]
R["universe_count_close_over_high"] = {}
for u in ("us", "nyse", "nasdaq"):
    dn = {d for (d,) in q(n, "SELECT date FROM pass_checkpoint WHERE status='done'")}
    new = [cc / h for d, h, cc in q(n, "SELECT date,h,c FROM breadth_daily_ohlc WHERE universe=? AND metric='universe_count'", (u,))]
    old = [cc / h for d, h, cc in q(o, "SELECT date,h,c FROM breadth_daily_ohlc WHERE universe=? AND metric='universe_count'", (u,)) if d in dn]
    R["universe_count_close_over_high"][u] = {"new_mean": round(st.mean(new), 4), "new_min": round(min(new), 4),
                                              "old_mean_same_sessions": round(st.mean(old), 4) if old else None,
                                              "new_sessions_close_at_low": sum(1 for x in new if x < 0.999)}
# UCT population: old retrospective vs identity-safe back-test
cmp_ = {}
for d, us_ in q(n, "SELECT date, universe_sizes FROM pass_session"):
    s = json.loads(us_); r = q(o, "SELECT universe_sizes FROM pass_session WHERE date=?", (d,))
    if r and "uct_backtest" in s:
        cmp_[d] = {"old_retrospective_uct": json.loads(r[0][0]).get("uct"), "uct_backtest": s["uct_backtest"],
                   "canonical_pit_uct": s.get("uct")}
R["uct_population"] = {d: v for d, v in cmp_.items() if d in ("2008-10-10", "2011-01-03", "2015-08-24", "2020-03-16", "2024-08-05", "2026-09-11")}
R["body_rows_new_vs_old_same_keys"] = {"new_body": R["sources"].get("intraday_recon_1m_body", 0)}
print(write("v2c2_census.json", R))
print(json.dumps({k: v for k, v in R.items() if k not in ("metrics_per_universe", "geometry_not_exact")}, indent=1)[:6000])
print("GEOMETRY_NOT_EXACT", short[:40])
