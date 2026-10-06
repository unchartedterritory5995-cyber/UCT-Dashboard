"""Exchange Breadth V1 — validation part C: determinism + ticker-level membership from the bounded rebuilds.

Reads det_a.db / det_b.db / det_cap.db + capture_cap.json (validation dir), the candidate v1 artifact
(immutable), the 0444 ledger, the frozen pit_reference. Writes ONLY into OUT.
Usage: python3 valC.py DDIR OUT
"""
import collections
import hashlib
import json
import os
import sqlite3
import sys

DDIR, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
V1 = "/data/_audit/exch_v1/artifact/breadth_exch_v1_v1.db"
LED = "/data/_audit/exch_v1/venue_ledger_72eef1c2.json"
REF = "/data/_audit/v2cc/inputs_v20260924f/pit_reference.json"
NYSE_START, NASDAQ_START = "2009-06-11", "2008-01-02"


def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def dump(name, obj):
    p = os.path.join(OUT, name)
    json.dump(obj, open(p + ".tmp", "w"), indent=1, sort_keys=True, default=str)
    os.replace(p + ".tmp", p)
    print("wrote", p, flush=True)


def ro(p):
    return sqlite3.connect(f"file:{p}?immutable=1", uri=True)


TIMECOLS = ("updated_at", "created_at", "at", "ts", "finished_at", "started_at")


def logical(p):
    c = ro(p)
    out = {}
    for (t,) in c.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"):
        cols = [r[1] for r in c.execute(f"PRAGMA table_info({t})")]
        keep = [x for x in cols if x not in TIMECOLS and not x.endswith("_at")]
        if t == "pass_meta":
            rows = [r for r in c.execute("SELECT key, value FROM pass_meta ORDER BY key")
                    if not (r[0].endswith("_at") or r[0].startswith("leg"))]
        elif t == "exch_meta":
            rows = [r for r in c.execute("SELECT key, value FROM exch_meta ORDER BY key")
                    if r[0] not in ("validation_tag", "hook")]
        else:
            rows = sorted(c.execute(f"SELECT {','.join(keep)} FROM {t}").fetchall(), key=lambda r: json.dumps(r, default=str))
        out[t] = {"columns_hashed": keep, "rows": len(rows),
                  "sha256": hashlib.sha256(json.dumps(rows, default=str, separators=(",", ":")).encode()).hexdigest()}
    c.close()
    return out


rep = {"files": {}, "logical": {}}
for tag in ("a", "b", "cap"):
    p = f"{DDIR}/det_{tag}.db"
    rep["files"][tag] = {"sha256": sha(p), "bytes": os.path.getsize(p)}
    rep["logical"][tag] = logical(p)
tables = sorted(rep["logical"]["a"])
rep["a_vs_b"] = {t: rep["logical"]["a"][t]["sha256"] == rep["logical"]["b"][t]["sha256"] for t in tables}
rep["a_vs_cap"] = {t: rep["logical"]["a"][t]["sha256"] == rep["logical"]["cap"][t]["sha256"] for t in tables}
rep["file_bytes_identical_a_b"] = rep["files"]["a"]["sha256"] == rep["files"]["b"]["sha256"]
c = ro(f"{DDIR}/det_a.db")
rep["checkpoints"] = c.execute("SELECT status, COUNT(*) FROM pass_checkpoint GROUP BY 1").fetchall()
dates = [r[0] for r in c.execute("SELECT date FROM pass_checkpoint WHERE status='done' ORDER BY date")]
rep["sessions"] = len(dates)
rep["rows"] = c.execute("SELECT universe, COUNT(*) FROM breadth_daily_ohlc GROUP BY 1").fetchall()

# ── det_a vs the candidate v1 artifact on the same sessions ────────────────────────────────
c.execute(f"ATTACH DATABASE 'file:{V1}?immutable=1' AS v")
cal = [r[0] for r in c.execute("SELECT date FROM v.pass_checkpoint WHERE status='done' ORDER BY date")]
ci = {d: i for i, d in enumerate(cal)}
dset = set(dates)


def full_prior(d, n):
    i = ci[d]
    return i >= n - 1 and all(cal[j] in dset for j in range(i - (n - 1), i))


cmpn = match = 0
mism = collections.Counter()
expl = collections.Counter()
ex = []
for u, d, m, o, h, l, cc, src, vo, vh, vl_, vc, vsrc in c.execute("""
        SELECT n.universe, n.date, n.metric, n.o, n.h, n.l, n.c, n.source, x.o, x.h, x.l, x.c, x.source
        FROM main.breadth_daily_ohlc n LEFT JOIN v.breadth_daily_ohlc x
          ON x.universe=n.universe AND x.date=n.date AND x.metric=n.metric"""):
    cmpn += 1
    if (o, h, l, cc, src) == (vo, vh, vl_, vc, vsrc):
        match += 1
        continue
    mism[m] += 1
    if len(ex) < 20:
        ex.append([u, d, m, [o, h, l, cc, src], [vo, vh, vl_, vc, vsrc]])
only_v1 = collections.Counter()
only_v1_unexplained = []
for u, d, m in c.execute("""SELECT x.universe, x.date, x.metric FROM v.breadth_daily_ohlc x
        WHERE x.date IN (SELECT date FROM main.pass_checkpoint WHERE status='done')
        AND NOT EXISTS (SELECT 1 FROM main.breadth_daily_ohlc n WHERE n.universe=x.universe AND n.date=x.date AND n.metric=x.metric)"""):
    n = 5 if m == "ratio_5day" else 10 if m == "ratio_10day" else None
    if n and not full_prior(d, n):
        only_v1["ratio cell: window lacks the N-1 prior sessions (expected)"] += 1
    else:
        only_v1[m] += 1
        only_v1_unexplained.append([u, d, m])
rep["vs_v1"] = {"rows_compared": cmpn, "exact": match, "mismatch_by_metric": dict(mism), "examples": ex,
                "v1_rows_absent_in_rebuild": dict(only_v1), "v1_rows_absent_unexplained": only_v1_unexplained[:20]}
sz_det = {d: json.loads(s) for d, s in c.execute("SELECT date, universe_sizes FROM main.pass_session_v2c2")}
sz_v1 = {d: json.loads(s) for d, s in c.execute("SELECT date, universe_sizes FROM v.pass_session_v2c2")}
es_det = {d: json.loads(s) for d, s in c.execute("SELECT date, counts FROM main.exch_session")}
es_v1 = {d: json.loads(s) for d, s in c.execute("SELECT date, counts FROM v.exch_session")}
rep["sizes_equal_v1"] = sum(1 for d in dates if sz_det[d] == sz_v1[d])
rep["exch_session_det_rows"] = len(es_det)
rep["exch_session_equal_v1_where_v1_has_row"] = sum(1 for d in dates if d in es_v1 and es_det[d] == es_v1[d])
rep["exch_session_v1_missing_in_window"] = {d: {"det_counts": es_det.get(d), "v1_sizes": sz_v1[d]} for d in dates if d not in es_v1}
dump("C01_determinism.json", rep)
print(json.dumps({k: rep[k] for k in ("a_vs_b", "a_vs_cap", "file_bytes_identical_a_b", "sessions")}), flush=True)

# ── membership from the capture, against an INDEPENDENT lookup ────────────────────────────
cap = json.load(open(f"{DDIR}/capture_cap.json"))
LDOC = json.load(open(LED))
rows_by = collections.defaultdict(list)
for r in LDOC["rows"]:
    rows_by[r[0]].append((r[2], r[3], r[4]))
ref = json.load(open(REF))


def own_resolve(recs, d):
    hits = [r for r in (recs or []) if not ((r.get("delisted_utc") or "")[:10] and d > r["delisted_utc"][:10])
            and not ((r.get("list_date") or "")[:10] and d < r["list_date"][:10])]
    if not hits:
        return None
    hits.sort(key=lambda r: (r.get("list_date") or ""))
    return hits[-1]


def own_status(ident, d):
    hit = [s for f, t, s in rows_by.get(ident, ()) if f <= d <= t]
    if len(hit) > 1:
        return "MULTI"
    return hit[0] if hit else ("NOROW" if ident in rows_by else "ABSENT")


vio = collections.Counter()
vex = collections.defaultdict(list)


def V(k, *a):
    vio[k] += 1
    if len(vex[k]) < 10:
        vex[k].append(list(a))


per = {}
c2 = ro(f"{DDIR}/det_cap.db")
vals = collections.defaultdict(dict)
for u, d, m, v in c2.execute("SELECT universe, date, metric, c FROM breadth_daily_ohlc"):
    vals[(u, d)][m] = v
vv1 = collections.defaultdict(dict)
cv = ro(V1)
for u, d, m, v in cv.execute("SELECT universe, date, metric, c FROM breadth_daily_ohlc WHERE date IN (%s)" % ",".join("?" * len(cap)), list(cap)):
    vv1[(u, d)][m] = v
ids_checked = set()
TRACK = ("WMT", "LIN", "PEP", "ORCL", "SEG", "LEU", "UAMY", "BMNR", "EGO", "AGX")
track = []
for d in sorted(cap):
    rec = cap[d]
    us, ny, na = set(rec["universes"].get("us", [])), set(rec["universes"].get("nyse", [])), set(rec["universes"].get("nasdaq", []))
    if ny & na:
        V("nyse_and_nasdaq_overlap", d, sorted(ny & na)[:5])
    if not ny <= us:
        V("nyse_not_subset_us", d, sorted(ny - us)[:5])
    if not na <= us:
        V("nasdaq_not_subset_us", d, sorted(na - us)[:5])
    st_count = collections.Counter()
    for t in us:
        g_ident = rec["us_identity"][t]
        r0 = own_resolve(ref.get(t), d)
        o_ident = f"{t}|{(r0 or {}).get('delisted_utc') or 'active'}"
        if g_ident != o_ident:
            V("identity_mismatch", d, t, g_ident, o_ident)
        ids_checked.add(o_ident)
        s = own_status(o_ident, d)
        st_count[s] += 1
        if s == "MULTI":
            V("multiple_ledger_rows_cover_session", d, o_ident)
        want_ny = s == "NYSE" and d >= NYSE_START
        want_na = s == "NASDAQ"
        if want_ny != (t in ny):
            V("nyse_membership_wrong", d, t, s)
        if want_na != (t in na):
            V("nasdaq_membership_wrong", d, t, s)
        if t in ny | na and s in ("OTHER", "UNRESOLVED", "CONFLICT", "NOROW", "ABSENT"):
            V("non_exchange_status_entered_exchange", d, t, s)
    # close cross-section: adv/dec/unc partition and persistence
    cl = rec["close"]
    for u, members in (("us", us), ("nyse", ny), ("nasdaq", na)):
        if u not in cl:
            if members:
                V("no_close_capture", d, u)
            continue
        x, L = cl[u]["values"], {k: set(v) for k, v in cl[u]["lists"].items()}
        if L["advancing"] & L["declining"] or L["advancing"] & L["unchanged"] or L["declining"] & L["unchanged"]:
            V("adv_dec_unc_lists_overlap", d, u)
        if not (L["advancing"] | L["declining"] | L["unchanged"]) <= L["universe_count"]:
            V("directional_not_subset_priced", d, u)
        if not L["universe_count"] <= members:
            V("priced_not_subset_members", d, u)
        if x["advancing"] + x["declining"] + x["unchanged"] != x["_directional"]:
            V("adv+dec+unc != directional", d, u, x)
        for k in ("advancing", "declining", "unchanged", "universe_count"):
            if len(L[k]) != x[k]:
                V("list_len_ne_value", d, u, k)
            if vals[(u, d)].get(k) != x[k]:
                V("persisted_cap_ne_captured", d, u, k, vals[(u, d)].get(k), x[k])
            if vv1[(u, d)].get(k) != x[k]:
                V("persisted_v1_ne_captured", d, u, k, vv1[(u, d)].get(k), x[k])
        per.setdefault(d, {})[u] = {"members": len(members), "priced(universe_count)": x["universe_count"],
                                    "directional": x["_directional"], "adv": x["advancing"], "dec": x["declining"],
                                    "unc": x["unchanged"], "no_valid_change": x["universe_count"] - x["_directional"]}
    # exchange cross-sections are the US cross-section restricted to members (same ticker, same direction)
    if "us" in cl:
        Lu = {k: set(v) for k, v in cl["us"]["lists"].items()}
        for u, members in (("nyse", ny), ("nasdaq", na)):
            if u in cl:
                for k in ("advancing", "declining", "unchanged", "universe_count"):
                    if set(cl[u]["lists"][k]) != Lu[k] & members:
                        V("exchange_list_ne_us_list_restricted", d, u, k)
    # independent recount of the bucket side table
    es = es_det.get(d)
    own = {"NYSE": st_count["NYSE"], "NASDAQ": st_count["NASDAQ"], "OTHER": st_count["OTHER"],
           "UNRESOLVED": st_count["UNRESOLVED"] + st_count["NOROW"], "CONFLICT": st_count["CONFLICT"], "absent": st_count["ABSENT"], "us": len(us)}
    if es and any(es[k] != own[k] for k in own):
        V("exch_session_ne_independent_recount", d, es, own)
    per.setdefault(d, {})["status_counts"] = dict(st_count)
    for t in TRACK:
        if t in us:
            o_ident = rec["us_identity"][t]
            where = {u: [k for k in ("advancing", "declining", "unchanged") if t in set(cl.get(u, {}).get("lists", {}).get(k, []))]
                     for u in ("us", "nyse", "nasdaq")}
            track.append([t, d, o_ident, own_status(o_ident, d), "nyse" if t in ny else "nasdaq" if t in na else "neither", where])
memb = {"sessions": len(cap), "us_member_sessions_checked": sum(len(cap[d]["universes"].get("us", [])) for d in cap),
        "identities_checked": len(ids_checked), "violations": dict(vio), "violation_examples": dict(vex),
        "per_session": per, "tracked_transfers": track,
        "absent_detail": {d: [t for t in cap[d]["universes"].get("us", []) if own_status(f"{t}|{(own_resolve(ref.get(t), d) or {}).get('delisted_utc') or 'active'}", d) == "ABSENT"]
                          for d in cap}}
memb["absent_detail"] = {d: v for d, v in memb["absent_detail"].items() if v}
dump("C02_membership.json", memb)
print("membership violations", dict(vio), flush=True)
