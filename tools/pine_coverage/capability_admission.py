# -*- coding: utf-8 -*-
"""capability_admission.py - WS-I Part 2 (2026-11-13): the measurement behind admission by capability.

Three steps (docs/pine/evidence/2026-11-13-capability-admission/EVIDENCE.md says which SHA ran which):

  1. input     the scripts to ask the member door about, with each one's capabilities
               (api/services/pine_capabilities.py) and whether the server ADMITS it
               (runtime_definitions.capability_admitted, against the committed registry):
                 python tools/pine_coverage/capability_admission.py input \
                     --verdicts docs/pine/vendor-harness/runtime-on/verdicts.json \
                     [--cache <coverage census cache dir>] --out <in.json>
  2. the member door, in node (app/.../vendorHarness/capabilityAdmission.measure.test.js):
               CAPADMIT_MODE=lanes     -> which captures the RUNTIME lane draws (evidence)
               CAPADMIT_MODE=admission -> which admitted scripts reach a runtime-lane picture
  3. evidence  per capability: the runtime-on MATCH captures the run drew that use it
                 python tools/pine_coverage/capability_admission.py evidence \
                     --input <in.json> --lanes <lanes.json> --verdicts <runtime-on verdicts.json>
     report    the admitted scripts, their reach and their verdicts in both lanes
                 python tools/pine_coverage/capability_admission.py report \
                     --input <in.json> --door <admission.json> \
                     --verdicts <runtime-on verdicts.json> --prod-verdicts <production verdicts.json>

  census     the A6 snapshot: per script sha256, the capabilities the COVERAGE CENSUS sees
             (coverage_map.usage_of over TradingView's reference inventory, mapped to capability
             ids by `census_capabilities`, independently of the detector's own regexes):
                 python tools/pine_coverage/capability_admission.py census --ref <pine reference.json>                      --verdicts docs/pine/vendor-harness/runtime-on/verdicts.json --cache <cache> --out <json>
             tests/test_pine_capabilities.py holds `capabilities_of` to it: never fewer.

The census cache (reference + builtin sources) is LOCAL ONLY and never committed; only hashes,
keys and counts leave this tool.
"""
import argparse
import collections
import glob
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from api.services import pine_capabilities as pc  # noqa: E402
from api.services import runtime_definitions as rt  # noqa: E402


def _capture_source(path):
    try:
        d = json.load(open(path, encoding="utf-8"))
    except (OSError, ValueError):
        return None
    src = d.get("source") if isinstance(d, dict) else None
    return src.get("text") if isinstance(src, dict) else None


def scripts_of(verdicts, cache):
    out = []
    for r in json.load(open(verdicts, encoding="utf-8"))["results"]:
        out.append({"key": "capture:" + r["id"], "population": "capture", "capture": r["id"],
                    "script": r.get("script"), "path": os.path.join(ROOT, r["file"])})
    pops = [("committed", glob.glob(os.path.join(ROOT, "corpus", "committed", "*.pine")))]
    if cache:
        pops += [("reference", glob.glob(os.path.join(cache, "reference", "*.pine"))),
                 ("builtin", glob.glob(os.path.join(cache, "builtin", "*.pine")))]
    for pop, files in pops:
        for f in sorted(files):
            out.append({"key": "%s:%s" % (pop, os.path.basename(f)[:-5]), "population": pop, "path": f})
    return out


def census_capabilities(src, inv):
    """The capability ids the coverage census sees in one script: its FEATURES, and the object /
    request / live-state ids read off the reference INVENTORY items `usage_of` resolves (with
    method calls resolved to their namespaces), not off the detector's regexes."""
    import coverage_map as cm  # noqa: E402  (tools/pine_coverage on sys.path, below)
    u = cm.usage_of(src, inv)
    fams = set(pc.OBJECT_FAMILIES)
    caps = {pc.CORE_ID} | set(u["features"])
    for i in u["items"]:
        parts = i.split(".")
        head, last = parts[0], parts[-1]
        if head in fams:
            caps.add("obj:" + head)
            if last == "delete":
                caps.add("obj:delete")
            if last.startswith("get_"):
                caps.add("obj:getter")
            if last == "all":
                caps.add("obj:collection")
        if head == "array" and last.startswith("new_") and last[4:] in fams:
            caps |= {"obj:" + last[4:], "obj:collection"}
        if head == "request":
            caps.add("request-other")
        if (head == "barstate" and last != "isfirst") or i == "timenow":
            caps.add("realtime-state")
    return caps


def cmd_census(a):
    sys.path.insert(0, os.path.join(ROOT, "tools", "pine_coverage"))
    import coverage_map as cm  # noqa: E402
    inv = cm.Inventory(json.load(open(a.ref, encoding="utf-8")))
    snap, pops = {}, collections.Counter()
    for s in scripts_of(a.verdicts, a.cache):
        src = _capture_source(s["path"]) if s["path"].endswith(".json") else open(s["path"], encoding="utf-8").read()
        if not isinstance(src, str) or not src.strip():
            continue
        h = rt.source_hash(src)
        pops[s["population"]] += 1
        if h not in snap:
            snap[h] = sorted(census_capabilities(src, inv))
    out = {"_readme": ["WS-I Part 2 (2026-11-13), A6: per Pine source sha256, the capability ids the coverage census",
                       "sees (tools/pine_coverage/capability_admission.py::census_capabilities over coverage_map.usage_of",
                       "and the TradingView v6 reference inventory). api/services/pine_capabilities.py::capabilities_of",
                       "must declare at least these for every script (tests/test_pine_capabilities.py). Hashes only: the",
                       "reference and builtin sources are a local cache and are never committed."],
           "populations": dict(sorted(pops.items())), "distinct": len(snap), "census": dict(sorted(snap.items()))}
    with open(a.out, "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, indent=0, separators=(",", ":"))
        f.write("\n")
    print("census snapshot:", dict(pops), "distinct sources", len(snap))


def cmd_input(a):
    os.environ[rt.CAPABILITY_ADMISSION_ENV] = rt.CAPABILITY_ADMISSION_ON
    rows = []
    for s in scripts_of(a.verdicts, a.cache):
        src = _capture_source(s["path"]) if s["path"].endswith(".json") else open(s["path"], encoding="utf-8").read()
        if not isinstance(src, str) or not src.strip():
            s.update(hash=None, caps=[], admitted=False, missing=["<no source>"])
        else:
            ok, missing = rt.capability_admitted(src)
            s.update(hash=rt.source_hash(src), caps=sorted(pc.capabilities_of(src)), admitted=bool(ok),
                     missing=missing, notGraded=rt.not_graded(src) is not None)
        rows.append(s)
    reg = rt.admitted_capabilities()
    json.dump({"admittedCapabilities": reg["admitted"], "scripts": rows},
              open(a.out, "w", encoding="utf-8"), indent=1)
    c = collections.Counter((r["population"], r["admitted"]) for r in rows)
    print("admitted capabilities:", reg["admitted"])
    for pop in ("capture", "committed", "reference", "builtin"):
        print("  %-10s admitted %4d of %4d" % (pop, c[(pop, True)], c[(pop, True)] + c[(pop, False)]))


def _verdicts_by_id(path):
    return {r["id"]: r for r in json.load(open(path, encoding="utf-8"))["results"]}


def cmd_evidence(a):
    inp = {s["key"]: s for s in json.load(open(a.input, encoding="utf-8"))["scripts"]}
    lanes = {r["key"]: r for r in json.load(open(a.lanes, encoding="utf-8"))["rows"]}
    v = _verdicts_by_id(a.verdicts)
    per = collections.defaultdict(list)
    for key, s in inp.items():
        if s["population"] != "capture":
            continue
        lane = lanes.get(key, {}).get("lane")
        verdict = v[s["capture"]]["verdict"]
        if lane != "runtime" or verdict != "MATCH":
            continue
        for cap in s["caps"]:
            per[cap].append({"capture": s["capture"], "script": v[s["capture"]].get("script")})
    out = {}
    for cap in sorted(pc.CAPABILITY_IDS | set(per)):
        ev = per.get(cap, [])
        out[cap] = {"captures": len({e["capture"] for e in ev}), "scripts": len({e["script"] for e in ev}),
                    "evidence": sorted(ev, key=lambda e: e["capture"])}
    json.dump(out, open(a.out, "w", encoding="utf-8"), indent=1) if a.out else None
    for cap, row in out.items():
        if row["captures"]:
            print("  %-18s %3d captures / %2d scripts" % (cap, row["captures"], row["scripts"]))
    # every runtime-drawn capture, with its verdict, for the STOP rule
    drawn = [(k, v[s["capture"]]["verdict"]) for k, s in inp.items()
             if s["population"] == "capture" and lanes.get(k, {}).get("lane") == "runtime"]
    print("runtime-drawn captures:", len(drawn), collections.Counter(x[1] for x in drawn))


def cmd_report(a):
    inp = json.load(open(a.input, encoding="utf-8"))["scripts"]
    door = {r["key"]: r for r in json.load(open(a.door, encoding="utf-8"))["rows"]}
    rton = _verdicts_by_id(a.verdicts)
    prod = _verdicts_by_id(a.prod_verdicts)
    # THE RULE (coordinator ruling 2026-11-13): no capture drawn by the RUNTIME lane under admission
    # may DIVERGE, and no capture may move MATCH -> DIVERGE (production -> runtime-on). A host-drawn
    # DIVERGE is the production picture unchanged; it is listed, not a stop.
    rep = {"populations": {}, "captures": [], "admittedUngraded": [], "stops": [], "hostDiverge": [],
           "matchToDiverge": []}
    for pop in ("capture", "committed", "reference", "builtin"):
        rows = [s for s in inp if s["population"] == pop]
        adm = [s for s in rows if s["admitted"]]
        reach = [s for s in adm if door.get(s["key"], {}).get("lane") == "runtime"]
        host = [s for s in adm if door.get(s["key"], {}).get("lane") == "host"]
        refused = [s for s in adm if not door.get(s["key"], {}).get("ok")]
        rep["populations"][pop] = {"scripts": len(rows), "admitted": len(adm), "runtimeLane": len(reach),
                                   "hostLane": len(host), "refused": len(refused),
                                   "coreOnly": sum(1 for s in adm if s["caps"] == [pc.CORE_ID])}
    graded_hashes = {s["hash"] for s in inp if s["population"] == "capture"}
    for s in inp:
        if not s["admitted"]:
            continue
        d = door.get(s["key"], {})
        if s["population"] == "capture":
            on, off = rton[s["capture"]]["verdict"], prod[s["capture"]]["verdict"] if s["capture"] in prod else None
            row = {"capture": s["capture"], "lane": d.get("lane"), "runtimeOn": on, "production": off,
                   "caps": s["caps"]}
            rep["captures"].append(row)
            if on == "DIVERGE":
                rep["stops" if d.get("lane") == "runtime" else "hostDiverge"].append(row)
            if off == "MATCH" and on == "DIVERGE":
                rep["matchToDiverge"].append(row)
        elif s["hash"] not in graded_hashes:
            rep["admittedUngraded"].append({"key": s["key"], "lane": d.get("lane"), "guard": d.get("guard"),
                                            "declined": d.get("declined"), "caps": s["caps"]})
    json.dump(rep, open(a.out, "w", encoding="utf-8"), indent=1) if a.out else None
    print(json.dumps(rep["populations"], indent=1))
    print("admitted captures:", collections.Counter((c["lane"], c["runtimeOn"]) for c in rep["captures"]))
    print("STOPS (runtime-lane capture DIVERGEs):", [c["capture"] for c in rep["stops"]])
    print("host-drawn DIVERGE (production picture):", [c["capture"] for c in rep["hostDiverge"]])
    print("MATCH->DIVERGE:", [c["capture"] for c in rep["matchToDiverge"]])
    print("admitted, ungraded:", len(rep["admittedUngraded"]),
          collections.Counter(r["lane"] for r in rep["admittedUngraded"]))


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    i = sub.add_parser("input")
    i.add_argument("--verdicts", required=True)
    i.add_argument("--cache")
    i.add_argument("--out", required=True)
    e = sub.add_parser("evidence")
    e.add_argument("--input", required=True)
    e.add_argument("--lanes", required=True)
    e.add_argument("--verdicts", required=True)
    e.add_argument("--out")
    r = sub.add_parser("report")
    r.add_argument("--input", required=True)
    r.add_argument("--door", required=True)
    r.add_argument("--verdicts", required=True)
    r.add_argument("--prod-verdicts", required=True)
    r.add_argument("--out")
    c = sub.add_parser("census")
    c.add_argument("--ref", required=True)
    c.add_argument("--verdicts", required=True)
    c.add_argument("--cache")
    c.add_argument("--out", required=True)
    a = p.parse_args()
    {"input": cmd_input, "evidence": cmd_evidence, "report": cmd_report, "census": cmd_census}[a.cmd](a)


if __name__ == "__main__":
    main()
