"""Exchange Breadth V1 — Phase 10 checks over the isolated live dry run (read-only).

Usage: python3 dry_run_checks.py DRY_DIR IDENTITY_STATE.json OUT.json

Independent of the dry-run code path: raw ledger rows (own lookup), the identity state's ticker
index, the captured membership and close cross-sections, the would-append rows, and the production
US V2 producer's own stored rows for the same sessions (v2_live.db, opened immutable).
"""
import collections
import json
import sqlite3
import sys

DRY, STATE, OUT = sys.argv[1:4]
LED = "/data/_audit/exch_v1/venue_ledger_72eef1c2.json"
PROD = "/data/breadth_v2_producer/v2_live.db"
NYSE_START = "2009-06-11"
cap = json.load(open(f"{DRY}/capture.json"))
rows = json.load(open(f"{DRY}/would_append_rows.json"))
dr = json.load(open(f"{DRY}/dry_run.json"))
st = json.load(open(STATE))
by = collections.defaultdict(list)
for r in json.load(open(LED))["rows"]:
    by[r[0]].append((r[2], r[3], r[4]))


def own_status(k, d):
    hit = [s for f, t, s in by.get(k, ()) if f <= d <= t]
    return hit[0] if len(hit) == 1 else ("NOROW" if not hit else "MULTI")


def own_sid(t, d):
    runs = [r for r in st["ticker_index"].get(t, ()) if r[0] <= d]
    return runs[-1][2] if runs else None


def own_bridge(t, d):
    sid = own_sid(t, d)
    if sid is None:
        return "absent"
    keys = {k[0] for k in st["sids"][sid]["keys"] if k[3] == "LEDGER" and k[0].rsplit("|", 1)[0] == t} & set(by)
    cov = [s for k in keys for f, tt, s in by[k] if f <= d <= tt]
    return cov[0] if len(cov) == 1 else "CONFLICT" if cov else ("UNRESOLVED" if keys else "absent")


vals = collections.defaultdict(dict)
for u, d, m, o, h, l, c, src in rows:
    vals[(u, d)][m] = (o, h, l, c, src)
vio = collections.Counter()
ex = collections.defaultdict(list)


def V(k, *a):
    vio[k] += 1
    if len(ex[k]) < 8:
        ex[k].append(list(a))


per = {}
for d in sorted(cap):
    rec = cap[d]
    us, ny, na = (set(rec["universes"].get(u, [])) for u in ("us", "nyse", "nasdaq"))
    if ny & na:
        V("nyse_and_nasdaq_overlap", d)
    if not ny <= us or not na <= us:
        V("exchange_not_subset_us", d)
    sids_today = collections.Counter()
    k_ = collections.Counter()
    for t in us:
        sid, k, raw, st_ = rec["member"][t]
        if sid != own_sid(t, d):
            V("sid_mismatch", d, t, sid, own_sid(t, d))
        if sid:
            sids_today[sid] += 1
        s2 = own_bridge(t, d)
        if s2 != st_:
            V("status_mismatch", d, t, st_, s2)
        rs = own_status(raw, d) if raw in by else "absent"
        rs = "UNRESOLVED" if rs == "NOROW" else rs
        if rs != st_:
            V("bridge_differs_from_accepted_raw_B3_semantics", d, t, st_, rs)
        k_[st_] += 1
        if (t in ny) != (st_ == "NYSE" and d >= NYSE_START):
            V("nyse_membership_wrong", d, t, st_)
        if (t in na) != (st_ == "NASDAQ"):
            V("nasdaq_membership_wrong", d, t, st_)
    if any(n > 1 for n in sids_today.values()):
        V("duplicate_sid_same_session", d)
    es = dr["exch_session"][d]
    if sum(es[x] for x in ("NYSE", "NASDAQ", "OTHER", "UNRESOLVED", "CONFLICT", "absent")) != es["us"] or es["us"] != len(us):
        V("bucket_sum", d, es)
    if (es["NYSE"], es["NASDAQ"]) != (len(ny), len(na)):
        V("bucket_vs_membership", d)
    cl = rec["close"]
    for u, mem in (("us", us), ("nyse", ny), ("nasdaq", na)):
        x, L = cl[u]["values"], {k: set(v) for k, v in cl[u]["lists"].items()}
        if L["advancing"] & L["declining"] or L["advancing"] & L["unchanged"] or L["declining"] & L["unchanged"]:
            V("adv_dec_unc_overlap", d, u)
        if x["advancing"] + x["declining"] + x["unchanged"] != x["_directional"]:
            V("adv+dec+unc != directional", d, u)
        if not L["universe_count"] <= mem:
            V("priced_not_subset_members", d, u)
        for m in ("advancing", "declining", "unchanged", "universe_count"):
            if vals[(u, d)].get(m, (None,) * 4)[3] != x[m]:
                V("would_append_ne_captured", d, u, m)
        if u != "us":
            for m in ("advancing", "declining", "unchanged", "universe_count"):
                if set(cl[u]["lists"][m]) != set(cl["us"]["lists"][m]) & mem:
                    V("exchange_list_ne_us_restricted", d, u, m)
    per[d] = {"US": len(us), "NYSE": len(ny), "NASDAQ": len(na), "OTHER": k_["OTHER"], "UNRESOLVED": k_["UNRESOLVED"],
              "CONFLICT": k_["CONFLICT"], "absent": k_["absent"],
              "absent_names": sorted(t for t in us if rec["member"][t][3] == "absent"),
              **{f"{u}.{m}": cl[u]["values"][m] for u in ("nyse", "nasdaq") for m in ("advancing", "declining", "unchanged", "universe_count")}}
# production parity: the dry run's `us` rows == what the US V2 producer published for the same sessions
p = sqlite3.connect(f"file:{PROD}?immutable=1", uri=True)
prod = {(u, d, m): (o, h, l, c, src) for u, d, m, o, h, l, c, src in
        p.execute("SELECT universe, date, metric, o, h, l, c, source FROM v2_row WHERE universe IN ('us','nyse','nasdaq')")}
par = collections.Counter()
par_ex = []
for (u, d), ms in vals.items():
    for m, v in ms.items():
        pv = prod.get((u, d, m))
        if u == "us":
            if m == "unchanged":
                par["us_unchanged_new_metric"] += 1
            elif pv is None:
                par["us_missing_in_prod"] += 1
            elif pv == v:
                par["us_exact"] += 1
            else:
                par["us_mismatch"] += 1
                if len(par_ex) < 10:
                    par_ex.append([u, d, m, v, pv])
        elif pv is not None and m in ("advancing", "declining", "universe_count"):
            par[f"{u}_vs_prod_listvenue_{'same' if pv[3] == v[3] else 'differs'}"] += 1
par["prod_us_rows_not_in_dry"] = sum(1 for (u, d, m) in prod if u == "us" and (u, d) in vals and m not in vals[(u, d)])
rep = {"violations": dict(vio), "violation_examples": dict(ex), "per_session": per, "production_parity": dict(par),
       "production_parity_examples": par_ex, "deterministic": dr["deterministic"], "contiguous": dr["contiguous"],
       "raw_key_vs_bridge_by_snapshot": dr["raw_key_vs_bridge_by_snapshot"],
       "pass": not vio and par["us_mismatch"] == 0 and par["us_missing_in_prod"] == 0 and dr["deterministic"] and dr["contiguous"]}
json.dump(rep, open(OUT, "w"), indent=1, sort_keys=True)
print(json.dumps({k: rep[k] for k in ("violations", "production_parity", "deterministic", "contiguous", "pass")}, indent=1))
for d, v in per.items():
    print(d, {k: v[k] for k in v if k != "absent_names"}, v["absent_names"])
