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
from api.services import host_known_divergence as hkd  # noqa: E402 -- the host lane's list, one reader
from api.services import rollout_gate as rg  # noqa: E402
from api.services import runtime_definitions as rt  # noqa: E402

sys.path.insert(0, os.path.join(ROOT, "tools", "vendor_harness"))
import evidence_ledger as el  # noqa: E402 -- LEDGER_ONLY evidence and its freshness rule: one authority
import licence_held  # noqa: E402 -- a licence-held capture is read from the local store (LICENSING.md 2d)


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
                    "script": r.get("script"), "path": licence_held.resolve(r["file"])})
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
        if head in ("array", "matrix", "map"):
            caps.add("collections:" + head)
        if head == "request":
            caps.add("request-other")
            # T4 E2: the chart's own corporate events (`pine_capabilities.EVENT_CALLS`)
            if i in pc.EVENT_CALLS:
                caps.add("request-events")
            # T4 F1b: the chart's own figures from company filings (`pine_capabilities.FINANCIAL_CALLS`)
            if i in pc.FINANCIAL_CALLS:
                caps.add("request-financial")
        if (head == "barstate" and last != "isfirst") or i == "timenow":
            caps.add("realtime-state")
    # T4 B2: a request beside a `USI:` string reads UCT breadth (`pine_capabilities.reads_breadth`)
    if "request-other" in caps and pc.reads_breadth(pc.strip_code(src)[1]):
        caps.add("request-breadth")
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


def admission_row(src, admitted):
    """One script's admission as the member door answers it: its capabilities, what is missing, and
    whether it is admitted. RT1: a script on the kill list is refused at every door, whatever its
    capabilities say (`runtime_definitions.runtime_admission` answers admitted False for it)."""
    caps = pc.capabilities_of(src)
    # the server's own rule (the generic `import` met by its libraries, U15), never restated here
    missing = rt.missing_capabilities(caps, set(admitted))
    killed = bool(rt.killed(None, src))
    return dict(hash=rt.source_hash(src), caps=sorted(caps), admitted=not missing and not killed,
                missing=missing, killed=killed)


def cmd_input(a):
    # the detector and the registry directly: the serving path's process-wide gate and cool-down
    # (final verify of #1204) answer "pending" between runs, which is right for a server, not a census
    admitted = set(rt.admitted_capabilities()["admitted"])
    rows = []
    for s in scripts_of(a.verdicts, a.cache):
        src = _capture_source(s["path"]) if s["path"].endswith(".json") else open(s["path"], encoding="utf-8").read()
        if not isinstance(src, str) or not src.strip():
            s.update(hash=None, caps=[], admitted=False, missing=["<no source>"])
        else:
            s.update(admission_row(src, admitted))
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


def ledger_runtime_evidence(inp, lanes, ledger_rows, verdict_ids, engine):
    """⭐ LEDGER_ONLY EVIDENCE for admission: a licence-held script's runtime-on MATCH, graded out of
    git and filed in the evidence ledger. Same rule as a committed capture, plus FRESHNESS
    (`evidence_ledger.classify`): the row counts only when it was graded at today's
    SCRIPT_ENGINE_VERSION (or superseded by a newer regrade that was), its source sha256 is the
    input script's own `hash`, the RUNTIME lane drew that script (`lanes`), and its runtime-on
    verdict is MATCH. A stale row or a sha mismatch is never evidence.
    Returns {input key: [(capture id, title, SCRIPT_ENGINE_VERSION it was graded at)]}."""
    samples = {k: {s["hash"]} for k, s in inp.items()
               if s.get("population") != "capture" and isinstance(s.get("hash"), str)}
    led = el.classify(ledger_rows, samples, engine=engine, lane="runtime-on", skip_captures=frozenset(verdict_ids))
    title = {r.get("captureId"): r.get("script") for r in ledger_rows}
    graded_at = {r.get("captureId"): r.get("scriptEngineVersion") for r in ledger_rows
                 if r.get("scriptEngineVersion") == engine}
    out = {}
    for key, e in led["byKey"].items():
        if lanes.get(key, {}).get("lane") != "runtime":
            continue
        # ⛔ L7: PROVEN-exact only. A MATCH_SUBSTITUTED row is never capability evidence (a substituted
        # script is admitted per script, on rollout_gate's separately named substituted path).
        hits = [(cid, title.get(cid), graded_at.get(cid))
                for cid, verdict in zip(e["captures"], e["verdicts"]) if el.is_match(verdict)]
        if hits:
            out[key] = hits
    return out


def library_pin(lane_row, cap):
    """⭐ libraries chain L1 (2026-11-19): {path, sha256} of the library version `cap` (`library:<Author>/<Lib>/<N>`)
    as the member door LINKED it for this script (the lanes measurement's `libraries`, the document's own
    `meta.libraries` pins), or None. `rollout_gate.pine_capability_admission` counts a library row's evidence ONLY
    when the entry names that path AND the sha the row pins, so evidence must say which code it graded; an entry
    whose library the door did not link (no store, a refused version) is no evidence for it and is dropped."""
    path = cap[len(pc.LIBRARY_PREFIX):]
    for pin in (lane_row or {}).get("libraries") or []:
        if isinstance(pin, dict) and pin.get("path") == path and isinstance(pin.get("sha256"), str):
            return {"path": path, "sha256": pin["sha256"].lower()}
    return None


def _evidence_entries(caps, lane_row, base):
    """One evidence entry per capability, a library capability carrying the pin it was graded with (or none)."""
    out = []
    for cap in caps:
        if pc.is_library_capability(cap):
            pin = library_pin(lane_row, cap)
            if pin is None:
                continue
            out.append((cap, dict(base, library=pin)))
        else:
            out.append((cap, dict(base)))
    return out


def cmd_evidence(a):
    inp = {s["key"]: s for s in json.load(open(a.input, encoding="utf-8"))["scripts"]}
    lanes = {r["key"]: r for r in json.load(open(a.lanes, encoding="utf-8"))["rows"]}
    v = _verdicts_by_id(a.verdicts)
    per = collections.defaultdict(list)
    # licence-held captures, graded out of git: fresh ledger rows only (see `ledger_runtime_evidence`)
    ledger_rows = el.read_rows(a.ledger) if a.ledger and os.path.exists(a.ledger) else []
    for key, hits in ledger_runtime_evidence(inp, lanes, ledger_rows, set(v), el.engine_version()).items():
        for cid, title, engine_at in hits:
            family, community = rg.pine_evidence_script(title, cid)
            # `ledger` + `scriptEngineVersion`: the registry rule re-asks freshness at every admission
            # (`rollout_gate._pine_capability_evidence_counts`), so an engine bump retires it
            base = {"capture": cid, "script": family, "community": community, "title": title,
                    "ledger": True, "scriptEngineVersion": engine_at}
            for cap, entry in _evidence_entries(inp[key]["caps"], lanes.get(key), base):
                per[cap].append(entry)
    for key, s in inp.items():
        if s["population"] != "capture":
            continue
        lane = lanes.get(key, {}).get("lane")
        verdict = v[s["capture"]]["verdict"]
        # ⛔ L7: a MATCH_SUBSTITUTED capture is never capability evidence (see `ledger_runtime_evidence`)
        if lane != "runtime" or not el.is_match(verdict):
            continue
        family, community = rg.pine_evidence_script(v[s["capture"]].get("script"), s["capture"])
        base = {"capture": s["capture"], "script": family, "community": community,
                "title": v[s["capture"]].get("script")}
        for cap, entry in _evidence_entries(s["caps"], lanes.get(key), base):
            per[cap].append(entry)
    out = {}
    for cap in sorted(pc.CAPABILITY_IDS | set(per)):
        ev = per.get(cap, [])
        out[cap] = {"captures": len({e["capture"] for e in ev}), "scripts": len({e["script"] for e in ev}),
                    "communityScripts": len({e["script"] for e in ev if e["community"]}),
                    "evidence": sorted(ev, key=lambda e: e["capture"])}
    json.dump(out, open(a.out, "w", encoding="utf-8"), indent=1) if a.out else None
    for cap, row in out.items():
        if row["captures"]:
            print("  %-18s %3d captures / %2d scripts / %2d community" % (cap, row["captures"], row["scripts"],
                                                                      row["communityScripts"]))
    # every runtime-drawn capture, with its verdict, for the STOP rule
    drawn = [(k, v[s["capture"]]["verdict"]) for k, s in inp.items()
             if s["population"] == "capture" and lanes.get(k, {}).get("lane") == "runtime"]
    print("runtime-drawn captures:", len(drawn), collections.Counter(x[1] for x in drawn))


#: The lanes a member door answers with when it draws; any other answer is a refusal by name.
DRAWN_LANES = ("runtime", "host")


def populations_of(rep):
    """⭐⭐ (2026-11-19, the e84 train's finding) THE POPULATION BLOCK, DERIVED FROM THE REPORT'S OWN ROWS, never kept
    by hand. ⚰️ It was written once per run and then edited by hand beside spliced rows: git merged two units'
    identical deltas to it as ONE (counted once), and after #1941's re-pins master's block was 4 rows off its own rows.
    Every admitted script has exactly one row: a `captures` row (population `capture`), or an `admittedUngraded` /
    `admittedGraded` row keyed `<population>:<name>`. `scripts` is the run's own population size
    (`populationSizes`); a rail holds `capture` and `committed` to the snapshot and the corpus they count.
    tests/test_pine_capability_admission.py (REACH) recomputes this from the rows and is red on any drift."""
    rows = {pop: [] for pop in rep.get("populationSizes", {})}
    rows.setdefault("capture", [])
    rows["capture"].extend(rep.get("captures") or [])
    for r in (rep.get("admittedUngraded") or []) + (rep.get("admittedGraded") or []):
        rows.setdefault(r["key"].split(":", 1)[0], []).append(r)
    out = {}
    for pop in sorted(rows, key=lambda p: ("capture", "committed", "reference", "builtin").index(p)
                      if p in ("capture", "committed", "reference", "builtin") else 9):
        rs = rows[pop]
        out[pop] = {"scripts": (rep.get("populationSizes") or {}).get(pop), "admitted": len(rs),
                    "runtimeLane": sum(1 for r in rs if r.get("lane") == "runtime"),
                    "hostLane": sum(1 for r in rs if r.get("lane") == "host"),
                    "refused": sum(1 for r in rs if r.get("lane") not in DRAWN_LANES),
                    "coreOnly": sum(1 for r in rs if r.get("caps") == [pc.CORE_ID])}
    return out


def cmd_report(a):
    inp = json.load(open(a.input, encoding="utf-8"))["scripts"]
    door = {r["key"]: r for r in json.load(open(a.door, encoding="utf-8"))["rows"]}
    rton = _verdicts_by_id(a.verdicts)
    prod = _verdicts_by_id(a.prod_verdicts)
    # THE RULE (coordinator ruling 2026-11-13): no capture drawn by the RUNTIME lane under admission
    # may DIVERGE, and no capture may move MATCH -> DIVERGE (production -> runtime-on). A host-drawn
    # DIVERGE is the production picture unchanged; it is listed, not a stop.
    # ⭐ 2026-11-17 (owner decision): a host-drawn DIVERGE whose script is on the HOST known-divergence list
    # (`api/services/host_known_divergence.py`) is not drawn for members any more: it is refused by name
    # (`pine:known-divergence`) at every host door, and is listed under `refusedByName`, not `hostDiverge`.
    listed = hkd.committed()
    rep = {"populations": {}, "populationSizes": {}, "captures": [], "admittedUngraded": [], "admittedGraded": [],
           "stops": [], "hostDiverge": [], "refusedByName": [], "matchToDiverge": [], "substitutedToDiverge": []}
    for pop in ("capture", "committed", "reference", "builtin"):
        rep["populationSizes"][pop] = sum(1 for s in inp if s["population"] == pop)
        # ⛔ a refusal is a door that did not draw: one rule (`DRAWN_LANES`), held to the door's own `ok` here
        adm = [s for s in inp if s["population"] == pop and s["admitted"]]
        not_ok = sum(1 for s in adm if not door.get(s["key"], {}).get("ok"))
        undrawn = sum(1 for s in adm if door.get(s["key"], {}).get("lane") not in DRAWN_LANES)
        if not_ok != undrawn:
            raise SystemExit(f"report: {pop}: {not_ok} door refusals but {undrawn} rows with no drawing lane")
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
                if d.get("lane") == "runtime":
                    rep["stops"].append(row)
                elif s.get("hash") in listed:
                    rep["refusedByName"].append(dict(row, guard=hkd.GUARD, slug=listed[s["hash"]].get("slug")))
                else:
                    rep["hostDiverge"].append(row)
            if off == "MATCH" and on == "DIVERGE":
                rep["matchToDiverge"].append(row)
            # ⭐ L7 — the same regression from the substituted bucket, named apart (never folded into MATCH)
            if off == el.MATCH_SUBSTITUTED and on == "DIVERGE":
                rep["substitutedToDiverge"].append(row)
        elif s["hash"] not in graded_hashes:
            rep["admittedUngraded"].append({"key": s["key"], "lane": d.get("lane"), "guard": d.get("guard"),
                                            "declined": d.get("declined"), "caps": s["caps"]})
        else:
            # ⭐ an admitted script whose source a capture grades: its own row, so the block counts it from the rows
            rep["admittedGraded"].append({"key": s["key"], "lane": d.get("lane"), "caps": s["caps"]})
    rep["populations"] = populations_of(rep)
    json.dump(rep, open(a.out, "w", encoding="utf-8"), indent=1) if a.out else None
    print(json.dumps(rep["populations"], indent=1))
    print("admitted captures:", collections.Counter((c["lane"], c["runtimeOn"]) for c in rep["captures"]))
    print("STOPS (runtime-lane capture DIVERGEs):", [c["capture"] for c in rep["stops"]])
    print("host-drawn DIVERGE (production picture):", [c["capture"] for c in rep["hostDiverge"]])
    print("refused by name (host known-divergence list):", [c["capture"] for c in rep["refusedByName"]])
    print("MATCH->DIVERGE:", [c["capture"] for c in rep["matchToDiverge"]])
    print("MATCH_SUBSTITUTED->DIVERGE:", [c["capture"] for c in rep["substitutedToDiverge"]])
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
    e.add_argument("--ledger", default=str(el.LEDGER),
                   help="LEDGER_ONLY evidence (licence-held captures graded out of git); fresh rows count")
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
