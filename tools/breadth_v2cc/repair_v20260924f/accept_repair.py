"""Phases 8-10: repaired artifact vs the pre-repair BASELINE copy. Read-only (immutable=1)."""
import json, os, sys, sqlite3, collections, glob, hashlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import semdig
R = "/data/_audit/v2cc/repair_v20260924f"
ART = "/data/_audit/v2cc/final/breadth_v2c2div_FINAL_v20260924f.db"
BASE = R + "/BASELINE_pre_repair_breadth_v2c2div_FINAL_v20260924f.db"
mut = json.load(open(R + "/05_checkpoint_mutation.json"))
CL = mut["closure"]; SRC = CL[0]; DOWN = CL[1:]
RESUME_START = sys.argv[1]            # 'YYYY-MM-DD HH:MM:SS' UTC, rows written by the resume are >= this
b = json.load(open(R + "/02_baseline_semantic_digest.json")); a = semdig.digest(ART)
out = {"problems": []}; P = out["problems"]
def diffkeys(x, y): return sorted(k for k in set(x) | set(y) if x.get(k) != y.get(k))
inwin = lambda k: k.split("|")[-1] in CL
for t in ("ohlc", "session", "session_v2c2", "checkpoint"):
    ch = diffkeys(b[t], a[t]); out["changed_" + t] = len(ch)
    outside = [k for k in ch if not inwin(k)]
    out["changed_outside_closure_" + t] = outside[:20]
    if outside: P.append("%s changed OUTSIDE the closure: %s" % (t, outside[:5]))
    out["changed_inside_" + t] = sorted(set(k.split("|")[-1] for k in ch))
mb, ma = b["meta"], a["meta"]
mchg = diffkeys(mb, ma); out["meta_changed_keys"] = mchg
bad_meta = [k for k in mchg if not (k.startswith("leg1_") and k not in mb)]
if bad_meta: P.append("pass_meta keys changed beyond the new leg1_* record: %s" % bad_meta)
out["meta_leg1"] = {k: ma[k] for k in mchg if k in ma}
cb = sqlite3.connect("file:%s?mode=ro&immutable=1" % BASE, uri=True)
ca = sqlite3.connect("file:%s?mode=ro&immutable=1" % ART, uri=True)
rows = lambda c, d: {(u, m): (o, h, l, cc, s) for u, m, o, h, l, cc, s in c.execute(
    "SELECT universe,metric,o,h,l,c,source FROM breadth_daily_ohlc WHERE date=?", (d,))}
W = {}
for d in CL:
    rb, ra = rows(cb, d), rows(ca, d)
    changed = [k for k in rb if ra.get(k) != rb[k]]
    lost = [k for k in rb if k not in ra]
    added = sorted(set(ra) - set(rb))
    stale = ca.execute("SELECT COUNT(*) FROM breadth_daily_ohlc WHERE date=? AND updated_at < ?", (d, RESUME_START)).fetchone()[0]
    unis = sorted({u for u, _ in ra})
    have = {u: sorted(m for (uu, m) in ra if uu == u and m.startswith("ratio_")) for u in unis}
    W[d] = {"rows_before": len(rb), "rows_after": len(ra), "prior_values_changed": len(changed), "prior_rows_lost": len(lost),
            "added": sorted({m for _, m in added}), "added_n": len(added), "rows_not_rewritten": stale,
            "per_universe_rows": dict(collections.Counter(u for u, _ in ra)), "ratios": have}
    if changed: P.append("%s: %d pre-existing values changed on recompute (closure would widen)" % (d, len(changed)))
    if lost: P.append("%s: %d rows lost" % (d, len(lost)))
    if stale: P.append("%s: %d rows not rewritten by the resume" % (d, stale))
    if d != SRC and set(m for _, m in added) - {"ratio_5day", "ratio_10day"}: P.append("%s: non-ratio rows added" % d)
    for u in unis:
        if have[u] != ["ratio_10day", "ratio_5day"]: P.append("%s %s ratios incomplete: %s" % (d, u, have[u]))
out["window"] = W
ck = dict(ca.execute("SELECT status, COUNT(*) FROM pass_checkpoint GROUP BY 1")); out["checkpoints"] = ck
out["checkpoints_total"] = sum(ck.values())
out["closure_checkpoints"] = [list(r) for r in ca.execute("SELECT date,status,universes,rows,detail,at FROM pass_checkpoint WHERE date BETWEEN ? AND ? ORDER BY date", (CL[0], CL[-1]))]
if ck.get("failed"): P.append("failed checkpoints remain: %s" % ck["failed"])
if out["checkpoints_total"] != 4887: P.append("checkpoint total %s != 4887" % out["checkpoints_total"])
# whole-artifact ratio rail: every ratio close recomputed from stored up/down over the grouped calendar; absent iff a prior is absent
cal = sorted(os.path.basename(p)[:-7] for p in glob.glob("/data/grouped_closes_v20260924f/*_1.json"))
ix = {d: i for i, d in enumerate(cal)}
ud = collections.defaultdict(dict); rat = collections.defaultdict(dict)
for u, d, m, cc in ca.execute("SELECT universe,date,metric,c FROM breadth_daily_ohlc WHERE metric IN ('up_4pct_today','down_4pct_today','ratio_5day','ratio_10day')"):
    (ud if "4pct" in m else rat)[(u, d)][m] = cc
rr = collections.Counter(); bad = []
for (u, d), v in ud.items():
    i = ix[d]
    for key, n in (("ratio_5day", 5), ("ratio_10day", 10)):
        win = cal[i - n + 1:i + 1] if i >= n - 1 else None
        ok = win is not None and all(("up_4pct_today" in ud.get((u, x), {}) and "down_4pct_today" in ud.get((u, x), {})) for x in win)
        st = rat.get((u, d), {}).get(key)
        if not ok:
            rr["absent_expected" if st is None else "BRIDGED"] += 1
            if st is not None: bad.append((u, d, key, "bridged"))
            continue
        su = sum(ud[(u, x)]["up_4pct_today"] for x in win); sd = sum(ud[(u, x)]["down_4pct_today"] for x in win)
        exp = round(su / sd, 2) if sd > 0 else None
        if st is None and exp is None: rr["absent_zero_denominator"] += 1
        elif st is None: rr["MISSING"] += 1; bad.append((u, d, key, "missing", exp))
        elif exp is None or abs(st - exp) > 1e-9: rr["MISMATCH"] += 1; bad.append((u, d, key, st, exp))
        else: rr["exact"] += 1
out["ratio_rail"] = dict(rr); out["ratio_rail_bad"] = bad[:40]
if bad: P.append("ratio rail: %d violations" % len(bad))
out["ratio_absent_expected_dates"] = sorted({d for (u, d), v in ud.items() for key in ("ratio_10day",) if key not in rat.get((u, d), {})})[:60]
out["integrity_check"] = ca.execute("PRAGMA integrity_check").fetchone()[0]
out["rows_total"] = ca.execute("SELECT COUNT(*) FROM breadth_daily_ohlc").fetchone()[0]
if out["integrity_check"] != "ok": P.append("integrity_check " + out["integrity_check"])
p = R + "/08_repair_acceptance.json"
json.dump(out, open(p, "x"), indent=1, default=repr); os.chmod(p, 0o444)
print(json.dumps({k: v for k, v in out.items() if k not in ("window",)}, indent=1, default=repr)[:6000])
print(json.dumps({d: {k: v for k, v in w.items() if k != "ratios"} for d, w in W.items()}, default=repr))
