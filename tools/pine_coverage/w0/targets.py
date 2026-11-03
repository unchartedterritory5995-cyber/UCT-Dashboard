# -*- coding: utf-8 -*-
"""W0 post-processing of coverage-map.json: per-wall and per-wave target script lists, both
lanes, plus the capture lists (docs/pine/COVERAGE-MAP-2026-11-02.md sections 4 to 8).

  python tools/pine_coverage/w0/targets.py --map docs/pine/coverage-map.json \\
      --census-input <production census cache>/census_input.json --ref <pine_v6_reference.json> \\
      --out docs/pine/coverage-targets-2026-11-02.json [--old-map <previous coverage-map.json>]

Reads
  --map           coverage-map.json (coverage_map.py). Every wall, wave and verdict list is a
                  join over it.
  --census-input  the census_input.json that run_census.py writes into the PRODUCTION cache:
                  script key -> local source path. Only the capture lists read sources (item
                  usage, and the capture join below). The sources are licence-held: local only,
                  never committed.
  --ref           the TradingView v6 reference (coverage_map.usage_of reads its inventory).
  --old-map       optional: the previous coverage-map.json, for the printed before/after line.
  tests/fixtures/vendor/harness   the committed captures, joined to scripts by source.

Every capture list judges a script in its OWN lane: a production transfer by the production
harness run (scripts[].vendorVerdict); a script that transfers only with the runtime pane on by
the runtime-on run, which the map keeps as changes against production
(runtimeOn.parity.changes) and runtime_on_verdicts() turns back into per-script verdicts.

Deterministic: no set or hash order reaches the output (runs under different PYTHONHASHSEED
values write the same bytes), and the file is written with LF endings.
"""
import argparse
import collections
import glob
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [HERE, os.path.dirname(HERE)]      # targets_waves, coverage_map (python -I adds neither)
import coverage_map as CM  # noqa: E402
from targets_waves import PROD_WAVE  # noqa: E402

PRODUCTION, RUNTIME_ON = CM.LANE_PRODUCTION, CM.LANE_RUNTIME_ON
HARNESS = os.path.join(CM.ROOT, "tests", "fixtures", "vendor", "harness")


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


def capture_source(path):
    """A capture's Pine source (the field coverage_map.main reads)."""
    p = path if os.path.isabs(path) else os.path.join(CM.ROOT, path)
    try:
        cap = json.load(open(p, encoding="utf-8"))
    except (OSError, ValueError) as e:
        sys.exit("capture %s cannot be read (%s): the runtime-on verdicts are joined through it" % (path, e))
    return (cap.get("source") or {}).get("text") or ""


def runtime_on_verdicts(d, source_of):
    """({script key: its vendor verdict in the RUNTIME-ON harness run},
        [(capture file, source) of each capture that MATCHes there but not in production]).

    The map keeps that run only as changes against production (runtimeOn.parity.changes:
    capture file, from, to). A script's verdict is coverage_map.script_verdict over its
    captures, so when every change moves UP that rule (INCONCLUSIVE -> DIVERGE or MATCH,
    DIVERGE -> MATCH) a script's runtime-on verdict is the rule over its production verdict
    plus the verdicts its changed captures moved to. A change that moves DOWN would need the
    per-capture production verdicts, which the map does not carry: refused, never guessed.

    Captures join scripts as in coverage_map.main (norm_src over the local sources), and the
    join is checked against the map first: the scripts it finds a capture for must be exactly
    the map's (scripts[].vendorVerdict), or the local sources are not the measured ones."""
    S = {s["key"]: s for s in d["scripts"]}
    by_norm = {CM.norm_src(source_of(s["key"])): s["key"] for s in d["scripts"]}
    caps = sorted(glob.glob(os.path.join(HARNESS, "*.json")))
    if len(caps) != d["parity"]["captures"]:
        sys.exit("%d captures in %s, the map graded %d: the fixtures changed since it was measured"
                 % (len(caps), HARNESS, d["parity"]["captures"]))
    found = {by_norm.get(CM.norm_src(src)) for src in map(capture_source, caps) if src} - {None}
    measured = {k for k, s in S.items() if s["vendorVerdict"]}
    if found != measured:
        sys.exit("the local sources do not join the captures as measured (only here: %s; only in the map: %s)"
                 % (sorted(found - measured)[:5], sorted(measured - found)[:5]))
    moved, newly_matching = collections.defaultdict(list), []
    for ch in d["runtimeOn"]["parity"]["changes"]:
        if CM.script_verdict([ch["from"], ch["to"]]) != ch["to"]:
            sys.exit("runtimeOn.parity.changes moves %s from %s down to %s: a script's runtime-on verdict "
                     "then needs the per-capture production verdicts, which coverage-map.json does not carry"
                     % (ch["file"], ch["from"], ch["to"]))
        src = capture_source(ch["file"])
        k = by_norm.get(CM.norm_src(src)) if src else None
        if k:
            moved[k].append(ch["to"])
        if ch["to"] == "MATCH":
            newly_matching.append((ch["file"], src))
    verdict = {k: CM.script_verdict([s["vendorVerdict"]] + moved[k]) if k in moved else s["vendorVerdict"]
               for k, s in S.items()}
    return verdict, newly_matching


def main():
    ap = argparse.ArgumentParser(description="W0 target lists over coverage-map.json (see the module docstring)")
    ap.add_argument("--map", required=True, help="coverage-map.json written by coverage_map.py")
    ap.add_argument("--census-input", required=True, help="census_input.json of the production census cache")
    ap.add_argument("--ref", required=True, help="the TradingView v6 reference JSON")
    ap.add_argument("--out", required=True, help="the targets JSON to write")
    ap.add_argument("--old-map", default=None, help="optional: the previous coverage-map.json, for the printed comparison")
    a = ap.parse_args()

    d = json.load(open(a.map, encoding="utf-8"))
    path_of = {i["key"]: i["path"] for i in json.load(open(a.census_input, encoding="utf-8"))}
    no_source = [s["key"] for s in d["scripts"] if s["key"] not in path_of]
    if no_source:
        sys.exit("--census-input has no source for %d sample scripts (first %s)" % (len(no_source), no_source[0]))
    inv = CM.Inventory(json.load(open(a.ref, encoding="utf-8")))
    S = {s["key"]: s for s in d["scripts"]}
    label_cap = {b["blocker"]: b["capability"] for b in d["blockers"]}
    sources = {}

    def source_of(k):
        if k not in sources:
            sources[k] = open(path_of[k], encoding="utf-8").read()
        return sources[k]

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
    host_dirty = []
    rtw = collections.defaultdict(lambda: {"blocks": [], "onlyThisWave": []})
    rt_sets = {}
    for k, ws in rt_by.items():
        for w in dict.fromkeys(ws):            # each wall once per script, in first-seen order
            rt_wall_scripts[w].append(k)
        wv = {rt_wave(w) for w in ws}
        if "[strategy]" in S[k]["walls"]:      # orders are never simulated: W9 always
            wv.add("W9")
        if not wv:                             # host attached, objects dropped / paint withheld
            host_dirty.append(k)
        wv = wv or {"W3"}                      # W3 owns that routing gap
        rt_sets[k] = wv
        for x in wv:
            rtw[x]["blocks"].append(k)
        if len(wv) == 1:
            rtw[next(iter(wv))]["onlyThisWave"].append(k)

    prod_sets = {s["key"]: {PROD_WAVE.get(label_cap.get(w, "?"), "?") for w in s["walls"]} for s in notclean}
    wave_greedy = {"production": greedy(prod_sets, sum(1 for s in d["scripts"] if s["clean"])),
                   "runtime-on": greedy(rt_sets, ro["transfer"])}
    print("wave greedy", json.dumps(wave_greedy))

    # ---- capture lists: every script judged in its own lane
    rt_verdict, newly_matching = runtime_on_verdicts(d, source_of)
    clean = {k for k, s in S.items() if s["clean"]}
    rt_set = (clean - set(ro["lost"])) | set(ro["added"])          # the runtime-on lane's transfers
    if len(rt_set) != ro["transfer"]:
        sys.exit("runtimeOn: %d transfers rebuilt from added/lost, the map says %d" % (len(rt_set), ro["transfer"]))
    either = clean | set(ro["added"])                              # transfers in at least one lane

    def lane(k):
        return PRODUCTION if k in clean else RUNTIME_ON

    own = {k: S[k]["vendorVerdict"] if k in clean else rt_verdict[k] for k in either}
    verified = {PRODUCTION: [k for k in S if k in clean and S[k]["vendorVerdict"] == "MATCH"],
                RUNTIME_ON: [k for k in S if k in rt_set and rt_verdict[k] == "MATCH"]}
    if len(verified[PRODUCTION]) != d["parity"]["verifiedTransfer"]:
        sys.exit("verified production transfers: %d here, %d in the map"
                 % (len(verified[PRODUCTION]), d["parity"]["verifiedTransfer"]))

    items = {i["name"]: i for i in d["inventory"]["items"]}
    unver = {n for n, i in items.items() if i["status"].startswith("supported-unverified")}

    def graded_unverified(src):
        return {n for n in CM.usage_of(src, inv)["items"] if n in unver and not n.startswith(CM.UNGRADED_PREFIXES)}

    # unverified item -> the captures that use it and MATCH only in the runtime-on run: that
    # grades the runtime lane's handling of the item, not the translator's
    rt_only = collections.defaultdict(list)
    for f, src in newly_matching:
        for n in graded_unverified(src):
            rt_only[n].append(os.path.splitext(os.path.basename(f))[0])
    uses = {k: graded_unverified(source_of(k)) for k in S if k in either}
    # a candidate has no MATCH in its own lane yet; a runtime-on row does not count an item that a
    # capture already MATCHes with in the runtime-on run (its capture would grade it there again)
    cands = [S[k] for k in S if k in either and own[k] != "MATCH"]
    gain = {s["key"]: uses[s["key"]] - (set(rt_only) if lane(s["key"]) == RUNTIME_ON else set()) for s in cands}
    covered, picks = set(), []
    while True:
        best = max(cands, key=lambda s: (len(gain[s["key"]] - covered), s.get("agreeCount") or 0), default=None)
        if not best or not (gain[best["key"]] - covered):
            break
        new = sorted(gain[best["key"]] - covered)
        covered |= set(new)
        picks.append({**brief(best["key"]), "lane": lane(best["key"]),
                      "existingCapture": own[best["key"]], "verifiesNewItems": new})
        cands = [s for s in cands if s["key"] != best["key"]]
    rest = sorted(unver - covered)
    graded_rest = [n for n in rest if not n.startswith(CM.UNGRADED_PREFIXES)]
    used_by = {n: [k for k in S if k in either and n in uses[k]] for n in graded_rest}
    not_covered = {
        "ungraded": [n for n in rest if n.startswith(CM.UNGRADED_PREFIXES)],
        "inNoTransferringScript": [n for n in graded_rest if not used_by[n]],
        "onlyInScriptsThatAlreadyMatch": {n: used_by[n] for n in graded_rest
                                          if used_by[n] and all(own[k] == "MATCH" for k in used_by[n])},
        "onlyInRuntimeOnTransfersAlreadyVerifiedThere": {n: used_by[n] for n in graded_rest
                                                  if used_by[n] and not all(own[k] == "MATCH" for k in used_by[n])},
    }
    regrade = sorted(({**brief(k), "lane": lane(k), "verdict": own[k]} for k in S
                      if k in either and own[k] in ("INCONCLUSIVE", "DIVERGE")), key=lambda c: c["lane"] != PRODUCTION)
    popular = sorted((S[k] for k in S if k in either and own[k] is None), key=lambda s: -(s.get("agreeCount") or 0))[:30]

    out = {
        "prodWalls": {w: sorted(v) for w, v in sorted(wall_scripts.items(), key=lambda kv: -len(kv[1]))},
        "prodWallCapability": label_cap,
        "prodWaves": {w: {k: sorted(v) for k, v in x.items()} for w, x in sorted(prod_wave.items())},
        "runtimeWalls": {w: sorted(v) for w, v in sorted(rt_wall_scripts.items(), key=lambda kv: (-len(kv[1]), kv[0]))},
        "runtimeWallWave": {w: rt_wave(w) for w in sorted(rt_wall_scripts)},
        "runtimeWaves": {w: {k: sorted(v) for k, v in x.items()} for w, x in sorted(rtw.items())},
        "waveGreedy": wave_greedy,
        "runtimeOnHostAttachedDirty": sorted(host_dirty),
        "verifiedByLane": {
            PRODUCTION: {"transfer": len(clean), "verified": verified[PRODUCTION]},
            RUNTIME_ON: {"transfer": len(rt_set), "verified": verified[RUNTIME_ON],
                         "verifiedOnlyInThisLane": [k for k in verified[RUNTIME_ON] if k not in verified[PRODUCTION]]},
        },
        "captureGreedy": picks,
        "captureRegradeTransferring": regrade,
        "capturePopularUncaptured": [brief(s["key"]) | {"lane": lane(s["key"])} for s in popular],
        "unverifiedItems": len(unver), "unverifiedItemsCoveredByGreedy": len(covered),
        "unverifiedItemsMatchingOnlyInRuntimeOn": {n: v for n, v in sorted(rt_only.items())},
        "unverifiedItemsNotCovered": not_covered,
        "titles": {k: (S[k].get("title") or k) for k in S},
    }
    with open(a.out, "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
        f.write("\n")
    print("prod waves", {w: (len(x["blocks"]), len(x["onlyThisWave"]), len(x["firm"])) for w, x in sorted(prod_wave.items())})
    print("rt waves", {w: (len(x["blocks"]), len(x["onlyThisWave"])) for w, x in sorted(rtw.items())})
    print("verified", {ln: "%d of %d" % (len(verified[ln]), n) for ln, n in ((PRODUCTION, len(clean)), (RUNTIME_ON, len(rt_set)))})
    print("captures greedy", len(picks), "covering", len(covered), "of", len(unver),
          "; matching only in the runtime-on run:", len(rt_only))
    if a.old_map:
        old = json.load(open(a.old_map, encoding="utf-8"))
        oh, nh = old["headline"], d["headline"]
        print("old", oh["transfer"], oh["attachedAnyForm"], old["runtimeOn"]["transfer"], old["parity"]["verdicts"],
              old["parity"]["verifiedTransfer"])
        print("new", nh["transfer"], nh["attachedAnyForm"], ro["transfer"], d["parity"]["verdicts"],
              d["parity"]["verifiedTransfer"])


if __name__ == "__main__":
    main()
