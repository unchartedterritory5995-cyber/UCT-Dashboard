"""PHASE 2/3 — dividend ledger audit for one vintage (read-only on the inputs).
(a) re-fetch the same ledger by disjoint yearly ex-date ranges (the method the final refetch
    uses) inside the same pre-open window and compare with the cursor ledger: id sets, bodies;
(b) duplicates, corrections (same ticker+ex+type, different amounts), currency, types,
    dotted/dashed spelling, tickers absent from every grouped file (delisted coverage probe);
(c) coverage of the UCT pinned population and the golden names.
argv: TAG
"""
import collections, concurrent.futures as cf, json, os, sys, time, urllib.request
TAG = sys.argv[1]
IN = "/data/_audit/v2cc/inputs_" + TAG
K = os.environ["MASSIVE_API_KEY"]; B = "https://api.massive.com"
def get(u):
    u = (u if u.startswith("http") else B + u); u += ("&" if "?" in u else "?") + "apiKey=" + K
    for i in range(7):
        try:
            with urllib.request.urlopen(u, timeout=90) as r: return json.load(r)
        except Exception: time.sleep(2 ** i)
    raise RuntimeError(u)
def paged(u):
    out = []
    while u:
        j = get(u); out += j.get("results") or []; u = j.get("next_url")
    return out
led = json.load(open(IN + "/dividends_ledger.json")); LAST = led["ex_date_lte"]; recs = led["dividends"]
t0 = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
def yr(y):
    return paged("/v3/reference/dividends?limit=1000&order=asc&sort=ex_dividend_date&ex_dividend_date.gte=%d-01-01&ex_dividend_date.lte=%s" % (y, min("%d-12-31" % y, LAST)))
with cf.ThreadPoolExecutor(6) as ex:
    yrs = [r for part in ex.map(yr, range(2000, int(LAST[:4]) + 1)) for r in part]
t1 = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
A = {r["id"]: r for r in recs if r.get("id")}; Bm = {r["id"]: r for r in yrs if r.get("id")}
R = {"refetch_window": [t0, t1], "cursor_records": len(recs), "yearly_records": len(yrs),
     "cursor_unique_ids": len(A), "yearly_unique_ids": len(Bm),
     "cursor_records_without_id": sum(1 for r in recs if not r.get("id")),
     "only_in_cursor": len(set(A) - set(Bm)), "only_in_yearly": len(set(Bm) - set(A)),
     "same_id_different_body": sum(1 for k in set(A) & set(Bm) if A[k] != Bm[k]),
     "examples_only_cursor": [A[k] for k in list(set(A) - set(Bm))[:5]],
     "examples_only_yearly": [Bm[k] for k in list(set(Bm) - set(A))[:5]],
     "examples_body_diff": [(A[k], Bm[k]) for k in list(k for k in set(A) & set(Bm) if A[k] != Bm[k])[:5]]}
R["cursor_duplicate_ids"] = len(recs) - len(A) - R["cursor_records_without_id"]
R["currency"] = dict(collections.Counter((r.get("currency") or "?") for r in recs))
R["dividend_type"] = dict(collections.Counter((r.get("dividend_type") or "?") for r in recs))
R["frequency"] = dict(collections.Counter(str(r.get("frequency")) for r in recs).most_common(10))
g = collections.defaultdict(set)
for r in recs:
    if r.get("ticker") and r.get("ex_dividend_date") and r.get("cash_amount") is not None:
        g[(r["ticker"].replace("-", "."), r["ex_dividend_date"], r.get("dividend_type") or "?")].add(round(float(r["cash_amount"]), 10))
R["same_ticker_ex_type_conflicting_amounts"] = sum(1 for v in g.values() if len(v) > 1)
R["conflict_examples"] = [(k, sorted(v)) for k, v in g.items() if len(v) > 1][:20]
ex_types = collections.defaultdict(set)
for (t, e, ty) in g: ex_types[(t, e)].add(ty)
R["same_ticker_ex_multiple_types"] = sum(1 for v in ex_types.values() if len(v) > 1)
R["multi_type_examples"] = [(k, sorted(v)) for k, v in ex_types.items() if len(v) > 1][:20]
R["zero_or_negative_cash"] = sum(1 for r in recs if r.get("cash_amount") is not None and float(r["cash_amount"]) <= 0)
R["null_ex_date"] = sum(1 for r in recs if not r.get("ex_dividend_date"))
R["ex_after_last"] = sum(1 for r in recs if (r.get("ex_dividend_date") or "") > LAST)
R["dotted_spellings"] = len({r["ticker"] for r in recs if "." in (r.get("ticker") or "")})
R["dashed_spellings"] = len({r["ticker"] for r in recs if "-" in (r.get("ticker") or "")})
G = "/data/grouped_closes_" + TAG
seen = set()
for f in sorted(os.listdir(G))[::40]:
    if f.endswith("_0.json"): seen |= set(json.load(open(os.path.join(G, f))))
seen = {t.replace("-", ".") for t in seen}
payers = {r["ticker"].replace("-", ".") for r in recs if r.get("ticker")}
R["payer_tickers"] = len(payers); R["payers_seen_in_sampled_grouped"] = len(payers & seen)
pin = [t.replace("-", ".") for t in json.load(open("/data/_audit/validation/pinned_uct_universe.json"))["tickers"]]
R["uct_pinned_with_any_dividend"] = sum(1 for t in pin if t in payers)
R["uct_pinned"] = len(pin)
by = collections.Counter((r.get("ticker") or "").replace("-", ".") for r in recs)
R["golden_counts"] = {t: by.get(t, 0) for t in ("AAPL", "TSLA", "AMZN", "GOOGL", "GOOG", "NVDA", "WHLR", "MO", "T", "KO", "O",
                                                  "COST", "XOM", "BLK", "BF.B", "BF.A", "HEI.A", "MOG.A", "META", "WMT", "DDS", "CALM")}
p = "/data/_audit/v2cc/dividend_audit_%s.json" % TAG
json.dump(R, open(p, "x"), indent=1, default=str)
print(p); print(json.dumps({k: v for k, v in R.items() if not k.startswith("examples")}, indent=1, default=str)[:6000])
