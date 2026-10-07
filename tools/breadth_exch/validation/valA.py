"""Exchange Breadth V1 — full artifact validation, part A (read-only census).

Reads: the candidate artifact + frozen V2c2 artifact (SQLite immutable=1), the venue ledger,
population.json, the frozen pit_reference. Writes ONLY into OUT (a new validation directory).
Usage: python3 valA.py OUT
"""
import bisect
import collections
import hashlib
import json
import os
import sqlite3
import statistics
import sys
import time

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
X = "/data/_audit/exch_v1"
ART = os.environ.get("EXCH_ART", X + "/artifact/breadth_exch_v1_v1.db")
FRZ = "/data/_audit/v2cc/final/breadth_v2c2div_FINAL_v20260924f_VALIDATED_FROZEN_2026-09-29.db"
LED = X + "/venue_ledger_72eef1c2.json"
POP = X + "/population.json"
CODE = X + "/code_grind_eff3eca45b2f"
INPUTS = "/data/_audit/v2cc/inputs_v20260924f"
REF = INPUTS + "/pit_reference.json"
EXPECT_INPUTS = {
    "INPUT_MANIFEST.json": "0c5caacda02ee4634197aefd8c261f648e6ffe26496379f05ed7f753a1d7d07a",
    "pit_reference.json": "cf20e5f0019849aa7161170761d426da95e93df8f84f3a069527f13e10959d7c",
    "grouped_vintage_manifest.json": "2b8c0eafe714c52d17384bdc29af14b8cc9f3d4314181a6f632b2ee28d390773",
}
EXPECT_ART = os.environ.get("EXCH_ART_SHA", "1ba6b1a873d08a3b6fc1a90f5a58c107d667db15fa5030ebf139cbfd9c92430e")
EXPECT_FRZ = "5670fdc0d3deeb9ed1d7eb13da794457d395d3ad007255a8a685769aeefb904e"
EXPECT_LEDGER_CONTENT = "72eef1c26c47bafa15648fc864ddd1ac8593b4312cc92444ccc7b59c0b23193d"
NYSE_START, NASDAQ_START = "2009-06-11", "2008-01-02"
NAS_MICS = {"XNAS", "XNGS", "XNMS", "XNCM"}
T0 = time.time()


def log(*a):
    print(time.strftime("%H:%M:%S"), f"+{time.time() - T0:.0f}s", *a, flush=True)


def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def dump(name, obj):
    p = os.path.join(OUT, name)
    with open(p + ".tmp", "w") as f:
        json.dump(obj, f, indent=1, sort_keys=True, default=str)
    os.replace(p + ".tmp", p)
    log("wrote", p)


def q(vals, p):
    if not vals:
        return None
    s = sorted(vals)
    return s[min(len(s) - 1, int(round(p * (len(s) - 1))))]


def ro(path):
    return sqlite3.connect(f"file:{path}?immutable=1", uri=True)


# ═════════════════════════════════════════════════════════════════════════════════════════
# 1. IDENTITY
# ═════════════════════════════════════════════════════════════════════════════════════════
ident = {}
st = os.stat(ART)
ident["artifact"] = {"path": ART, "bytes": st.st_size, "mtime_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(st.st_mtime)),
                     "mode": oct(st.st_mode & 0o777), "sha256": sha(ART)}
ident["artifact"]["sha_ok"] = ident["artifact"]["sha256"] == EXPECT_ART
for side in ("-wal", "-shm"):
    p = ART + side
    ident["artifact"][side] = os.path.getsize(p) if os.path.exists(p) else None
fst = os.stat(FRZ)
ident["frozen"] = {"path": FRZ, "bytes": fst.st_size, "mode": oct(fst.st_mode & 0o777),
                   "mtime_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(fst.st_mtime)), "sha256": sha(FRZ)}
ident["frozen"]["sha_ok"] = ident["frozen"]["sha256"] == EXPECT_FRZ
sys.path.insert(0, CODE + "/tools/breadth_v2cc")
import breadth_venue_ledger as vl  # noqa: E402  (the exact module copy the grind imported)
LDOC = json.load(open(LED))
lst = os.stat(LED)
ident["ledger"] = {"path": LED, "file_sha256": sha(LED), "mode": oct(lst.st_mode & 0o777),
                   "recorded_content_sha256": LDOC["sha256"], "recomputed_content_sha256": vl.ledger_hash(LDOC["rows"]),
                   "version": LDOC["version"], "rows": len(LDOC["rows"]), "probes": LDOC["probes"],
                   "population_sha256_recorded": LDOC["population_sha256"], "population_file_sha256": sha(POP)}
ident["ledger"]["ok"] = (ident["ledger"]["recomputed_content_sha256"] == EXPECT_LEDGER_CONTENT == LDOC["sha256"]
                         and LDOC["population_sha256"] == ident["ledger"]["population_file_sha256"])
ident["inputs"] = {fn: {"sha256": sha(os.path.join(INPUTS, fn)), "expected": want,
                        "ok": sha(os.path.join(INPUTS, fn)) == want} for fn, want in EXPECT_INPUTS.items()}
code = {}
for root, dirs, files in os.walk(CODE):
    dirs[:] = [d for d in dirs if d != "__pycache__"]
    for fn in files:
        p = os.path.join(root, fn)
        code[os.path.relpath(p, CODE)] = sha(p)
ident["code_dir"] = {"path": CODE, "files": len(code), "sha256_by_file": code,
                     "tree_sha256": hashlib.sha256(json.dumps(code, sort_keys=True).encode()).hexdigest()}
c = ro(ART)
ident["quick_check"] = c.execute("PRAGMA quick_check").fetchall()
ident["integrity_check"] = c.execute("PRAGMA integrity_check").fetchall()
ident["exch_meta"] = dict(c.execute("SELECT key, value FROM exch_meta"))
ident["pass_meta"] = dict(c.execute("SELECT key, value FROM pass_meta"))
ident["checkpoints"] = c.execute("SELECT status, COUNT(*), MIN(date), MAX(date) FROM pass_checkpoint GROUP BY 1").fetchall()
ident["last_row_write_utc"] = c.execute("SELECT MAX(updated_at) FROM breadth_daily_ohlc").fetchone()[0]
ident["progress"] = json.load(open(X + "/artifact/PROGRESS_v1.json"))
fc = ro(FRZ)
ident["frozen_quick_check"] = fc.execute("PRAGMA quick_check").fetchall()
fc.close()
dump("A01_identity.json", ident)
STOP = []
if not ident["artifact"]["sha_ok"]:
    STOP.append("artifact sha")
if not ident["frozen"]["sha_ok"]:
    STOP.append("frozen sha")
if not ident["ledger"]["ok"]:
    STOP.append("ledger identity")
if not all(v["ok"] for v in ident["inputs"].values()):
    STOP.append("inputs")
if ident["quick_check"] != [("ok",)] or ident["integrity_check"] != [("ok",)]:
    STOP.append("sqlite integrity")
if STOP:
    dump("A00_STOP.json", STOP)
    raise SystemExit("IDENTITY STOP: %s" % STOP)
log("identity ok")

# ═════════════════════════════════════════════════════════════════════════════════════════
# 2. US CONTROL (full overlap)
# ═════════════════════════════════════════════════════════════════════════════════════════
c.execute(f"ATTACH DATABASE 'file:{FRZ}?immutable=1' AS f")
done = [r[0] for r in c.execute("SELECT date FROM pass_checkpoint WHERE status='done' ORDER BY date")]
dset = set(done)
fdone = {r[0] for r in c.execute("SELECT date FROM f.pass_checkpoint WHERE status='done'")}
usc = {"new_done_sessions": len(done), "frozen_done_sessions": len(fdone),
       "sessions_both_done": len(dset & fdone), "new_only": sorted(dset - fdone)[:20],
       "frozen_only": sorted(fdone - dset)[:20]}
mm = collections.Counter()
ex = []
cmp_rows = match = 0
metrics_cmp = set()
for d, m, o, h, l, cc, src, fo, fh, fl, fcl, fsrc in c.execute("""
        SELECT n.date, n.metric, n.o, n.h, n.l, n.c, n.source, x.o, x.h, x.l, x.c, x.source
        FROM main.breadth_daily_ohlc n JOIN f.breadth_daily_ohlc x
          ON x.universe='us' AND x.date=n.date AND x.metric=n.metric
        WHERE n.universe='us'"""):
    cmp_rows += 1
    metrics_cmp.add(m)
    if (o, h, l, cc, src) == (fo, fh, fl, fcl, fsrc):
        match += 1
    else:
        mm[m] += 1
        if len(ex) < 25:
            ex.append([d, m, [o, h, l, cc, src], [fo, fh, fl, fcl, fsrc]])
missing_new = c.execute("""SELECT x.metric, COUNT(*) FROM f.breadth_daily_ohlc x WHERE x.universe='us'
    AND NOT EXISTS (SELECT 1 FROM main.breadth_daily_ohlc n WHERE n.universe='us' AND n.date=x.date AND n.metric=x.metric)
    GROUP BY 1""").fetchall()
unexpected_new = c.execute("""SELECT n.metric, COUNT(*) FROM main.breadth_daily_ohlc n WHERE n.universe='us'
    AND NOT EXISTS (SELECT 1 FROM f.breadth_daily_ohlc x WHERE x.universe='us' AND x.date=n.date AND x.metric=n.metric)
    GROUP BY 1""").fetchall()
usc.update({"rows_compared": cmp_rows, "metrics_compared": len(metrics_cmp), "metric_list": sorted(metrics_cmp),
            "exact_matches": match, "mismatches": sum(mm.values()), "mismatch_by_metric": dict(mm), "examples": ex,
            "frozen_rows_missing_in_new": dict(missing_new), "new_rows_absent_in_frozen": dict(unexpected_new)})
usc["pass"] = (not mm and not missing_new and set(dict(unexpected_new)) <= {"unchanged"}
               and dict(unexpected_new).get("unchanged") == len(done))
# frozen V2c2 sizes vs new sizes for us (population identity)
sz_new = {d: json.loads(s) for d, s in c.execute("SELECT date, universe_sizes FROM main.pass_session_v2c2")}
sz_old = {d: json.loads(s) for d, s in c.execute("SELECT date, universe_sizes FROM f.pass_session_v2c2")}
wh_new = {d: json.loads(s) for d, s in c.execute("SELECT date, withheld FROM main.pass_session_v2c2")}
wh_old = {d: json.loads(s) for d, s in c.execute("SELECT date, withheld FROM f.pass_session_v2c2")}
usc["us_size_equal_sessions"] = sum(1 for d in done if sz_new[d].get("us") == sz_old.get(d, {}).get("us"))
usc["us_withheld_equal_sessions"] = sum(1 for d in done if wh_new[d].get("us") == wh_old.get(d, {}).get("us"))
dump("A02_us_control.json", usc)
log("us control", usc["pass"], cmp_rows, match)

# ═════════════════════════════════════════════════════════════════════════════════════════
# 3. CELL CENSUS — every (universe, session) vs the metric set; the 13-cell question
# ═════════════════════════════════════════════════════════════════════════════════════════
cells = {}
present = collections.defaultdict(set)
for u, d, m in c.execute("SELECT universe, date, metric FROM main.breadth_daily_ohlc"):
    present[(u, d)].add(m)
allm = sorted({m for v in present.values() for m in v})
miss = collections.defaultdict(list)
for (u, d), ms in present.items():
    for m in allm:
        if m not in ms:
            miss[u].append([d, m])
for u in ("us", "nasdaq", "nyse"):
    ds = sorted(d for (uu, d) in present if uu == u)
    miss[u].sort()
    cells[u] = {"sessions": len(ds), "first": ds[0], "last": ds[-1], "metrics": len(allm),
                "cells": sum(len(present[(u, d)]) for d in ds), "rectangular": len(ds) * len(allm),
                "missing": miss[u], "missing_n": len(miss[u]),
                "missing_metrics": dict(collections.Counter(m for _, m in miss[u])),
                "missing_dates_are_first_sessions": sorted({d for d, _ in miss[u]}) == ds[:len({d for d, _ in miss[u]})]}
# the same gap in the frozen V2 artifact at ITS starts
fpresent = collections.defaultdict(set)
for u, d, m in c.execute("SELECT universe, date, metric FROM f.breadth_daily_ohlc WHERE universe IN ('us','nyse','nasdaq')"):
    fpresent[(u, d)].add(m)
fm = sorted({m for v in fpresent.values() for m in v})
for u in ("us", "nasdaq", "nyse"):
    fmiss = sorted([d, m] for (uu, d), ms in fpresent.items() if uu == u for m in fm if m not in ms)
    cells["frozen_" + u] = {"metrics": len(fm), "missing": fmiss, "missing_n": len(fmiss)}
# neighbouring values for the NYSE gap cells (surrounding sessions)
ny = sorted(d for (u, d) in present if u == "nyse")
cells["nyse_ratio_context"] = [
    [d, {m: c.execute("SELECT c FROM main.breadth_daily_ohlc WHERE universe='nyse' AND date=? AND metric=?", (d, m)).fetchone()
         for m in ("ratio_5day", "ratio_10day", "up_4pct_today", "down_4pct_today", "universe_count")}]
    for d in ny[:12]]
cells["nyse_rows_before_start"] = c.execute("SELECT COUNT(*) FROM main.breadth_daily_ohlc WHERE universe='nyse' AND date<?", (NYSE_START,)).fetchone()[0]
dump("A03_cells.json", cells)
log("cells", {u: cells[u]["missing_n"] for u in ("us", "nasdaq", "nyse")})

# ═════════════════════════════════════════════════════════════════════════════════════════
# 4. exch_session: the missing rows + full-range bucket invariants
# ═════════════════════════════════════════════════════════════════════════════════════════
es = {d: json.loads(j) for d, j in c.execute("SELECT date, counts FROM main.exch_session")}
missing_es = sorted(dset - set(es))
upd = {d: (mn, mx) for d, mn, mx in c.execute("SELECT date, MIN(updated_at), MAX(updated_at) FROM main.breadth_daily_ohlc GROUP BY date")}
vals = collections.defaultdict(dict)
for u, d, m, v in c.execute("SELECT universe, date, metric, c FROM main.breadth_daily_ohlc"):
    vals[(u, d)][m] = v
mes = []
for d in missing_es:
    i = done.index(d)
    mes.append({"date": d, "rows": {u: len(present.get((u, d), ())) for u in ("us", "nasdaq", "nyse")},
                "sizes_v2c2": sz_new.get(d), "withheld": wh_new.get(d),
                "checkpoint": c.execute("SELECT * FROM pass_checkpoint WHERE date=?", (d,)).fetchone(),
                "commit_time": upd.get(d), "prev": [done[i - 1], upd.get(done[i - 1]), done[i - 1] in es],
                "next": [done[i + 1] if i + 1 < len(done) else None, upd.get(done[i + 1]) if i + 1 < len(done) else None,
                         (done[i + 1] in es) if i + 1 < len(done) else None],
                "key_values": {u: {m: vals[(u, d)].get(m) for m in ("universe_count", "advancing", "declining", "unchanged")}
                               for u in ("us", "nasdaq", "nyse")}})
# commit-time cadence: the pump fires every 300 s after the 5-minute sleep
times = sorted((upd[d][1], d) for d in done)
inv = {"exch_session_rows": len(es), "done_sessions": len(done), "missing": mes}
bad = collections.defaultdict(list)


badn = collections.Counter()


def BAD(k, *a):
    badn[k] += 1
    if len(bad[k]) < 15:
        bad[k].append(list(a))


ADD_METRICS = ("universe_count", "advancing", "declining", "unchanged", "new_52w_highs", "new_52w_lows",
               "new_20d_highs", "new_20d_lows", "up_4pct_today", "down_4pct_today", "stage2_count", "stage4_count",
               "up_25pct_quarter", "down_25pct_quarter", "up_25pct_month", "down_25pct_month", "up_50pct_month",
               "down_50pct_month", "up_20pct_5d", "down_20pct_5d", "near_52w_high")
gap = {u: [] for u in ("us", "nyse", "nasdaq")}
for d in done:
    k = es.get(d)
    s = sz_new[d]
    if k is not None:
        tot = sum(k[x] for x in ("NYSE", "NASDAQ", "OTHER", "UNRESOLVED", "CONFLICT", "absent"))
        if tot != k["us"]:
            BAD("bucket_sum_ne_us", d, k)
        if k["us"] != s.get("us"):
            BAD("es_us_ne_size_us", d, k["us"], s.get("us"))
        if d >= NYSE_START and k["NYSE"] != s.get("nyse", 0):
            BAD("es_nyse_ne_size", d, k["NYSE"], s.get("nyse"))
        if d >= NASDAQ_START and k["NASDAQ"] != s.get("nasdaq", 0):
            BAD("es_nasdaq_ne_size", d, k["NASDAQ"], s.get("nasdaq"))
        if k["CONFLICT"]:
            BAD("conflict_members", d, k["CONFLICT"])
    if d < NYSE_START and "nyse" in s:
        BAD("nyse_before_start", d)
    if d >= NYSE_START and "nyse" not in s:
        BAD("nyse_missing_after_start", d)
    for u in ("us", "nyse", "nasdaq"):
        v = vals.get((u, d))
        if not v:
            continue
        a, de, un, uc = v.get("advancing"), v.get("declining"), v.get("unchanged"), v.get("universe_count")
        if None in (a, de, un, uc):
            BAD("adv_dec_unc_uc_missing", u, d, [a, de, un, uc])
            continue
        if a + de + un > uc:
            BAD("adv_dec_unc_gt_uc", u, d, [a, de, un, uc])
        gap[u].append(uc - (a + de + un))
        if uc > s.get(u, 0):
            BAD("universe_count_gt_size", u, d, uc, s.get(u))
    vu, vn, vy = vals.get(("us", d), {}), vals.get(("nasdaq", d), {}), vals.get(("nyse", d), {})
    for m in ADD_METRICS:
        if vu.get(m) is None:
            continue
        tot = (vn.get(m) or 0) + (vy.get(m) or 0)
        if tot > vu[m] + 1e-9:
            BAD("exchange_sum_gt_us:" + m, d, vn.get(m), vy.get(m), vu[m])
inv["violations"] = dict(badn)
inv["violation_examples"] = dict(bad)
inv["no_prior_close_gap"] = {u: {"sessions": len(g), "zero": sum(1 for x in g if x == 0), "max": max(g) if g else None,
                                 "median": statistics.median(g) if g else None, "p95": q(g, 0.95)} for u, g in gap.items()}
inv["exch_session_totals"] = {k: sum(v.get(k, 0) for v in es.values()) for k in ("us", "NYSE", "NASDAQ", "OTHER", "UNRESOLVED", "CONFLICT", "absent")}
inv["absent_sessions"] = sum(1 for v in es.values() if v.get("absent"))
inv["absent_max"] = max((v.get("absent", 0), d) for d, v in es.items())
dump("A04_invariants.json", inv)
log("invariants", dict(badn), "missing exch_session", missing_es)

# ═════════════════════════════════════════════════════════════════════════════════════════
# 5. INDEPENDENT RECONSTRUCTION from population + ledger (own lookup, not vl.Ledger)
# ═════════════════════════════════════════════════════════════════════════════════════════
pop = json.load(open(POP))
S = pop["sessions"]
pos = {d: i for i, d in enumerate(S)}
N = len(S)
rows_by_id = collections.defaultdict(list)
for r in LDOC["rows"]:
    rows_by_id[r[0]].append((pos[r[2]], pos[r[3]], r[4], r[5], r[6]))
for v in rows_by_id.values():
    v.sort()
ref = json.load(open(REF))
STAT = ("NYSE", "NASDAQ", "OTHER", "UNRESOLVED", "CONFLICT", "NOROW")
new_cnt = {k: [0] * (N + 1) for k in STAT}
old_cnt = {k: [0] * (N + 1) for k in ("NYSE", "NASDAQ", "OTHER")}
moved = collections.defaultdict(list)    # session -> [(ident, old, new)] where old != new among NYSE/NASDAQ
overlap = uncovered = 0
old_venue = {}
collide = []
for ident, e in pop["identities"].items():
    t, du = ident.split("|")
    du = None if du == "active" else du
    recs = [r for r in (ref.get(t) or []) if ((r.get("delisted_utc") or None) and r["delisted_utc"][:10]) == (du and du[:10])]
    if len(recs) != 1:
        collide.append([ident, len(recs), [r.get("primary_exchange") for r in recs]])
    pe = (recs[-1].get("primary_exchange") or "").upper() if recs else ""
    ov = "NYSE" if pe == "XNYS" else "NASDAQ" if pe in NAS_MICS else "OTHER"
    old_venue[ident] = ov
    sp = rows_by_id.get(ident, [])
    for (a1, b1, *_), (a2, b2, *_) in zip(sp, sp[1:]):
        overlap += a2 <= b1
    for a, b in e["runs"]:
        old_cnt[ov][a] += 1
        old_cnt[ov][b + 1] -= 1
        # walk the run against the identity's rows
        i = a
        for x, y, stt, mic, src in sp:
            if y < i or x > b:
                continue
            if x > i:          # member sessions before this row: not covered
                uncovered += x - i
                new_cnt["NOROW"][i] += 1
                new_cnt["NOROW"][x] -= 1
                i = x
            hi = min(y, b)
            new_cnt[stt][i] += 1
            new_cnt[stt][hi + 1] -= 1
            if stt != ov and (stt in ("NYSE", "NASDAQ") or ov in ("NYSE", "NASDAQ")):
                for k in range(i, hi + 1):
                    moved[k].append((ident, ov, stt))
            i = hi + 1
            if i > b:
                break
        if i <= b:
            uncovered += b - i + 1
            new_cnt["NOROW"][i] += 1
            new_cnt["NOROW"][b + 1] -= 1
for dct in (new_cnt, old_cnt):
    for k, arr in dct.items():
        run = 0
        for i in range(N + 1):
            run += arr[i]
            arr[i] = run
rec = {"population_identities": len(pop["identities"]), "sessions": N, "overlapping_ledger_rows": overlap,
       "member_sessions_without_ledger_row": uncovered,
       "identity_record_not_unique": len(collide), "identity_record_not_unique_examples": collide[:30]}
# compare to the grind (exch_session, v2c2 sizes) and to the frozen V2 (old sizes)
diffs = collections.defaultdict(list)
worst = {}
for d in done:
    i = pos.get(d)
    if i is None:
        diffs["date_not_in_population"].append(d)
        continue
    pu = pop["per_session_members"][i]
    sn = sz_new[d]
    so = sz_old.get(d, {})
    pairs = {"us(pop-grind)": pu - sn.get("us", 0),
             "NASDAQ(pop-grind)": new_cnt["NASDAQ"][i] - (es[d]["NASDAQ"] if d in es else sn.get("nasdaq", 0)),
             "NYSE(pop-grind)": new_cnt["NYSE"][i] - (es[d]["NYSE"] if d in es else sn.get("nyse", 0)) if d >= NYSE_START else None}
    if d in es:
        pairs["UNRESOLVED(pop-grind)"] = new_cnt["UNRESOLVED"][i] + new_cnt["NOROW"][i] - es[d]["UNRESOLVED"] - es[d]["absent"]
        pairs["OTHER(pop-grind)"] = new_cnt["OTHER"][i] - es[d]["OTHER"]
    if d >= "2011-01-03" and so:
        pairs["old_nyse(pop-frozen)"] = old_cnt["NYSE"][i] - so.get("nyse", 0)
        pairs["old_nasdaq(pop-frozen)"] = old_cnt["NASDAQ"][i] - so.get("nasdaq", 0)
        # the CORRECTION in size: grind(new - old) vs reconstruction(new - old)
        if d >= NYSE_START:
            pairs["delta_nyse(grind-recon)"] = (sn.get("nyse", 0) - so.get("nyse", 0)) - (new_cnt["NYSE"][i] - old_cnt["NYSE"][i])
        pairs["delta_nasdaq(grind-recon)"] = (sn.get("nasdaq", 0) - so.get("nasdaq", 0)) - (new_cnt["NASDAQ"][i] - old_cnt["NASDAQ"][i])
    for k, v in pairs.items():
        if v is None:
            continue
        diffs[k].append(v)
        if abs(v) > abs(worst.get(k, (0, None))[0]):
            worst[k] = (v, d)
rec["pop_vs_grind"] = {k: {"n": len(v), "exact": sum(1 for x in v if x == 0), "median_abs": statistics.median(abs(x) for x in v),
                           "p95_abs": q([abs(x) for x in v], .95), "max_abs": max(abs(x) for x in v), "worst": worst.get(k)}
                       for k, v in diffs.items() if k != "date_not_in_population"}
rec["dates_not_in_population"] = diffs.get("date_not_in_population", [])
by_year = collections.defaultdict(lambda: collections.Counter())
for d in done:
    i = pos[d]
    y = d[:4]
    by_year[y]["sessions"] += 1
    for k in STAT:
        by_year[y]["new_" + k] += new_cnt[k][i]
    for k in old_cnt:
        by_year[y]["old_" + k] += old_cnt[k][i]
    by_year[y]["moved_member_sessions"] += len(moved.get(i, ()))
rec["by_year_avg_per_session"] = {y: {k: round(v / c_["sessions"], 2) for k, v in c_.items() if k != "sessions"}
                                  | {"sessions": c_["sessions"]} for y, c_ in sorted(by_year.items())}
dump("A05_reconstruction.json", rec)
log("reconstruction", overlap, uncovered, {k: v["exact"] for k, v in rec["pop_vs_grind"].items()})

# ═════════════════════════════════════════════════════════════════════════════════════════
# 6. OLD (frozen, list venue) vs NEW (PIT) — full census 2011-01-03..2026-09-24
# ═════════════════════════════════════════════════════════════════════════════════════════
old = collections.defaultdict(dict)
for u, d, m, o, h, l, v in c.execute("SELECT universe, date, metric, o, h, l, c FROM f.breadth_daily_ohlc WHERE universe IN ('nyse','nasdaq')"):
    old[(u, d)][m] = (o, h, l, v)
new = collections.defaultdict(dict)
for u, d, m, o, h, l, v in c.execute("SELECT universe, date, metric, o, h, l, c FROM main.breadth_daily_ohlc WHERE universe IN ('nyse','nasdaq')"):
    new[(u, d)][m] = (o, h, l, v)
cen = {}
DERIVED = {"net_adv": lambda r: r["advancing"] - r["declining"],
           "pct_adv": lambda r: 100.0 * r["advancing"] / r["universe_count"],
           "pct_dec": lambda r: 100.0 * r["declining"] / r["universe_count"]}
for u in ("nyse", "nasdaq"):
    od = sorted(d for (uu, d) in old if uu == u)
    nd = sorted(d for (uu, d) in new if uu == u)
    common = sorted(set(od) & set(nd))
    res = {"old_sessions": len(od), "new_sessions": len(nd), "sessions_compared": len(common),
           "old_range": [od[0], od[-1]], "new_range": [nd[0], nd[-1]],
           "sessions_missing_new": len(set(od) - set(nd)), "sessions_missing_old": len(set(nd) - set(od))}
    per = {}
    yr = collections.defaultdict(lambda: collections.defaultdict(list))
    changed_sessions = set()
    cells_cmp = cells_chg = miss_old = miss_new = ohl_chg = 0
    rows_cmp = []
    for d in common:
        O, Nn = old[(u, d)], new[(u, d)]
        for m in set(O) | set(Nn):
            if m not in O:
                miss_old += 1
                continue
            if m not in Nn:
                miss_new += 1
                continue
            ov, nv = O[m][3], Nn[m][3]
            if ov is None or nv is None:
                continue
            cells_cmp += 1
            dd = nv - ov
            if abs(dd) > 1e-9:
                cells_chg += 1
                changed_sessions.add(d)
            if O[m][:3] != Nn[m][:3]:
                ohl_chg += 1
            p = per.setdefault(m, {"abs": [], "signed": [], "max": (0, None, None, None)})
            p["abs"].append(abs(dd))
            p["signed"].append(dd)
            if abs(dd) > abs(p["max"][0]):
                p["max"] = (dd, d, ov, nv)
            yr[d[:4]][m].append(abs(dd))
        try:
            for k, f in DERIVED.items():
                ro_ = {m: O[m][3] for m in ("advancing", "declining", "universe_count")}
                rn_ = {m: Nn[m][3] for m in ("advancing", "declining", "universe_count")}
                dd = f(rn_) - f(ro_)
                p = per.setdefault(k, {"abs": [], "signed": [], "max": (0, None, None, None)})
                p["abs"].append(abs(dd))
                p["signed"].append(dd)
                if abs(dd) > abs(p["max"][0]):
                    p["max"] = (dd, d, f(ro_), f(rn_))
                yr[d[:4]][k].append(abs(dd))
        except (KeyError, TypeError, ZeroDivisionError):
            pass
    res.update({"cells_compared": cells_cmp, "changed_cells": cells_chg, "unchanged_cells": cells_cmp - cells_chg,
                "ohl_changed_cells": ohl_chg, "metric_cells_missing_old": miss_old, "metric_cells_missing_new": miss_new,
                "sessions_with_any_change": len(changed_sessions),
                "metrics_compared": len([m for m in per if m not in DERIVED])})
    res["by_metric"] = {m: {"n": len(p["abs"]), "changed": sum(1 for x in p["abs"] if x > 1e-9),
                            "median_abs": statistics.median(p["abs"]), "p95_abs": q(p["abs"], .95),
                            "max_abs": abs(p["max"][0]), "max_signed": p["max"][0], "max_date": p["max"][1],
                            "max_old": p["max"][2], "max_new": p["max"][3],
                            "mean_signed": statistics.fmean(p["signed"])} for m, p in sorted(per.items())}
    res["by_year"] = {y: {m: {"median_abs": statistics.median(v), "p95_abs": q(v, .95), "max_abs": max(v),
                              "changed_share": round(sum(1 for x in v if x > 1e-9) / len(v), 4)}
                          for m, v in sorted(mm_.items()) if m in ("universe_count", "advancing", "declining", "net_adv",
                                                                     "pct_adv", "pct_above_50sma", "pct_above_200sma",
                                                                     "new_52w_highs", "new_52w_lows", "adv_decline")}
                     for y, mm_ in sorted(yr.items())}
    # largest corrections: by |Δ universe_count| and |Δ net_adv|, explained by reconstructed membership moves
    big = []
    for key in ("universe_count", "net_adv"):
        allv = []
        for d in common:
            try:
                if key == "net_adv":
                    dv = (new[(u, d)]["advancing"][3] - new[(u, d)]["declining"][3]) - (old[(u, d)]["advancing"][3] - old[(u, d)]["declining"][3])
                else:
                    dv = new[(u, d)][key][3] - old[(u, d)][key][3]
            except (KeyError, TypeError):
                continue
            allv.append((abs(dv), dv, d))
        allv.sort(reverse=True)
        for _, dv, d in allv[:8]:
            i = pos[d]
            U = u.upper()
            ins = sorted(x[0] for x in moved.get(i, ()) if x[2] == U)
            outs = sorted(x[0] for x in moved.get(i, ()) if x[1] == U)
            big.append({"by": key, "date": d, "delta": dv,
                        "old": {m: old[(u, d)].get(m, (None,) * 4)[3] for m in ("universe_count", "advancing", "declining")},
                        "new": {m: new[(u, d)].get(m, (None,) * 4)[3] for m in ("universe_count", "advancing", "declining", "unchanged")},
                        "size_old": sz_old.get(d, {}).get(u), "size_new": sz_new.get(d, {}).get(u),
                        "recon_moved_in": len(ins), "recon_moved_out": len(outs),
                        "recon_net": len(ins) - len(outs), "moved_in_sample": ins[:15], "moved_out_sample": outs[:15],
                        "moved_out_new_status": dict(collections.Counter(x[2] for x in moved.get(i, ()) if x[1] == U))})
    res["largest"] = big
    cen[u] = res
dump("A06_old_vs_new.json", cen)
log("old vs new", {u: (cen[u]["sessions_compared"], cen[u]["changed_cells"]) for u in cen})

# ═════════════════════════════════════════════════════════════════════════════════════════
# 7. EARLY HISTORY / START DATES (from the final ledger over member sessions)
# ═════════════════════════════════════════════════════════════════════════════════════════
early = {"per_month": {}}
un_list = collections.defaultdict(collections.Counter)   # month -> list-venue of UNRESOLVED member-sessions
for ident, e in pop["identities"].items():
    for x, y, stt, mic, src in rows_by_id.get(ident, []):
        if stt != "UNRESOLVED":
            continue
        for a, b in e["runs"]:
            for i in range(max(a, x), min(b, y) + 1):
                if S[i] < "2011":
                    un_list[S[i][:7]][old_venue[ident]] += 1
mon = collections.defaultdict(lambda: collections.Counter())
for d in S:
    if d >= "2011":
        break
    i = pos[d]
    m = d[:7]
    mon[m]["sessions"] += 1
    for k in ("NYSE", "NASDAQ", "OTHER", "UNRESOLVED", "NOROW"):
        mon[m][k] += new_cnt[k][i]
    mon[m]["max_unres_share_of_nyse"] = max(mon[m]["max_unres_share_of_nyse"],
                                           round(1e4 * new_cnt["UNRESOLVED"][i] / max(1, new_cnt["NYSE"][i])))
for m, cc_ in sorted(mon.items()):
    n = cc_["sessions"]
    early["per_month"][m] = {"sessions": n, **{f"avg_{k}": round(cc_[k] / n, 1) for k in ("NYSE", "NASDAQ", "OTHER", "UNRESOLVED", "NOROW")},
                             "max_unresolved_as_pct_of_nyse": cc_["max_unres_share_of_nyse"] / 100.0,
                             "unresolved_member_sessions_by_LIST_venue": dict(un_list[m])}
# worst session either side of the NYSE start
def unres_share(lo, hi):
    best = (0, None)
    for d in S:
        if lo <= d < hi:
            i = pos[d]
            sh = new_cnt["UNRESOLVED"][i] / max(1, new_cnt["NYSE"][i])
            if sh > best[0]:
                best = (sh, d, new_cnt["UNRESOLVED"][i], new_cnt["NYSE"][i])
    return best
early["worst_unresolved_share_2008_01_to_2009_06_10"] = unres_share("2008-01-02", NYSE_START)
early["worst_unresolved_share_2009_06_11_to_2010_12_31"] = unres_share(NYSE_START, "2011-01-01")
early["worst_unresolved_share_2011_plus"] = unres_share("2011-01-01", "2027")
# rule audit over every ledger row
ra = collections.Counter()
for r in LDOC["rows"]:
    stt, mic, src = r[4], r[5], r[6]
    ok = True
    if stt == "NYSE":
        ok = mic == "XNYS" and src.startswith("dated")
    elif stt == "NASDAQ":
        ok = mic == "XNAS" and (src.startswith("dated") or src.startswith("tape"))
    elif stt == "OTHER":
        ok = mic in ("XASE", "ARCX", "BATS", "IEXG") and src.startswith("dated")
    elif stt == "UNRESOLVED":
        ok = mic is None
    ra[(stt, mic, src, ok)] += 1
early["rule_audit"] = [[*k, v] for k, v in sorted(ra.items(), key=lambda x: (x[0][0], str(x[0][1]), x[0][2]))]
early["rule_audit_violations"] = sum(v for k, v in ra.items() if not k[3])
early["nasdaq_tape_only_member_sessions_by_year"] = {}
for ident, e in pop["identities"].items():
    for x, y, stt, mic, src in rows_by_id.get(ident, []):
        if stt == "NASDAQ" and src == "tape":
            for a, b in e["runs"]:
                for i in range(max(a, x), min(b, y) + 1):
                    yy = S[i][:4]
                    early["nasdaq_tape_only_member_sessions_by_year"][yy] = early["nasdaq_tape_only_member_sessions_by_year"].get(yy, 0) + 1
dump("A07_early_history.json", early)
log("early history done")

# ═════════════════════════════════════════════════════════════════════════════════════════
# 8. IDENTITY MODEL (ticker|delisted_utc)
# ═════════════════════════════════════════════════════════════════════════════════════════
idm = {}
by_t = collections.defaultdict(list)
for ident, e in pop["identities"].items():
    by_t[e["ticker"]].append(ident)
reused = {t: v for t, v in by_t.items() if len(v) > 1}
idm["tickers"] = len(by_t)
idm["reused_tickers"] = len(reused)
idm["identities_in_reused_tickers"] = sum(len(v) for v in reused.values())
ovl = []
after_delist = []
for t, ids in reused.items():
    sess = {}
    for ident in ids:
        for a, b in pop["identities"][ident]["runs"]:
            for i in range(a, b + 1):
                if i in sess:
                    ovl.append([t, S[i], sess[i], ident])
                sess[i] = ident
for ident, e in pop["identities"].items():
    du = ident.split("|")[1]
    if du != "active":
        last = S[e["runs"][-1][1]]
        if last > du[:10]:
            after_delist.append([ident, last])
idm["overlapping_lifetimes_same_session"] = len(ovl)
idm["overlap_examples"] = ovl[:20]
idm["member_after_own_delisting"] = len(after_delist)
idm["member_after_own_delisting_examples"] = after_delist[:20]
# ambiguity: >1 reference record active on a member session (resolve() then picks by list order)
amb = collections.Counter()
amb_ex = []
for ident, e in pop["identities"].items():
    t = e["ticker"]
    recs = ref.get(t) or []
    if len(recs) < 2:
        continue
    for a, b in e["runs"]:
        for i in (a, b):
            d = S[i]
            act = [r for r in recs if not (r.get("delisted_utc") and d > r["delisted_utc"][:10])]
            if len(act) > 1:
                amb[ident] += 1
                if len(amb_ex) < 20:
                    amb_ex.append([ident, d, [[r.get("primary_exchange"), r.get("delisted_utc")] for r in act]])
idm["identities_with_ambiguous_active_records"] = len(amb)
idm["ambiguous_examples"] = amb_ex
# venue history of reused tickers: each identity's ledger statuses
idm["reused_sample"] = {t: {i: [[r[2], r[3], r[4]] for r in LDOC["rows"] if r[0] == i][:6] for i in ids}
                        for t, ids in list(sorted(reused.items()))[:12]}
idm["identity_record_not_unique"] = rec["identity_record_not_unique"]
dump("A08_identity_model.json", idm)
log("identity model", idm["reused_tickers"], idm["overlapping_lifetimes_same_session"], idm["member_after_own_delisting"])

# ═════════════════════════════════════════════════════════════════════════════════════════
# 9. TRANSFER SPOT CHECKS (ledger membership + old list venue + exchange totals)
# ═════════════════════════════════════════════════════════════════════════════════════════
corpus = json.load(open(X + "/code_p1_d580df7fd222/exchange_transfer_corpus.json"))
spot = []
for t in ("WMT", "LIN", "PEP", "ORCL", "SEG", "LEU", "UAMY", "BMNR"):
    cs = [x for x in corpus if x["ticker"] == t][0]
    ids = [i for i in by_t.get(t, [])]
    for ident in ids:
        e = pop["identities"][ident]
        mem = sorted(i for a, b in e["runs"] for i in range(a, b + 1))
        k = bisect.bisect_left(mem, pos[cs["effective"]])
        win = mem[max(0, k - 3):k + 3]
        tab = []
        for i in win:
            stt = next((r[2] for r in rows_by_id[ident] if r[0] <= i <= r[1]), "NOROW")
            d = S[i]
            tab.append({"session": d, "is_effective": d == cs["effective"], "ledger_status": stt,
                        "old_list_venue_attribution": old_venue[ident],
                        "in_new_nyse": stt == "NYSE" and d >= NYSE_START, "in_new_nasdaq": stt == "NASDAQ",
                        "artifact_nyse_uc": vals.get(("nyse", d), {}).get("universe_count"),
                        "artifact_nasdaq_uc": vals.get(("nasdaq", d), {}).get("universe_count")})
        first_after = [r for r in rows_by_id[ident] if r[2] == cs["after"]]
        spot.append({"ticker": t, "identity": ident, "effective": cs["effective"], "expected": [cs["before"], cs["after"]],
                     "ledger_rows": [[S[r[0]], S[r[1]], r[2], r[3], r[4]] for r in rows_by_id[ident]],
                     "first_session_in_after_status": S[min(r[0] for r in first_after)] if first_after else None,
                     "table": tab})
dump("A09_transfer_spots.json", spot)

# ═════════════════════════════════════════════════════════════════════════════════════════
# 10. DERIVED-SERIES PREREQUISITES
# ═════════════════════════════════════════════════════════════════════════════════════════
cal = [d for d in done]
der = {}
for u, start in (("nyse", NYSE_START), ("nasdaq", NASDAQ_START)):
    ds = [d for d in cal if d >= start]
    holes = [d for d in ds if vals.get((u, d), {}).get("advancing") is None or vals.get((u, d), {}).get("declining") is None]
    zero = [d for d in ds if (vals.get((u, d), {}).get("advancing") or 0) + (vals.get((u, d), {}).get("declining") or 0) == 0]
    der[u] = {"sessions_from_start": len(ds), "first": ds[0], "last": ds[-1], "adv_dec_holes": holes, "adv_plus_dec_zero": zero,
              "first_mco_publish_session(120th valid)": ds[119] if len(ds) >= 120 else None,
              "ratio_cells_missing_used_by_derived": False,
              "min_adv_plus_dec": min((vals[(u, d)]["advancing"] + vals[(u, d)]["declining"], d) for d in ds),
              "calendar_sessions_without_rows": [d for d in ds if (u, d) not in present]}
der["note"] = "AD/MCO/MCS read advancing and declining only; exch_session and ratio_5day/ratio_10day are not inputs."
dump("A10_derived_prereqs.json", der)
log("ALL DONE")
