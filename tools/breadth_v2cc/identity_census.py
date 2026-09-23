"""PHASE 2: build the identity table (deterministic, from the ledger + vintage raw closes),
then census it against the >60-session-gap heuristic for the pinned list."""
import bisect, collections, hashlib, json, os
from api.services import breadth_identity as bi, breadth_ticker as bt
G = "/data/grouped_closes_v20260923"
L = json.load(open("/data/_audit/v2cc/inputs/uct_identity_ledger.json"))
cal = sorted(f[:-7] for f in os.listdir(G) if f.endswith("_0.json"))
_c = {}
def raw_close(iso, t):
    if iso not in _c:
        _c[iso] = json.load(open(os.path.join(G, "%s_0.json" % iso)))
    return _c[iso].get(t)
def prev_session(iso):
    i = bisect.bisect_left(cal, iso)
    return cal[i - 1] if i > 0 else None
CP = json.load(open("/data/_audit/v2cc/inputs/uct_identity_changepoints.json"))["changepoints"]
T = bi.build_table(L, raw_close, prev_session, "2026-09-11", bt.canon, CP)
body = json.dumps(T, sort_keys=True).encode()
T["sha256_of_rows"] = hashlib.sha256(body).hexdigest()
json.dump(T, open("/data/_audit/v2cc/inputs/uct_identity_table_v3.json", "w"))
I = bi.Identity(T)
rng = [d for d in cal if "2008-01-02" <= d <= "2026-09-11"]
pin = set(L["identity"])
pres = collections.defaultdict(list)
for d in rng:
    for k in (_c.get(d) or json.load(open(os.path.join(G, "%s_0.json" % d)))):
        if k in pin:
            pres[k].append(d)
ci = {d: i for i, d in enumerate(rng)}
tot, excl, rules = collections.Counter(), collections.Counter(), collections.Counter()
seg_rules = collections.Counter(r[3] for t, rows in T["tickers"].items() for r in rows)
gap = collections.Counter(); sym = collections.Counter()
for t, ds in pres.items():
    idx = [ci[d] for d in ds]; s = idx[0]
    for a, b in zip(idx, idx[1:]):
        if b - a > 60: s = b
    g0 = rng[s]
    for d in ds:
        tot[d[:4]] += 1
        ok = I.allowed(t, d)
        rules[I.rule_for(t, d)] += 1
        if not ok:
            excl[d[:4]] += 1; sym[t] += 1
        gap[("keep" if ok else "drop") + "|gap60_" + ("keep" if d >= g0 else "drop")] += 1
out = {"rule": T["rule"], "table_sha256": T["sha256_of_rows"],
       "segment_rules": dict(seg_rules), "member_day_rules": dict(rules),
       "symbols_with_excluded_history": len(sym),
       "excluded_member_days_by_year": dict(sorted(excl.items())),
       "excluded_share_by_year": {y: round(100.0 * excl[y] / tot[y], 2) for y in sorted(tot)},
       "identity_vs_gap60_member_days": dict(gap),
       "reorg_decisions": [(t, r) for t, rows in T["tickers"].items() for r in rows if r[3] == "REORG"],
       "handover_decisions": [(t, r) for t, rows in T["tickers"].items() for r in rows if r[3] == "HANDOVER"][:60],
       "latest_lineage": [(t, r) for t, rows in T["tickers"].items() for r in rows if r[3] == "LATEST_LINEAGE"][:60],
       "top_excluded": sym.most_common(30)}
json.dump(out, open("/data/_audit/v2cc/identity_census.json", "w"), indent=1)
print(json.dumps({k: v for k, v in out.items() if k not in ("reorg_decisions", "handover_decisions", "latest_lineage", "top_excluded")}, indent=1))
print("REORG", len(out["reorg_decisions"])); [print(" ", x) for x in out["reorg_decisions"][:5]]
print("CHANGEPOINT", [(t, r) for t, rows in T["tickers"].items() for r in rows if r[3].startswith("CHANGEPOINT")])
print("HANDOVER sample"); [print(" ", x) for x in out["handover_decisions"][:15]]
print("LATEST_LINEAGE sample", len([1 for t, rows in T["tickers"].items() for r in rows if r[3] == "LATEST_LINEAGE"])); [print(" ", x) for x in out["latest_lineage"][:12]]
print("TOP EXCLUDED"); [print(" ", t, n, I.rule_for(t, pres[t][0])) for t, n in out["top_excluded"]]
