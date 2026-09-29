"""Read-only diagnostics for the stage-2X flags. Writes validation/diag1.json only."""
import sys
CODE = "/data/fundamentals_pit_v5/code/7dfda83de6a7"
sys.path.insert(0, CODE)
import collections, datetime as dt, json, sqlite3
from api.services.fundamentals_pit.split_ledger import SPLIT_SENSITIVE_METRICS as SSM

VAL = "/data/fundamentals_pit_v5/validation"
V5DB, SRC, COPY = "/data/fundamentals_pit_v5/run/v5.db", "/data/fundamentals_pit.db", VAL + "/stage2x_copy.db"
ro = lambda p: sqlite3.connect(f"file:{p}?mode=ro", uri=True, timeout=60)
out = {}
v5, v4, cp = ro(V5DB), ro(SRC), ro(COPY)
q = "SELECT metric, method, count(*) FROM series_point WHERE derivation_version=? AND method!='gap' AND sources='' GROUP BY 1, 2"
out["empty_sources_v5"] = [list(r) for r in v5.execute(q, (5,))]
out["empty_sources_v4"] = [list(r) for r in v4.execute(q, (4,))]
out["empty_sources_total_v5"] = sum(r[2] for r in out["empty_sources_v5"])
out["empty_sources_total_v4"] = sum(r[2] for r in out["empty_sources_v4"])
# period_end vs t_eff day: equal vs strictly after
pe = collections.Counter()
ex = []
for cik, m, t, p in v5.execute("SELECT cik, metric, t_eff, period_end FROM series_point WHERE derivation_version=5"):
    d = dt.datetime.utcfromtimestamp(t).date(); e = dt.date(p // 10000, p // 100 % 100, p % 100)
    if e > d:
        pe[("AFTER", m)] += 1
        if len(ex) < 20:
            ex.append([cik, m, t, p])
    elif e == d:
        pe[("SAME_DAY", m)] += 1
out["period_end_vs_t"] = [[k[0], k[1], n] for k, n in pe.items()]
out["period_end_after_t_examples"] = ex
# prefix-truncation failures: are they all split-sensitive withholding?
s2 = json.load(open(VAL + "/stage2x.json"))
fails = s2["C_prefix_truncation"]["failures"]
rows = []
for f in fails:
    cik = f["cik"]
    full_d = json.loads(v5.execute("SELECT detail FROM series_build WHERE cik=? AND derivation_version=5", (cik,)).fetchone()[0])
    tr_d = json.loads(cp.execute("SELECT detail FROM series_build WHERE cik=? AND derivation_version=5", (cik,)).fetchone()[0])
    T = f["T"]
    full = {(m, t): r for m, t, *r in v5.execute("SELECT metric, t_eff, v, period_end, method, sources FROM series_point "
                                                 "WHERE cik=? AND derivation_version=5 AND t_eff<=?", (cik, T))}
    tr = {(m, t): r for m, t, *r in cp.execute("SELECT metric, t_eff, v, period_end, method, sources FROM series_point "
                                               "WHERE cik=? AND derivation_version=5", (cik,))}
    diff = [k for k in set(full) | set(tr) if full.get(k) != tr.get(k)]
    dm = collections.Counter(k[0] for k in diff)
    kinds = collections.Counter("only_trunc" if k not in full else "only_full" if k not in tr else "differ" for k in diff)
    rows.append({"cik": cik, "T": T, "full_withheld": full_d.get("withheld_split_sensitive"),
                 "trunc_withheld": tr_d.get("withheld_split_sensitive"),
                 "full_split_status": full_d["split_verification"]["status"],
                 "full_split_reasons": full_d["split_verification"].get("reasons", [])[:3],
                 "trunc_split_status": tr_d["split_verification"]["status"],
                 "diff_metrics": dict(dm), "diff_kinds": dict(kinds),
                 "all_split_sensitive": all(m in SSM for m in dm),
                 "full_has_any_ssm_point": v5.execute(
                     "SELECT count(*) FROM series_point WHERE cik=? AND derivation_version=5 AND metric IN (%s)" % ",".join("?" * len(SSM)),
                     (cik, *SSM)).fetchone()[0]})
out["prefix_failures"] = rows
out["prefix_failures_all_split_withholding"] = all(r["all_split_sensitive"] and r["full_withheld"] and not r["trunc_withheld"] for r in rows)
wh5 = collections.Counter(); wh4 = collections.Counter()
for (d,) in v5.execute("SELECT detail FROM series_build WHERE derivation_version=5"):
    wh5[json.loads(d).get("withheld_split_sensitive")] += 1
for (d,) in v4.execute("SELECT detail FROM series_build WHERE derivation_version=4"):
    wh4[json.loads(d).get("withheld_split_sensitive")] += 1
out["withheld_split_sensitive_companies"] = {"v5": {str(k): n for k, n in wh5.items()}, "v4": {str(k): n for k, n in wh4.items()}}
json.dump(out, open(VAL + "/diag1.json", "w"), indent=1, default=str)
print(json.dumps({k: out[k] for k in ("empty_sources_total_v5", "empty_sources_total_v4", "prefix_failures_all_split_withholding",
                                      "withheld_split_sensitive_companies")}, default=str))
