# -*- coding: utf-8 -*-
"""W0 post-processing of coverage-map.json: per-wall and per-wave target script lists,
both lanes, plus the capture shortlist. Joins only what coverage_map.py already wrote."""
import collections
import json
import os
import sys

new_p, old_p, out_p = sys.argv[1:4]
d = json.load(open(new_p, encoding="utf-8"))
old = json.load(open(old_p, encoding="utf-8"))
S = {s["key"]: s for s in d["scripts"]}
label_cap = {b["blocker"]: b["capability"] for b in d["blockers"]}

from targets_waves import PROD_WAVE  # noqa: E402


def rt_wave(w):
    if w in ("pine:builtin", "pine:function", "pine:arity", "pine:input-kind", "pine:named-argument", "pine:role-order"):
        return "W1"
    if w in ("pine:drawing", "host:pine:object-removal-lost") or w.startswith("host:pine:object"):
        return "W3"
    if w in ("runtime:array", "pine:collection", "runtime:udt-method", "pine:type", "pine:member", "runtime:map",
             "runtime:matrix", "runtime:for-in", "runtime:tuple-collection") or w.startswith(("runtime:array", "runtime:udt", "runtime:matrix", "runtime:map")):
        return "W6"
    if w in ("pine:request",) or w.startswith(("runtime:request", "lower-tf:")):
        return "W7"
    if w == "runtime:library":
        return "W8"
    if w.startswith(("pine:strategy", "runtime:strategy")):
        return "W9"
    if w.startswith("host:pine:constant-only") or w.startswith("host:pine:presentation-only") or w == "threw":
        return "other"
    return "W4"


def brief(k):
    s = S.get(k, {})
    return {"key": k, "title": s.get("title"), "agree": s.get("agreeCount"), "v": s.get("version")}


# ---- production lane
notclean = [s for s in d["scripts"] if not s["clean"]]
enum_ = {s["key"] for s in notclean if s["attached"] or s["reachedAfterPeel"]}
wall_scripts = collections.defaultdict(list)
for s in notclean:
    for w in s["walls"]:
        wall_scripts[w].append(s["key"])
prod_wave = collections.defaultdict(lambda: {"blocks": [], "onlyThisWave": [], "firm": []})
for s in notclean:
    ws = {PROD_WAVE.get(label_cap.get(w, "?"), "?") for w in s["walls"]}
    for wv in ws:
        prod_wave[wv]["blocks"].append(s["key"])
    if len(ws) == 1:
        wv = next(iter(ws))
        prod_wave[wv]["onlyThisWave"].append(s["key"])
        if s["key"] in enum_:
            prod_wave[wv]["firm"].append(s["key"])

# ---- runtime-on lane
ro = d["runtimeOn"]
rt_by = ro["walls"]["byScript"]
rt_wall_scripts = collections.defaultdict(list)
HOST_DIRTY = []
rtw = collections.defaultdict(lambda: {"blocks": [], "onlyThisWave": []})
for k, ws in rt_by.items():
    for w in set(ws):
        rt_wall_scripts[w].append(k)
    wv = {rt_wave(w) for w in ws}
    if "[strategy]" in S[k]["walls"]:      # orders are never simulated: W9 always
        wv.add("W9")
    if not wv:                             # host attached, objects dropped / paint withheld
        HOST_DIRTY.append(k)
    wv = wv or {"W3"}
    for x in wv:
        rtw[x]["blocks"].append(k)
    if len(wv) == 1:
        rtw[next(iter(wv))]["onlyThisWave"].append(k)

def greedy(sets, base):
    rem, fixed, out, cum = dict(sets), set(), [], base
    while rem:
        touch = collections.Counter(x for v in rem.values() for x in v - fixed)
        if not touch:
            break
        gain = collections.Counter(next(iter(v - fixed)) for v in rem.values() if len(v - fixed) == 1)
        best = max(touch, key=lambda b: (gain[b], touch[b], b))
        fixed.add(best)
        done = [k for k, v in rem.items() if not (v - fixed)]
        for k in done:
            del rem[k]
        cum += len(done)
        out.append({"wave": best, "touches": touch[best], "unblocks": len(done), "cumulative": cum})
    return out


prod_sets = {s["key"]: {PROD_WAVE.get(label_cap.get(w, "?"), "?") for w in s["walls"]} for s in notclean}
rt_sets = {}
for k, ws in rt_by.items():
    v = {rt_wave(w) for w in ws}
    if "[strategy]" in S[k]["walls"]:
        v.add("W9")
    rt_sets[k] = v or {"W3"}   # host-attached with dropped objects / withheld paint: W3 owns it
WAVE_GREEDY = {"production": greedy(prod_sets, sum(1 for s in d["scripts"] if s["clean"])),
               "runtime-on": greedy(rt_sets, ro["transfer"])}
print("wave greedy", json.dumps(WAVE_GREEDY))

# ---- captures: transfer (either lane) without a MATCH, greedy over supported-unverified items
items = {i["name"]: i for i in d["inventory"]["items"]}
unver = {n for n, i in items.items() if i["status"].startswith("supported-unverified")}
rt_on = set(ro["added"]) | {s["key"] for s in d["scripts"] if s["clean"]}
cands = [s for s in d["scripts"] if s["key"] in rt_on and s["vendorVerdict"] != "MATCH"]
import os, re
cache = os.path.dirname(new_p)
inputs = None
covered, picks = set(), []
# item usage per script from the inventory is not per-script; re-derive from scripts' source via census_input
inp = json.load(open(sys.argv[4], encoding="utf-8")) if len(sys.argv) > 4 else []
path_of = {i["key"]: i["path"] for i in inp}
names_sorted = sorted(unver, key=len, reverse=True)


sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coverage_map as CM
INV = CM.Inventory(json.load(open(sys.argv[5], encoding="utf-8")))


def uses(k):
    try:
        src = open(path_of[k], encoding="utf-8").read()
    except Exception:
        return set()
    return {n for n in CM.usage_of(src, INV)["items"] if n in unver and not n.startswith(CM.UNGRADED_PREFIXES)}


U = {s["key"]: uses(s["key"]) for s in cands}
while True:
    best = max(cands, key=lambda s: (len(U[s["key"]] - covered), s.get("agreeCount") or 0), default=None)
    if not best or not (U[best["key"]] - covered):
        break
    new = sorted(U[best["key"]] - covered)
    covered |= set(new)
    picks.append({**brief(best["key"]), "lane": "production" if best["clean"] else "runtime-on",
                  "existingCapture": best["vendorVerdict"], "verifiesNewItems": new})
    cands = [s for s in cands if s["key"] != best["key"]]
inconclusive = [brief(s["key"]) | {"verdict": s["vendorVerdict"]} for s in d["scripts"]
                if s["clean"] and s["vendorVerdict"] in ("INCONCLUSIVE", "DIVERGE")]
popular_uncaptured = sorted((s for s in d["scripts"] if s["key"] in rt_on and not s["vendorVerdict"]),
                            key=lambda s: -(s.get("agreeCount") or 0))[:30]

out = {
    "prodWalls": {w: sorted(v) for w, v in sorted(wall_scripts.items(), key=lambda kv: -len(kv[1]))},
    "prodWallCapability": label_cap,
    "prodWaves": {w: {k: sorted(v) for k, v in x.items()} for w, x in sorted(prod_wave.items())},
    "runtimeWalls": {w: sorted(v) for w, v in sorted(rt_wall_scripts.items(), key=lambda kv: -len(kv[1]))},
    "runtimeWallWave": {w: rt_wave(w) for w in rt_wall_scripts},
    "runtimeWaves": {w: {k: sorted(v) for k, v in x.items()} for w, x in sorted(rtw.items())},
    "waveGreedy": WAVE_GREEDY,
    "runtimeOnHostAttachedDirty": sorted(HOST_DIRTY),
    "captureGreedy": picks,
    "captureRegradeTransferring": inconclusive,
    "capturePopularUncaptured": [brief(s["key"]) | {"lane": "production" if s["clean"] else "runtime-on"} for s in popular_uncaptured],
    "unverifiedItems": len(unver), "unverifiedItemsCoveredByGreedy": len(covered),
    "titles": {k: (S[k].get("title") or k) for k in S},
}
json.dump(out, open(out_p, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print("prod waves", {w: (len(x["blocks"]), len(x["onlyThisWave"]), len(x["firm"])) for w, x in sorted(prod_wave.items())})
print("rt waves", {w: (len(x["blocks"]), len(x["onlyThisWave"])) for w, x in sorted(rtw.items())})
print("captures greedy", len(picks), "covering", len(covered), "of", len(unver))
oh, nh = old["headline"], d["headline"]
print("old", oh["transfer"], oh["attachedAnyForm"], old["runtimeOn"]["transfer"], old["parity"]["verdicts"], old["parity"]["verifiedTransfer"])
print("new", nh["transfer"], nh["attachedAnyForm"], ro["transfer"], d["parity"]["verdicts"], d["parity"]["verifiedTransfer"])
