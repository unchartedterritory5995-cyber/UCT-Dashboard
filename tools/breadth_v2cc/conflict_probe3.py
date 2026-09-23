"""Same (ticker, ex, type) with IDENTICAL amounts under DISTINCT ids, common stock only:
duplicate publication (collapse) or two equal distributions (sum)? Yahoo decides a sample,
split-adjustment undone. Read-only."""
import bisect, collections, json, os, random, sys
TAG = sys.argv[1]
os.environ["BREADTH_GROUPED_DIR"] = "/data/grouped_closes_" + TAG
from api.services import breadth_pit_frame as bpf
IN = "/data/_audit/v2cc/inputs_" + TAG; G = os.environ["BREADTH_GROUPED_DIR"]
cal = sorted(f[:-7] for f in os.listdir(G) if f.endswith("_1.json"))
ref = bpf.reference_map()
_c = {}
def raw(iso):
    if iso not in _c:
        _c[iso] = {k.replace("-", "."): v for k, v in json.load(open("%s/%s_0.json" % (G, iso))).items()}
        if len(_c) > 30: _c.pop(next(iter(_c)))
    return _c[iso]
def spelled(t, j):
    if "." in t or len(t) < 2: return t
    y = t[:-1] + "." + t[-1]; w = cal[max(0, j - 5):j]
    a = any(t in raw(x) for x in w); b = any(y in raw(x) for x in w)
    return None if a and b else (y if b else t)
led = json.load(open(IN + "/dividends_ledger.json"))["dividends"]
g = collections.defaultdict(list)
for r in led:
    ex = r.get("ex_dividend_date")
    if not (r.get("ticker") and ex and r.get("cash_amount") is not None and (r.get("currency") or "USD") == "USD"): continue
    j = bisect.bisect_left(cal, ex)
    if j == 0 or j >= len(cal) or ex < "2006-01-01": continue
    t = spelled(r["ticker"].replace("-", "."), j)
    if t: g[(t, ex, r.get("dividend_type") or "?", j)].append(r)
dup = []
for (t, ex, ty, j), v in g.items():
    c = collections.Counter(round(float(x["cash_amount"]), 10) for x in v)
    rep = [a for a, n in c.items() if n > 1]
    if not rep: continue
    rec = bpf.resolve(ref.get(t), cal[j])
    if rec is None or rec.get("type") not in bpf.COMMON_TYPES: continue
    if not raw(cal[j - 1]).get(t): continue
    same = lambda k: len({str(x.get(k)) for x in v if round(float(x["cash_amount"]), 10) in rep}) == 1
    dup.append({"t": t, "ex": ex, "type": ty, "amounts": sorted(float(x["cash_amount"]) for x in v),
                "same_pay": same("pay_date"), "same_decl": same("declaration_date"), "same_freq": same("frequency"),
                "same_record": same("record_date")})
R = {"cs_identical_amount_groups_2006_2026": len(dup), "tickers": len({x["t"] for x in dup}),
     "shape": dict(collections.Counter("%s|%s|%s" % (x["same_pay"], x["same_decl"], x["same_freq"]) for x in dup))}
import yfinance as yf
random.seed(5)
cls = collections.Counter(); rows = []
for x in random.sample(dup, min(60, len(dup))):
    try:
        tk = yf.Ticker(x["t"].replace(".", "-")); d = tk.dividends; sp = tk.splits
        d.index = [i.strftime("%Y-%m-%d") for i in d.index]; sp.index = [i.strftime("%Y-%m-%d") for i in sp.index]
        k = 1.0
        for sd, f in sp.items():
            if sd > x["ex"] and f > 0: k *= float(f)
        y = float(d.get(x["ex"])) * k if x["ex"] in d.index else None
    except Exception:
        y = None
    collapsed = sum(sorted(set(x["amounts"]))); summed = sum(x["amounts"])
    tol = lambda v: max(6e-4, 1e-3 * v)
    c = ("no_yahoo" if y is None else "summed_all" if abs(y - summed) <= tol(y) else
         "collapsed" if abs(y - collapsed) <= tol(y) else "other")
    cls[c] += 1; x["yahoo"] = y; x["class"] = c; rows.append(x)
R["yahoo_sample"] = dict(cls); R["rows"] = rows
p = "/data/_audit/v2cc/dividend_identical_cs_%s.json" % TAG
json.dump(R, open(p, "x"), indent=1, default=str)
print(p); print(json.dumps({k: v for k, v in R.items() if k != "rows"}, indent=1))
for r in rows: print(r["t"], r["ex"], r["amounts"], r["yahoo"], r["class"], r["same_pay"], r["same_decl"], r["same_freq"])
