import os
import json, collections, statistics as st, sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..")))
from api.services.fundamentals_pit.concepts import PRIMITIVES
res = json.load(open("scan.json"))
ok = [r for r in res if "err" not in r]
active = [r for r in ok if r.get("last_periodic") and r["last_periodic"] >= "2025-03-22"]
print("entities", len(res), "errors", len(res)-len(ok), "no-submissions", sum(1 for r in ok if r.get("nosub")), "anomalous merged accns", sum(r.get("anomalies",0) for r in ok))
print("active 10-K/10-Q filers (periodic filing in last 18 months):", len(active), " with ticker:", sum(1 for r in active if r.get("tickers")))
acc = sum(r.get("accns",0) for r in ok); j = sum(r.get("joined",0) for r in ok)
print(f"GATE A universe: accessions carrying relevant facts {acc:,}, joined {j:,} ({j/acc:.4%}); unjoined {acc-j:,}")
aacc = sum(r.get("accns",0) for r in active); aj = sum(r.get("joined",0) for r in active); print(f"   active filers: {aacc:,} joined {aj:,} ({aj/aacc:.4%})")
print("all facts:", f"{sum(r['all_facts'] for r in ok):,}", " relevant-tag facts:", f"{sum(r['rel_facts'] for r in ok):,}", " active relevant:", f"{sum(r['rel_facts'] for r in active):,}", " active all:", f"{sum(r['all_facts'] for r in active):,}")
print("uncompressed JSON of active:", round(sum(r['bytes'] for r in active)/1e9,2), "GB")
tax = collections.Counter(t for r in active for t in r["tax"]); print("taxonomies among active:", tax.most_common(6))
act_gaap = [r for r in active if "us-gaap" in r["tax"]]
tick = [r for r in act_gaap if r.get("tickers")]
print("active us-gaap filers:", len(act_gaap), " with ticker:", len(tick))
for pid, p in PRIMITIVES.items():
    have = sum(1 for r in tick if any(r["tags"].get(t) for t in p.tags))
    print(f"   {pid:22s} coverage (ticker'd us-gaap) {have/len(tick):6.1%}")
samp = [r for r in ok if "points" in r]
sact = [r for r in samp if r.get("last_periodic") and r["last_periodic"] >= "2025-03-22" and "us-gaap" in r["tax"] and r.get("tickers")]
print("series sample:", len(samp), " active+ticker+us-gaap in sample:", len(sact), " build s median", round(st.median(r["series_s"] for r in samp),3), "p95", round(sorted(r["series_s"] for r in samp)[int(.95*len(samp))],3), "max", round(max(r["series_s"] for r in samp),2))
print("points per company (sample): median", st.median(sum(r["points"].values()) for r in sact), " max", max(sum(r["points"].values()) for r in sact))
for m in sorted(sact[0]["points"]):
    cur = sum(1 for r in sact if r["latest"].get(m) and r["latest"][m] >= "2025-06-01")
    anyp = sum(1 for r in sact if r["points"].get(m))
    print(f"   {m:26s} any history {anyp/len(sact):6.1%}   current (period >= 2025-06) {cur/len(sact):6.1%}")
