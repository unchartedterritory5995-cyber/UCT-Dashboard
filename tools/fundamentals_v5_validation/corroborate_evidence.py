"""Read-only: are the V5-only restatement signals that drive V5's new gaps GENUINE?  For every V5-only evidence row
(accn, tag, span) of a company whose value->gap points were caused by NEW V5 evidence, public by the latest such gap,
look in companyfacts (fact table) for the same key: re-reported BY THAT FILING with a value that DIFFERS from the value
an EARLIER filing reported (corroborated), the same value (dimension-only / adjustment-member restatement, invisible to
companyfacts by construction), or no earlier value. Writes validation/corrob.json."""
import sys
CODE = "/data/fundamentals_pit_v5/code/7dfda83de6a7"
sys.path.insert(0, CODE)
import collections, json, sqlite3
from api.services.fundamentals_pit.concepts import PRIMITIVES
from api.services.fundamentals_pit.knowledge import values_equivalent, is_material

VAL = "/data/fundamentals_pit_v5/validation"
REL = frozenset(t for p in PRIMITIVES.values() for t in p.tags)
ro = lambda p: sqlite3.connect(f"file:{p}?mode=ro", uri=True, timeout=60)
v5, v4 = ro("/data/fundamentals_pit_v5/run/v5.db"), ro("/data/fundamentals_pit.db")
cf = json.load(open(VAL + "/cf.json"))
tmax = collections.defaultdict(int)
for co in cf["companies_detail"]:
    for r in co.get("rows", []):
        if r["cause"] == "NEW_V5_EVIDENCE" and r["why"] == "V4VALUE_TO_V5GAP":
            tmax[r["cik"]] = max(tmax[r["cik"]], r["t"])
q = "SELECT s.accn, s.tag, s.period_start, s.period_end FROM filing_signal s JOIN filing f ON f.accn=s.accn WHERE f.cik=? AND f.public_at<=?"
res = collections.Counter(); per_tag = collections.Counter(); ex = collections.defaultdict(list)
for cik, t in tmax.items():
    only5 = set(v5.execute(q, (cik, t))) - set(v4.execute(q, (cik, t)))
    for accn, tag, ps, pe in only5:
        if tag not in REL:
            res["non_primitive_tag"] += 1
            continue
        rows = v5.execute("SELECT x.val, fi.accn, fi.public_at FROM fact x JOIN concept c ON c.concept_id=x.concept_id JOIN filing fi "
                          "ON fi.filing_id=x.filing_id WHERE x.cik=? AND c.tag=? AND x.period_start=? AND x.period_end=? ORDER BY fi.public_at",
                          (cik, tag, ps, pe)).fetchall()
        mine = [v for v, a, p in rows if a == accn]
        pubm = min([p for v, a, p in rows if a == accn] or [None]) if mine else None
        prior = [v for v, a, p in rows if a != accn and pubm is not None and p < pubm]
        if not mine:
            k = "filing_reports_no_primary_value_for_key"
        elif not prior:
            k = "no_earlier_value"
        elif any(not values_equivalent(prior[-1], m) and is_material(prior[-1], m) for m in mine):
            k = "CORROBORATED_value_changed"
        elif any(prior[-1] != m for m in mine):
            k = "immaterial_or_rounding_change"
        else:
            k = "same_value_in_companyfacts"
        res[k] += 1; per_tag[(k, tag)] += 1
        if len(ex[k]) < 6:
            ex[k].append([cik, accn, tag, ps, pe, prior[-1:] if prior else None, mine[:2]])
out = {"companies": len(tmax), "evidence_rows": sum(res.values()), "counts": res,
       "top_tags": [[k, tg, n] for (k, tg), n in per_tag.most_common(20)], "examples": ex}
json.dump(out, open(VAL + "/corrob.json", "w"), indent=1, default=str)
print(json.dumps({k: out[k] for k in ("companies", "evidence_rows", "counts")}, default=str))
