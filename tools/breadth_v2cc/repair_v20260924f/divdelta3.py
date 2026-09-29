"""Reconcile the no_series_before_ex delta: groups (canonical ticker, ex) present in only one ledger whose
ticker has no raw series before the ex-session (first_raw_session), per the table's own rule."""
import json, collections, bisect, os
A, F = "/data/_audit/v2cc/inputs_v20260924a", "/data/_audit/v2cc/inputs_v20260924f"
out = {}
def groups(p):
    l = json.load(open(p + "/dividends_ledger.json")); lte = None
    return {(d["ticker"], d["ex_dividend_date"]) for d in l["dividends"] if d.get("ticker") and d.get("ex_dividend_date") and d.get("cash_amount") is not None}
ga, gf = groups(A), groups(F)
fa, ff = (json.load(open(p + "/first_raw_session.json")) for p in (A, F))
fa = fa.get("first", fa); ff = ff.get("first", ff)
cal = sorted(f[:-7] for f in os.listdir("/data/grouped_closes_v20260924f") if f.endswith("_1.json"))
def ns(t, ex, first):
    j = bisect.bisect_left(cal, ex)
    if j >= len(cal): return None
    s = cal[j]; c = t.replace("-", ".")
    names = {c} | ({c[:-1] + "." + c[-1]} if "." not in c and len(c) >= 2 else set())
    return all(first.get(n) is None or first[n] >= s for n in names)
only_f = gf - ga; only_a = ga - gf
nf = sum(1 for t, ex in only_f if ns(t, ex, ff)); na = sum(1 for t, ex in only_a if ns(t, ex, fa))
out = {"groups_only_f": len(only_f), "groups_only_a": len(only_a), "no_series_only_f": nf, "no_series_only_a": na,
       "net": nf - na, "first_raw_session_keys": [len(fa), len(ff)],
       "first_raw_changed": sum(1 for t in set(fa) | set(ff) if fa.get(t) != ff.get(t))}
print(json.dumps(out, indent=1))
tf = json.load(open(F + "/dividend_basis_table.json")); ta = json.load(open(A + "/dividend_basis_table.json"))
wf = {(d["t"], d["ex"]) for d in tf["withheld_detail"]}; wa = {(d["t"], d["ex"]) for d in ta["withheld_detail"]}
nsf = {(t.replace("-", "."), ex) for t, ex in only_f if ns(t, ex, ff)}; nsa = {(t.replace("-", "."), ex) for t, ex in only_a if ns(t, ex, fa)}
wnf = {x for x in nsf if x in wf}; wna = {x for x in nsa if x in wa}
print(json.dumps({"no_series_groups_only_f_that_are_withheld_first": len(wnf), "no_series_groups_only_a_that_were_withheld_first": len(wna),
                  "reconciled_no_series_delta": (len(nsf) - len(wnf)) - (len(nsa) - len(wna)),
                  "table_no_series_delta": tf["counts"]["no_series_before_ex"] - ta["counts"]["no_series_before_ex"]}, indent=1))
