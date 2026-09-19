"""cases_agg.py — merge the five case-study slices into one verdict set."""
import glob
import json
import os
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.abspath(os.path.join(HERE, "..", "research"))

recs = {}
for p in sorted(glob.glob(os.path.join(RES, "lane3-cases-*.json"))):
    try:
        d = json.load(open(p, encoding="utf-8"))
    except Exception as ex:  # noqa: BLE001
        print("SKIP %s (%s)" % (os.path.basename(p), str(ex)[:60]))
        continue
    # The five slices did not agree on a wrapper: two wrote a bare array, three
    # wrapped it under a "cases" key alongside their own metadata. Accept both —
    # a loader that silently found 40 of 100 records is worse than one that errors.
    if isinstance(d, list):
        items = d
    elif isinstance(d, dict) and isinstance(d.get("cases"), list):
        items = d["cases"]
    else:
        items = [v for v in d.values() if isinstance(v, dict) and v.get("slug")]
    for r in items:
        if isinstance(r, dict) and r.get("slug"):
            recs[r["slug"]] = r
    print("%-28s %d records" % (os.path.basename(p), len(items)))

dh = Counter(r.get("rendering_difficulty_lwc5") for r in recs.values())
infeas = [r["slug"] for r in recs.values() if r.get("infeasible")]
appr = Counter()
gaps = Counter()
for r in recs.values():
    a = (r.get("lwc5_approach") or "").lower()
    for key, lab in (("custom series", "custom series"), ("pane primitive", "pane primitive"),
                     ("series primitive", "series primitive"), ("dom", "DOM overlay"),
                     ("native", "native")):
        if key in a:
            appr[lab] += 1
    for g in (r.get("lwc5_gaps_hit") or []):
        gaps[str(g)[:60]] += 1

print("\ncases merged            : %d" % len(recs))
print("difficulty histogram   : %s" % dict(sorted((k, v) for k, v in dh.items() if k)))
print("unrated                : %d" % dh.get(None, 0))
print("INFEASIBLE             : %d %s" % (len(infeas), infeas))
print("\napproach mentions      :")
for k, v in appr.most_common():
    print("   %-20s %d" % (k, v))
print("\ntop LWC gaps hit       :")
for k, v in gaps.most_common(12):
    print("   %-58s %d" % (k, v))

json.dump({"n": len(recs), "difficulty": {str(k): v for k, v in dh.items() if k},
           "unrated": dh.get(None, 0), "infeasible": infeas,
           "approaches": dict(appr), "gaps": dict(gaps.most_common(25))},
          open(os.path.join(HERE, "cases_summary.json"), "w", encoding="utf-8"), indent=1)
