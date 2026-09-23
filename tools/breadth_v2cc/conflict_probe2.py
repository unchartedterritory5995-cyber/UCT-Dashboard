"""Conflicting dividend groups restricted to COMMON STOCK (the breadth universes' type), and
Yahoo's treatment of a larger CS sample: SUM vs ONE-OF vs other; relative gap between the two
closest amounts (restatement signature). Read-only."""
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
cs = []
for (t, ex, ty, j), v in g.items():
    am = {round(float(x["cash_amount"]), 10) for x in v}
    if len(am) < 2: continue
    rec = bpf.resolve(ref.get(t), cal[j])
    if rec is None or rec.get("type") not in bpf.COMMON_TYPES: continue
    p = raw(cal[j - 1]).get(t)
    if not p: continue
    s = sorted(am); gap = min((b - a) / b for a, b in zip(s, s[1:]))
    cs.append({"t": t, "ex": ex, "type": ty, "amounts": s, "prev_raw": p, "min_rel_gap": gap,
               "freqs": sorted({str(x.get("frequency")) for x in v}), "pays": sorted({str(x.get("pay_date")) for x in v})})
R = {"cs_conflict_groups_2006_2026": len(cs), "cs_tickers": len({x["t"] for x in cs}),
     "by_year": dict(sorted(collections.Counter(x["ex"][:4] for x in cs).items())),
     "min_rel_gap_hist": dict(collections.Counter(("<0.5%" if x["min_rel_gap"] < .005 else "<2%" if x["min_rel_gap"] < .02 else
                                                    "<10%" if x["min_rel_gap"] < .1 else ">=10%") for x in cs)),
     "top_tickers": collections.Counter(x["t"] for x in cs).most_common(25)}
import yfinance as yf
random.seed(11)
smp = random.sample(cs, min(80, len(cs)))
cls = collections.Counter(); rows = []
for x in smp:
    try:
        d = yf.Ticker(x["t"].replace(".", "-")).dividends
        d.index = [i.strftime("%Y-%m-%d") for i in d.index]
        y = float(d.get(x["ex"])) if x["ex"] in d.index else None
    except Exception:
        y = None
    a = x["amounts"]
    tol = lambda v: max(6e-4, 1e-3 * v)
    k = ("no_yahoo" if y is None else "sum" if abs(y - sum(a)) <= tol(y) else
         "one_of" if any(abs(y - v) <= tol(y) for v in a) else "other")
    cls[k] += 1; x["yahoo"] = y; x["class"] = k; rows.append(x)
R["yahoo_cs_sample"] = dict(cls)
R["yahoo_by_gap"] = dict(collections.Counter((("near" if r["min_rel_gap"] < .02 else "far"), r["class"]) for r in rows).items()) if rows else {}
R["yahoo_by_gap"] = {"%s|%s" % k: v for k, v in R["yahoo_by_gap"].items()}
R["rows"] = rows
p = "/data/_audit/v2cc/dividend_conflicts_cs_%s.json" % TAG
json.dump(R, open(p, "x"), indent=1, default=str)
print(p); print(json.dumps({k: v for k, v in R.items() if k != "rows"}, indent=1, default=str))
for r in rows:
    if r["class"] != "sum": print(r["t"], r["ex"], r["amounts"], r["yahoo"], r["class"], round(r["min_rel_gap"], 4), r["freqs"], r["pays"])
