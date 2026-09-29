"""Phase 12: explain every dividend-table difference v20260924a -> v20260924f. Read-only JSON."""
import json, collections, os, sys
A, F = "/data/_audit/v2cc/inputs_v20260924a", "/data/_audit/v2cc/inputs_v20260924f"
ta, tf = (json.load(open(p + "/dividend_basis_table.json")) for p in (A, F))
la, lf = (json.load(open(p + "/dividends_ledger.json")) for p in (A, F))
out = {"counts_a": ta["counts"], "counts_f": tf["counts"],
       "ledger": {"a": {"n": la["n"], "ex_date_lte": la.get("ex_date_lte")}, "f": {"n": lf["n"], "ex_date_lte": lf.get("ex_date_lte")}},
       "count_delta": {k: tf["counts"].get(k, 0) - ta["counts"].get(k, 0) for k in set(ta["counts"]) | set(tf["counts"])}}
def recset(l):
    return collections.Counter(json.dumps({k: d.get(k) for k in ("ticker", "ex_dividend_date", "cash_amount", "currency", "dividend_type")}, sort_keys=True) for d in l["dividends"])
ra, rf = recset(la), recset(lf)
new_recs = rf - ra; gone_recs = ra - rf
out["ledger_records_new"] = sum(new_recs.values()); out["ledger_records_gone"] = sum(gone_recs.values())
nk = collections.Counter(); byex = collections.Counter()
newkeys = set()
for s, n in new_recs.items():
    d = json.loads(s); newkeys.add((d["ticker"], d["ex_dividend_date"])); byex[d["ex_dividend_date"][:7]] += n
gonekeys = {(json.loads(s)["ticker"], json.loads(s)["ex_dividend_date"]) for s in gone_recs}
out["new_records_by_ex_month_top"] = byex.most_common(15)
out["new_records_sample"] = [json.loads(s) for s in list(new_recs)[:15]]
out["gone_records_sample"] = [json.loads(s) for s in list(gone_recs)[:15]]
# event-level diffs
def ev_app(t): return {(tk, s): r for tk, v in t["applied"].items() for s, r in v}
def ev_wh(t): return {(d["t"], d["session"]): d for d in t["withheld_detail"]}
aa, af, wa, wf = ev_app(ta), ev_app(tf), ev_wh(ta), ev_wh(tf)
def sess_ex(t): return {(d["t"], d["session"]): d["ex"] for d in t["withheld_detail"]}
out["applied"] = {"a": len(aa), "f": len(af), "only_a": len(set(aa) - set(af)), "only_f": len(set(af) - set(aa)),
                  "r_changed": sum(1 for k in set(aa) & set(af) if abs(aa[k] - af[k]) > 1e-12)}
out["withheld_detail"] = {"a": len(wa), "f": len(wf), "only_a": len(set(wa) - set(wf)), "only_f": len(set(wf) - set(wa)),
                          "reason_changed": sum(1 for k in set(wa) & set(wf) if wa[k]["reason"] != wf[k]["reason"])}
# classify withheld only_f / only_a by reason and by ledger novelty
tick_new = {t for t, _ in newkeys}
def cls_wh(d, novel_keys):
    k = (d["t"], d["ex"])
    tag = "ledger_new_or_changed_record" if k in novel_keys or (d["t"].replace(".", ""), d["ex"]) in novel_keys else "same_ledger_record"
    return tag + " | " + d["reason"].split(":")[0].split(" %")[0][:60]
out["withheld_only_f_classes"] = collections.Counter(cls_wh(wf[k], newkeys) for k in set(wf) - set(wa)).most_common(30)
out["withheld_only_a_classes"] = collections.Counter(cls_wh(wa[k], gonekeys) for k in set(wa) - set(wf)).most_common(30)
out["withheld_only_f_sample"] = [wf[k] for k in sorted(set(wf) - set(wa))[:25]]
out["withheld_only_a_sample"] = [wa[k] for k in sorted(set(wa) - set(wf))[:25]]
# applied only_f / only_a / r_changed: is the (ticker, session) tied to a new/changed ledger record?
def appcls(keys, novel):
    c = collections.Counter()
    for t, s in keys:
        c["ledger_new_or_changed_ticker" if (t in {x for x, _ in novel} or t.replace(".", "") in {x for x, _ in novel}) else "same_ledger_ticker"] += 1
    return dict(c)
oa, of_ = set(aa) - set(af), set(af) - set(aa)
out["applied_only_f_vs_ledger"] = appcls(of_, newkeys); out["applied_only_a_vs_ledger"] = appcls(oa, gonekeys)
out["applied_only_f_sample"] = sorted(of_)[:25]; out["applied_only_a_sample"] = sorted(oa)[:25]
rc = sorted(k for k in set(aa) & set(af) if abs(aa[k] - af[k]) > 1e-12)
out["r_changed_sample"] = [(k, aa[k], af[k]) for k in rc[:25]]
# for applied/withheld moves on the SAME ledger record: compare the prior raw close across the two vintages
GA, GF = "/data/grouped_closes_v20260924a", "/data/grouped_closes_v20260924f"
out["grouped_a_present"] = os.path.isdir(GA)
print(json.dumps(out, indent=1, default=str))
