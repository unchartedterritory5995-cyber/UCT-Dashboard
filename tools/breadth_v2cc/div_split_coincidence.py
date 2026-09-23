"""Applied dividends whose ex-session ALSO carries a provider adjustment: an adj/raw factor step
between the prior session and the ex-session, or a ledger split executing in (prev, ex-session].
Scrip / stock dividends (BP 2015-2020) are recorded as BOTH -> the level would double-count.
Read-only census."""
import bisect, collections, json, math, os, sys
TAG = sys.argv[1]
os.environ["BREADTH_GROUPED_DIR"] = "/data/grouped_closes_" + TAG
from api.services import breadth_pit_frame as bpf
IN = "/data/_audit/v2cc/inputs_" + TAG; G = os.environ["BREADTH_GROUPED_DIR"]
cal = sorted(f[:-7] for f in os.listdir(G) if f.endswith("_1.json")); pos = {d: i for i, d in enumerate(cal)}
T = json.load(open(IN + "/dividend_basis_table.json"))
spl = json.load(open(IN + "/splits_ledger.json"))["splits"]
led = collections.defaultdict(list)
for s in spl:
    try: k = float(s["split_to"]) / float(s["split_from"])
    except Exception: continue
    b = s["ticker"].replace("-", ".")
    for t in [b] + ([b[:-1] + "." + b[-1]] if "." not in b and len(b) >= 2 else []):
        led[t].append((s["execution_date"], k))
ev = sorted(((s, t, r) for t, v in T["applied"].items() for s, r in v if s >= "2007-01-01"))
_c = {}
def day(iso):
    if iso not in _c:
        if len(_c) > 40: _c.pop(next(iter(_c)))
        _c[iso] = ({k.replace("-", "."): v for k, v in json.load(open("%s/%s_1.json" % (G, iso))).items()},
                   {k.replace("-", "."): v for k, v in json.load(open("%s/%s_0.json" % (G, iso))).items()})
    return _c[iso]
ref = bpf.reference_map()
out = collections.Counter(); rows = []
for s, t, r in ev:
    j = pos[s]
    a1, r1 = day(s)[0].get(t), day(s)[1].get(t)
    if not (a1 and r1): continue
    p = next((i for i in range(j - 1, max(-1, j - 6), -1) if day(cal[i])[0].get(t) and day(cal[i])[1].get(t)), None)
    if p is None: continue
    a0, r0 = day(cal[p])[0][t], day(cal[p])[1][t]
    fstep = (a1 / r1) / (a0 / r0)
    ls = [k for (e, k) in led.get(t, ()) if cal[p] < e <= s]
    step = abs(math.log(fstep)) > 0.001 and abs(a1 / (a0 / r0) - r1) > 0.0101
    if not (step or ls): continue
    rec = bpf.resolve(ref.get(t), s); cs = bool(rec) and rec.get("type") in bpf.COMMON_TYPES
    near = step and abs(math.log(fstep) + math.log(r)) < 0.25 * abs(math.log(r))    # f moved by ~the dividend
    key = ("CS" if cs else "nonCS") + "|" + ("fstep~div" if near else "fstep" if step else "ledger_only") + ("|ledger" if ls else "")
    out[key] += 1
    if cs and len(rows) < 400: rows.append((t, s, round(r, 5), round(fstep, 5), ls))
R = {"applied_events_2007_plus": len(ev), "coincidences": dict(out),
     "cs_tickers": collections.Counter(x[0] for x in rows).most_common(40), "cs_rows": rows}
p = "/data/_audit/v2cc/div_split_coincidence_%s.json" % TAG
json.dump(R, open(p, "x"), indent=1)
print(p); print(json.dumps({k: v for k, v in R.items() if k != "cs_rows"}, indent=1)); print(rows[:60])
