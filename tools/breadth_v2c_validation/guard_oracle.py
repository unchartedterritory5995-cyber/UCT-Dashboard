"""PHASE 5 (independent) — re-derive the adjusted-series guard from its stated spec, with
separate code, and check it against the correction's table. Also classifies the 190
anomalies the final validation found and the golden split / defect cases.

Spec (breadth_adjusted_guard docstring): per name, consecutive sessions p→D, step
s = (adj_D/raw_D)/(adj_p/raw_p), |ln s| > ln 1.02:
  gap > 5 sessions → UNRESOLVED; |ln adj_ratio| ≤ ½|ln s| → REAL_ACTION;
  |ln raw_ratio| ≤ ½|ln s| → PROVIDER_DEFECT (→ INCONSISTENT_VINTAGE if a ledger split for
  the name executes between the two files' fetch dates); else UNRESOLVED.
Withhold boundary = D of every non-REAL event.
"""
import collections, json, math, os
from common import write

import sys
TAG = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("V2C2_TAG", "")
G = "/data/grouped_closes_" + (TAG or "v20260923")
IN = "/data/_audit/v2cc/inputs" + ("_" + TAG if TAG else "")
man = json.load(open(IN + "/grouped_vintage_manifest.json"))["manifest"]
spl = json.load(open(IN + "/splits_ledger.json"))["splits"]
canon = lambda t: t.replace("-", ".")
led = collections.defaultdict(list)
for s in spl:
    try:
        led[canon(s["ticker"])].append((s["execution_date"], s["split_to"] / s["split_from"]))
    except Exception:
        pass
cal = sorted(f[:-7] for f in os.listdir(G) if f.endswith("_1.json"))
last = {}
ev = []
for i, d in enumerate(cal):
    A = json.load(open("%s/%s_1.json" % (G, d))); Rw = json.load(open("%s/%s_0.json" % (G, d)))
    for t, a in A.items():
        r = Rw.get(t)
        if not (isinstance(a, (int, float)) and isinstance(r, (int, float)) and a > 0 and r > 0):
            continue
        t = canon(t)
        if t in last:
            j, pd_, pa, pr = last[t]
            s = math.log((a / r) / (pa / pr))
            if abs(s) > math.log(1.02) and abs(a / (pa / pr) - r) > 0.0101:
                lr, la = math.log(r / pr), math.log(a / pa)
                if i - j > 5:
                    k = "UNRESOLVED"
                elif abs(la) <= abs(s) / 2:
                    k = "REAL_ACTION"
                elif abs(lr) <= abs(s) / 2:
                    k = "PROVIDER_DEFECT"
                    f0, f1 = man["%s_1" % pd_]["fetched_start"][:10], man["%s_1" % d]["fetched_start"][:10]
                    lo, hi = min(f0, f1), max(f0, f1)
                    if any(lo <= x <= hi for x, _ in led[t]):
                        k = "INCONSISTENT_VINTAGE"
                else:
                    k = "UNRESOLVED"
                ev.append((t, pd_, d, k, round(math.exp(s), 6), round(math.exp(lr), 4), round(math.exp(la), 4)))
        last[t] = (i, d, a, r)
# ── UNAPPLIED_SPLIT (spec v4), re-derived: a ledger split (its spelling, and for an undotted
# spelling also the dotted share-class key) with |ln k| > ln 1.02 whose RAW price moved by ~1/k
# while adj/raw stayed flat — the adjusted series never absorbed it. Two-pass, own code.
import bisect
checks, need = [], collections.defaultdict(set)
for s_ in spl:
    try:
        k = s_["split_to"] / s_["split_from"]
    except Exception:
        continue
    if not s_.get("execution_date") or k <= 0 or abs(math.log(k)) <= math.log(1.02):
        continue
    j = bisect.bisect_left(cal, s_["execution_date"])
    if j == 0 or j >= len(cal):
        continue
    b = canon(s_["ticker"])
    for t in [b] + ([b[:-1] + "." + b[-1]] if "." not in b and len(b) >= 2 else []):
        checks.append((t, j, k))
        for q in range(max(0, j - 5), j + 1):
            need[q].add(t)
vals = {}
for q in sorted(need):
    A = {canon(x): v for x, v in json.load(open("%s/%s_1.json" % (G, cal[q]))).items()}
    Rw = {canon(x): v for x, v in json.load(open("%s/%s_0.json" % (G, cal[q]))).items()}
    for t in need[q]:
        a, r = A.get(t), Rw.get(t)
        if isinstance(a, (int, float)) and isinstance(r, (int, float)) and a > 0 and r > 0:
            vals[(t, q)] = (a, r)
unap = set()
for t, j, k in checks:
    if (t, j) not in vals:
        continue
    q = next((q for q in range(j - 1, max(-1, j - 6), -1) if (t, q) in vals), None)
    if q is None:
        continue
    (a1, r1), (a0, r0) = vals[(t, j)], vals[(t, q)]
    lk = abs(math.log(k))
    if abs(math.log((a1 / r1) / (a0 / r0))) <= lk / 2 and abs(math.log(r1 / r0) + math.log(k)) <= lk / 2:
        unap.add((t, cal[q], cal[j], round(math.log(r1 / r0), 4)))
for t, p_, d, lr in sorted(unap):
    ev.append((t, p_, d, "UNAPPLIED_SPLIT", 1.0, round(math.exp(lr), 4), None))
mine = collections.defaultdict(list)
for t, p, d, k, *_ in ev:
    if k != "REAL_ACTION":
        mine[t].append(d)
mine = {t: sorted(set(v)) for t, v in mine.items()}
theirs = json.load(open(IN + "/adjusted_guard_table.json"))["withhold_boundaries"] if os.path.exists(IN + "/adjusted_guard_table.json") else {}
same = {t: sorted(v) for t, v in mine.items()} == {t: sorted(set(v)) for t, v in theirs.items()}
R = {"events": len(ev), "classes": dict(collections.Counter(e[3] for e in ev)),
     "classes_2008_2026": dict(collections.Counter(e[3] for e in ev if "2008-01-02" <= e[2] <= "2026-09-11")),
     "withhold_names": len(mine), "withhold_boundaries": sum(len(v) for v in mine.values()),
     "boundaries_identical_to_correction_table": same}
if not same:
    diff = {t for t in set(mine) | set(theirs) if sorted(mine.get(t, [])) != sorted(theirs.get(t, []))}
    R["boundary_differences"] = sorted(diff)[:50]
# the 190 anomalies of the final validation, re-classified on the ONE-vintage cache
old = json.load(open("/data/_audit/validation/v2c_final/out/vintage_scan.json"))["vintage_breaks"]
old = [e for e in old if "2008-01-02" <= e["to"] <= "2026-09-11"]
idx = {(e[0], e[1], e[2]): e for e in ev}
byname = collections.defaultdict(list)
for e in ev:
    byname[e[0]].append(e)
cls = []
for o in old:
    t = canon(o["t"])
    hit = idx.get((t, o["from"], o["to"]))
    if hit:
        cls.append((o["t"], o["from"], o["to"], hit[3]))
    else:
        near = [e for e in byname.get(t, []) if abs(cal.index(e[2]) - cal.index(o["to"])) <= 2] if o["to"] in cal else []
        cls.append((o["t"], o["from"], o["to"], ("GONE_IN_ONE_VINTAGE" if not near else "NEAR:" + near[0][3])))
R["old_190_reclassified"] = dict(collections.Counter(c[3] for c in cls))
R["old_190_detail"] = cls
gold = {}
for t in ("BCPC", "TPC", "WHLR", "VWAV", "UZX", "COHR", "AAPL", "TSLA", "AMZN", "GOOGL", "GOOG", "NVDA",
          "HEI.A", "HEI", "BF.A", "BF.B", "LEN.B", "GEF.B", "MOG.A", "MOG.B", "STZ.B", "CWEN.A"):
    gold[t] = [e for e in byname.get(t, []) if e[2] >= "2008-01-02"]
R["golden_cases"] = gold
print(write("guard_oracle%s.json" % ("_" + TAG if TAG else ""), R))
print(json.dumps({k: v for k, v in R.items() if k not in ("old_190_detail", "golden_cases")}, indent=1))
for t, v in gold.items():
    print("GOLD", t, v[:8])
with open("/data/_audit/validation/v2c_final/out/guard_oracle_boundaries%s.json" % ("_" + TAG if TAG else ""), "w") as f:
    json.dump({t: sorted(v) for t, v in mine.items()}, f)
