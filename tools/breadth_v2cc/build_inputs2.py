"""Build the guard + dividend tables once for a vintage (before concurrent passes), and the
dividend census that picks the evidence-based dividend anchors."""
import collections, json, os, sys
tag = sys.argv[1]
os.environ["BREADTH_GROUPED_DIR"] = "/data/grouped_closes_" + tag
IN = "/data/_audit/v2cc/inputs_" + tag
from api.services import breadth_corrected_pass as cp
inp = cp.Inputs(IN)
t = json.load(open(IN + "/dividend_basis_table.json"))
g = json.load(open(IN + "/adjusted_guard_table.json"))
led = json.load(open(IN + "/dividends_ledger.json"))
recs = led["dividends"]
R = {"ledger_records": len(recs), "first_ex": min(r["ex_dividend_date"] for r in recs if r.get("ex_dividend_date")),
     "last_ex": max(r["ex_dividend_date"] for r in recs if r.get("ex_dividend_date")),
     "tickers": len({r.get("ticker") for r in recs}),
     "currency": dict(collections.Counter((r.get("currency") or "?") for r in recs).most_common(8)),
     "types": dict(collections.Counter((r.get("dividend_type") or "?") for r in recs)),
     "dotted_tickers": len({r["ticker"] for r in recs if "." in (r.get("ticker") or "")}),
     "dividend_table_counts": t["counts"], "withheld_reasons": dict(collections.Counter(d["reason"].split(" ")[0] for d in t["withheld_detail"])),
     "guard_events_2008_2026": dict(collections.Counter(e["class"] for e in g["events"] if "2008-01-02" <= e["to"] <= "2026-09-22"))}
# duplicates in the raw ledger
dup = collections.Counter((r.get("ticker"), r.get("ex_dividend_date"), r.get("dividend_type")) for r in recs)
R["same_ticker_ex_type_multi_records"] = sum(1 for v in dup.values() if v > 1)
# evidence-based dividend anchors among CS/ADRC-ish names: biggest special (SC) yields and densest ex-dates
from api.services import breadth_grouped_history as gh
sc = []
for tk, ev in t["applied"].items():
    for s, r in ev:
        if r < 0.9:
            sc.append((round(1 - r, 4), tk, s))
sc.sort(reverse=True)
R["largest_applied_yields"] = sc[:40]
dens = collections.Counter(s for ev in t["applied"].values() for s, _ in ev)
R["densest_ex_sessions"] = [x for x in dens.most_common(40) if "2008" <= x[0] <= "2026-09-22"][:15]
json.dump(R, open("/data/_audit/v2cc/dividend_census_%s.json" % tag, "w"), indent=1)
print(json.dumps({k: v for k, v in R.items() if k not in ("largest_applied_yields",)}, indent=1))
print("LARGEST", sc[:40])
