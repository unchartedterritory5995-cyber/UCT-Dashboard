import json, collections, bisect, os
A, F = "/data/_audit/v2cc/inputs_v20260924a", "/data/_audit/v2cc/inputs_v20260924f"
ta, tf = (json.load(open(p + "/dividend_basis_table.json")) for p in (A, F))
la, lf = (json.load(open(p + "/dividends_ledger.json")) for p in (A, F))
K = ("ticker", "ex_dividend_date", "cash_amount", "currency", "dividend_type")
key = lambda d: tuple(d.get(k) for k in K)
ca, cf = collections.Counter(map(key, la["dividends"])), collections.Counter(map(key, lf["dividends"]))
new, gone = cf - ca, ca - cf
tex_a = {(d["ticker"], d["ex_dividend_date"]) for d in la["dividends"] if d.get("ex_dividend_date")}
kinds = collections.Counter()
for k, n in new.items():
    tx = (k[0], k[1])
    if k[1] and k[1] > la["ex_date_lte"]: kinds["new: ex after a's ex_date_lte %s" % la["ex_date_lte"]] += n
    elif tx in tex_a: kinds["changed field on an existing (ticker,ex)"] += n
    else: kinds["historical record added (ticker,ex) absent in a"] += n
gk = collections.Counter()
tex_f = {(d["ticker"], d["ex_dividend_date"]) for d in lf["dividends"] if d.get("ex_dividend_date")}
for k, n in gone.items():
    gk["removed; (ticker,ex) still present in f" if (k[0], k[1]) in tex_f else "removed entirely"] += n
hist = sorted(k for k in new if not (k[1] and k[1] > la["ex_date_lte"]))
# applied only-f events: session distribution and which records produce them
aa = {(t, s) for t, v in ta["applied"].items() for s, r in v}
af = {(t, s) for t, v in tf["applied"].items() for s, r in v}
of_ = sorted(af - aa)
cal = sorted(f[:-7] for f in os.listdir("/data/grouped_closes_v20260924f") if f.endswith("_1.json"))
sess_of = lambda ex: cal[bisect.bisect_left(cal, ex)] if bisect.bisect_left(cal, ex) < len(cal) else None
newsess = collections.defaultdict(set)
for k in new:
    if k[1]: newsess[(k[0].replace("-", "."), sess_of(k[1]))].add(k)
def dotted(t): return {t, t[:-1] + "." + t[-1]} if "." not in t and len(t) >= 2 else {t}
expl = collections.Counter(); unexpl = []
for t, s in of_:
    hit = any((x, s) in newsess for x in {t, t.replace(".", "")}) or any((y, s) in newsess for y in dotted(t.replace(".", "")))
    if hit: expl["explained by a new ledger record at that session"] += 1
    else: unexpl.append((t, s))
wa = {(d["t"], d["session"]) for d in ta["withheld_detail"]}; wf = {(d["t"], d["session"]) for d in tf["withheld_detail"]}
gonesess = {(k[0], sess_of(k[1])) for k in gone if k[1]}
wexpl = {"only_f_explained_by_new_record": sum(1 for x in wf - wa if x in newsess), "only_f_unexplained": sorted(x for x in wf - wa if x not in newsess),
         "only_a_explained_by_removed_record": sum(1 for x in wa - wf if x in gonesess), "only_a_unexplained": sorted(x for x in wa - wf if x not in gonesess)}
print(json.dumps({"new_record_kinds": kinds, "gone_record_kinds": gk, "historical_added": [list(k) for k in hist],
  "applied_only_f": len(of_), "applied_only_f_sessions": collections.Counter(s for _, s in of_),
  "applied_only_f_explained": expl, "applied_only_f_unexplained": unexpl, "withheld": wexpl,
  "no_series_before_ex_delta": tf["counts"]["no_series_before_ex"] - ta["counts"]["no_series_before_ex"]}, indent=1, default=str))
