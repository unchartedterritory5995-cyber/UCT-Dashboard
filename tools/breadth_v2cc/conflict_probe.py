"""What ARE the conflicting (ticker, ex, type) dividend groups inside the tradable universe,
and what does Yahoo (the live collector's source) do with them? Read-only."""
import bisect, collections, json, os, random, sys
TAG = sys.argv[1]
IN = "/data/_audit/v2cc/inputs_" + TAG; G = "/data/grouped_closes_" + TAG
cal = sorted(f[:-7] for f in os.listdir(G) if f.endswith("_1.json"))
_c = {}
def raw(iso):
    if iso not in _c:
        _c[iso] = {k.replace("-", "."): v for k, v in json.load(open("%s/%s_0.json" % (G, iso))).items()}
        if len(_c) > 30: _c.pop(next(iter(_c)))
    return _c[iso]
led = json.load(open(IN + "/dividends_ledger.json"))["dividends"]
g = collections.defaultdict(list)
for r in led:
    if r.get("ticker") and r.get("ex_dividend_date") and r.get("cash_amount") is not None and (r.get("currency") or "USD") == "USD":
        g[(r["ticker"].replace("-", "."), r["ex_dividend_date"], r.get("dividend_type") or "?")].append(r)
conf = sorted(((k, v) for k, v in g.items() if len({round(float(x["cash_amount"]), 10) for x in v}) > 1), key=lambda kv: kv[0][1])
inuni = []
for (t, ex, ty), v in conf:
    j = bisect.bisect_left(cal, ex)
    if j == 0 or j >= len(cal): continue
    p = raw(cal[j - 1]).get(t)
    if p and p >= 2:
        inuni.append(((t, ex, ty), v, p))
shape = collections.Counter()
for k, v, p in inuni:
    pays = {x.get("pay_date") for x in v}; decl = {x.get("declaration_date") for x in v}; rec = {x.get("record_date") for x in v}
    fr = {x.get("frequency") for x in v}
    shape[("distinct_pay" if len(pays) > 1 else "same_pay") + "|" + ("distinct_decl" if len(decl) > 1 else "same_decl") + "|" + ("distinct_freq" if len(fr) > 1 else "same_freq")] += 1
by_year = collections.Counter(k[1][:4] for k, v, p in inuni)
R = {"conflict_groups_all_usd": len(conf), "conflict_groups_traded_ge_2usd": len(inuni), "shape": dict(shape),
     "by_year": dict(sorted(by_year.items()))}
random.seed(7)
sample = [x for x in inuni if x[0][1] >= "2010-01-01"]
sample = random.sample(sample, min(40, len(sample)))
import yfinance as yf
yc = collections.Counter(); rows = []
for (t, ex, ty), v, p in sample:
    try:
        d = yf.Ticker(t.replace(".", "-")).dividends
        d.index = [x.strftime("%Y-%m-%d") for x in d.index]
        y = float(d.get(ex)) if ex in d.index else None
    except Exception:
        y = None
    am = sorted(float(x["cash_amount"]) for x in v)
    k = ("no_yahoo" if y is None else "sum" if abs(y - sum(am)) < 1e-4 else "max" if abs(y - am[-1]) < 1e-4 else
         "min" if abs(y - am[0]) < 1e-4 else "other")
    yc[k] += 1
    rows.append({"t": t, "ex": ex, "type": ty, "amounts": am, "yahoo": y, "class": k, "prev_raw": p,
                 "records": [{kk: x.get(kk) for kk in ("id", "declaration_date", "pay_date", "record_date", "frequency", "cash_amount")} for x in v]})
R["yahoo_sample_classes"] = dict(yc); R["yahoo_sample"] = rows
p = "/data/_audit/v2cc/dividend_conflicts_%s.json" % TAG
json.dump(R, open(p, "x"), indent=1, default=str)
print(p); print(json.dumps({k: v for k, v in R.items() if k != "yahoo_sample"}, indent=1))
for r in rows: print(r["t"], r["ex"], r["amounts"], r["yahoo"], r["class"], [(x["declaration_date"], x["pay_date"], x["frequency"]) for x in r["records"]])
