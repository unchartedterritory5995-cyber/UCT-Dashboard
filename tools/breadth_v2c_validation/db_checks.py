"""PHASES 1, 2, 5, 6, 16 — structure, row geometry, candle invariants, metric domains,
source inventory. Pure SQLite over the scratch copy; no provider data needed.
"""
import collections
import datetime as dt
import json
import math
import re
import sys

sys.path.insert(0, "/app")
from api.services import breadth_metrics as bm                     # registry = the spec
from api.services import breadth_universes as bu

from common import ORIG_V2, UNIVERSES, calendar, ro, scratch, write

c = scratch()
q = lambda s, a=(): c.execute(s, a).fetchall()
R = {}

# ── PHASE 1: SQLite + structure ──────────────────────────────────────────────
R["integrity_check"] = [r[0] for r in q("PRAGMA integrity_check")]
R["schema"] = {n: s for n, s in q("SELECT name, sql FROM sqlite_master")}
R["tables"] = {t: q('SELECT COUNT(*) FROM "%s"' % t)[0][0]
               for (t,) in q("SELECT name FROM sqlite_master WHERE type='table'")}
R["pk"] = {t: [r[1] for r in q('PRAGMA table_info("%s")' % t) if r[5]] for t in R["tables"]}

rows = q("SELECT universe,date,metric,o,h,l,c,source,updated_at FROM breadth_daily_ohlc")
ck = {d: (s, u, n, det) for d, s, u, n, det in
      q("SELECT date,status,universes,rows,detail FROM pass_checkpoint")}
ps = {d: (us, cb, b, ec, cal) for d, us, cb, b, ec, cal in
      q("SELECT date,universe_sizes,close_basis,buckets,early_close,calendar FROM pass_session")}
cal = set(calendar())

R["checkpoints"] = dict(collections.Counter(v[0] for v in ck.values()))
R["rows_total"] = len(rows)
R["rows_by_universe"] = dict(collections.Counter(r[0] for r in rows))

# duplicates: the PK forbids exact duplicates; also test NORMALISED logical keys
norm = collections.Counter((r[0].strip().lower(), r[1].strip(), r[2].strip().lower())
                           for r in rows)
R["duplicate_logical_keys"] = sum(1 for v in norm.values() if v > 1)
R["exact_pk_duplicates"] = len(rows) - len({(r[0], r[1], r[2]) for r in rows})

# nulls / NaN / Inf
def bad(v):
    return v is None or (isinstance(v, float) and (math.isnan(v) or math.isinf(v)))
R["null_or_nonfinite"] = {f: sum(1 for r in rows if bad(r[i]))
                          for i, f in ((3, "o"), (4, "h"), (5, "l"), (6, "c"))}
R["null_other"] = {f: sum(1 for r in rows if r[i] in (None, ""))
                   for i, f in ((0, "universe"), (1, "date"), (2, "metric"), (7, "source"),
                                (8, "updated_at"))}
R["non_real_types"] = q("SELECT typeof(o),typeof(h),typeof(l),typeof(c),COUNT(*) "
                        "FROM breadth_daily_ohlc GROUP BY 1,2,3,4")

# dates
iso = re.compile(r"^\d{4}-\d{2}-\d{2}$")
def date_ok(d):
    try:
        return bool(iso.match(d)) and dt.date.fromisoformat(d).isoformat() == d
    except ValueError:
        return False
all_dates = {r[1] for r in rows}
R["invalid_date_strings"] = sorted(d for d in all_dates | set(ck) | set(ps) if not date_ok(d))
R["weekend_dates"] = sorted(d for d in all_dates | set(ck)
                            if date_ok(d) and dt.date.fromisoformat(d).weekday() >= 5)
R["row_dates_not_in_provider_calendar"] = sorted(all_dates - cal)
done = {d for d, v in ck.items() if v[0] == "done"}
miss = {d for d, v in ck.items() if v[0] == "missing_source"}
R["done_not_in_provider_calendar"] = sorted(done - cal)
R["missing_source_in_provider_calendar"] = sorted(miss & cal)
lo, hi = min(ck), max(ck)
R["provider_sessions_in_range_without_done"] = sorted(d for d in cal if lo <= d <= hi and d not in done)

# orphans / relationships
R["rows_on_non_done_dates"] = sorted(all_dates - done)
R["done_without_rows"] = sorted(done - all_dates)
R["done_without_pass_session"] = sorted(done - set(ps))
R["pass_session_without_done"] = sorted(set(ps) - done)
R["missing_source_with_rows"] = sorted(miss & all_dates)
per_date = collections.Counter(r[1] for r in rows)
R["checkpoint_rows_mismatch"] = sorted((d, ck[d][2], per_date[d]) for d in done
                                       if ck[d][2] != per_date[d])
wd = [dt.date(2008, 1, 2) + dt.timedelta(days=i) for i in range((dt.date(2026, 9, 11) - dt.date(2008, 1, 2)).days + 1)]
wd = {d.isoformat() for d in wd if d.weekday() < 5}
R["weekdays_2008_2026_without_checkpoint"] = sorted(wd - set(ck))
R["checkpoint_dates_outside_weekday_range"] = sorted(set(ck) - wd)
ssz = collections.Counter()
for d in done:
    a = json.loads(ck[d][1] or "{}")
    b = json.loads(ps[d][0] or "{}") if d in ps else None
    if a != b:
        ssz["ckpt_vs_session_sizes_differ"] += 1
R["size_consistency"] = dict(ssz)

# registry conformance
reg_unis = set(bu.UNIVERSES) if hasattr(bu, "UNIVERSES") else set(UNIVERSES)
R["universes_outside_registry"] = sorted({r[0] for r in rows} - set(UNIVERSES))
metrics_art = sorted({r[2] for r in rows})
R["metrics_in_artifact"] = metrics_art
R["metrics_outside_registry"] = sorted(set(metrics_art) - set(bm.METRICS))
R["metrics_violating_applies_to"] = sorted({(r[0], r[2]) for r in rows
                                            if not bm.applies_to(r[2], r[0])})
R["applicable_but_absent"] = {u: sorted(set(bm.metrics_for(u)) - {r[2] for r in rows if r[0] == u})
                              for u in UNIVERSES}
R["v1_publication_set_absent"] = {u: sorted(set(bm.V1_METRICS) - {r[2] for r in rows if r[0] == u})
                                  for u in UNIVERSES}

# ── PHASE 16: sources / methods ──────────────────────────────────────────────
src = collections.defaultdict(lambda: {"rows": 0, "dates": set(), "metrics": set()})
for r in rows:
    s = src[(r[7], r[0])]
    s["rows"] += 1; s["dates"].add(r[1]); s["metrics"].add(r[2])
R["sources"] = {"%s|%s" % k: {"rows": v["rows"], "dates": len(v["dates"]),
                              "first": min(v["dates"]), "last": max(v["dates"]),
                              "metrics": len(v["metrics"])} for k, v in sorted(src.items())}
R["updated_at_range"] = q("SELECT MIN(updated_at),MAX(updated_at) FROM breadth_daily_ohlc")[0]
R["pass_meta"] = dict(q("SELECT key,value FROM pass_meta"))
R["pass_session_close_basis"] = dict(collections.Counter(v[1] for v in ps.values()))
R["pass_session_calendar_detail"] = dict(collections.Counter(
    re.sub(r"\d\d:\d\d", "HH:MM", v[4] or "") for v in ps.values()))
R["calendar_disagreements"] = sorted((d, v[4]) for d, v in ps.items() if "disagree" in (v[4] or ""))

# ── PHASE 2: row geometry ────────────────────────────────────────────────────
ud = collections.Counter((r[0], r[1]) for r in rows)
R["rows_per_session"] = dict(collections.Counter(per_date[d] for d in done))
R["rows_per_session_universe"] = {u: dict(collections.Counter(ud[(u, d)] for d in done if (u, d) in ud))
                                  for u in UNIVERSES}
exp_u = lambda d: ("uct", "us", "nasdaq", "nyse") if d >= "2011-01-03" else ("uct", "us")
R["expected_universe_sessions_absent"] = sorted((u, d) for d in done for u in exp_u(d) if (u, d) not in ud)
R["unexpected_universe_sessions_present"] = sorted((u, d) for (u, d) in ud if u not in exp_u(d))
by_um = collections.defaultdict(set)
for r in rows:
    by_um[(r[0], r[2])].add(r[1])
dev = {}
for u in UNIVERSES:
    ds = [d for d in done if u in exp_u(d)]
    for m in metrics_art:
        have = by_um.get((u, m), set())
        if not bm.applies_to(m, u):
            continue
        missing = sorted(d for d in ds if d not in have)
        if missing:
            dev["%s|%s" % (u, m)] = {"missing_sessions": len(missing), "examples": missing[:15]}
R["metric_sessions_missing"] = dev
R["metric_session_counts"] = {"%s|%s" % k: len(v) for k, v in sorted(by_um.items())}

# P0-POP: universe_count geometry, corrected vs ORIGINAL V2
def uc(conn):
    out = {}
    for u, d, o, h, l, cc in conn.execute(
            "SELECT universe,date,o,h,l,c FROM breadth_daily_ohlc WHERE metric='universe_count'"):
        out[(u, d)] = (o, h, l, cc)
    return out
new, old = uc(c), uc(ro(ORIG_V2))
def summarise(m):
    s = collections.defaultdict(lambda: {"n": 0, "close_eq_low": 0, "close_lt_90pct_high": 0,
                                         "min_c_over_h": 9.9, "sum_c_over_h": 0.0})
    for (u, d), (o, h, l, cc) in m.items():
        k = "%s|%s" % (u, d[:4])
        e = s[k]; e["n"] += 1
        r = cc / h if h else 0
        e["close_eq_low"] += int(cc == l and h > l)
        e["close_lt_90pct_high"] += int(r < 0.90)
        e["min_c_over_h"] = min(e["min_c_over_h"], r)
        e["sum_c_over_h"] += r
    for e in s.values():
        e["mean_c_over_h"] = round(e.pop("sum_c_over_h") / e["n"], 4)
        e["min_c_over_h"] = round(e["min_c_over_h"], 4)
    return dict(sorted(s.items()))
R["p0pop_universe_count_corrected"] = summarise(new)
R["p0pop_universe_count_original_v2"] = summarise(old)

# ── PHASES 5 + 6: candle invariants and metric domains ───────────────────────
E = 1e-9
viol = collections.Counter(); ex = collections.defaultdict(list)
dom = collections.defaultdict(lambda: {"rows": 0, "min": 1e18, "max": -1e18, "non_integer": 0,
                                       "max_decimals": 0, "eq_100": 0, "negatives": 0,
                                       "gt_100": 0})
def decs(v):
    s = repr(float(v))
    return 0 if s.endswith(".0") else len(s.split(".")[1]) if "." in s and "e" not in s else 99
for u, d, m, o, h, l, cc, s, _ in rows:
    meta = bm.METRICS.get(m, {})
    checks = {"l>o": l > o + E, "l>c": l > cc + E, "h<o": h < o - E, "h<c": h < cc - E,
              "h<l": h < l - E}
    if meta.get("domain") == bm.DOMAIN_PCT:
        checks["pct_out_of_0_100"] = min(o, h, l, cc) < -E or max(o, h, l, cc) > 100 + E
    if meta.get("domain") == bm.DOMAIN_NONNEG:
        checks["nonneg_negative"] = min(o, h, l, cc) < -E
    if meta.get("unit") == bm.UNIT_COUNT:
        checks["count_not_integer"] = any(abs(v - round(v)) > E for v in (o, h, l, cc))
    if m == "universe_count":
        checks["universe_count_not_positive"] = min(o, h, l, cc) <= 0
    if s.endswith("_body"):
        checks["body_not_flat"] = not (o == h == l == cc)
    for k, bad_ in checks.items():
        if bad_:
            viol[k] += 1
            if len(ex[k]) < 10:
                ex[k].append((u, d, m, o, h, l, cc, s))
    e = dom[m]
    e["rows"] += 1
    for v in (o, h, l, cc):
        e["min"] = min(e["min"], v); e["max"] = max(e["max"], v)
        e["non_integer"] += int(abs(v - round(v)) > E)
        e["max_decimals"] = max(e["max_decimals"], decs(v))
        e["eq_100"] += int(v == 100.0)
        e["negatives"] += int(v < 0)
        e["gt_100"] += int(v > 100)
R["candle_domain_violations"] = dict(viol)
R["candle_domain_violation_examples"] = dict(ex)
R["metric_table"] = {m: {**{k: bm.METRICS[m][k] for k in ("unit", "domain", "group", "portability")},
                         "applies_to": {u: bm.applies_to(m, u) for u in UNIVERSES},
                         "observed": dom[m]} for m in metrics_art}
print(write("db_checks.json", R))
print(json.dumps({k: R[k] for k in ("integrity_check", "tables", "checkpoints", "rows_total",
                                    "rows_by_universe", "duplicate_logical_keys",
                                    "null_or_nonfinite", "candle_domain_violations",
                                    "rows_per_session", "rows_per_session_universe",
                                    "metrics_outside_registry", "v1_publication_set_absent",
                                    "sources")}, indent=1, default=str))
