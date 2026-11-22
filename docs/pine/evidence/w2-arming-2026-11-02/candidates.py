#!/usr/bin/env python3
"""W2 arming packet (2026-11-02): the stage-1 allowlist candidates and the capability-evidence matrix.

    python docs/pine/evidence/w2-arming-2026-11-02/candidates.py [--readiness R.json] [--probe P.json]
        [--probe-x4 P4.json] [--out docs/pine/evidence/w2-arming-2026-11-02/stage1-candidates.json]

Reads only COMMITTED inputs (and the optional measurement files named above):

  * ``harness-lane-diff.json``  the vendor harness run twice on one tree (production lane,
    runtime-on lane); a capture whose verdict is MATCH with the runtime pane on and was NOT
    MATCH with it off was drawn BY THE RUNTIME LANE (the host lane answered otherwise), so
    those rows are the only runtime-lane evidence there is;
  * ``tests/fixtures/vendor/harness/<id>.json``  each capture's source text, checked against
    its recorded sha256;
  * ``corpus/committed/*.pine``  the committed script sources, and
    ``tools/visual_conformance/probes/*.pine``  the programme's own witness scripts (the probes
    pasted into TradingView); a script is matched to either by source sha256;
  * ``api/data/pine_runtime_allowlist.json``  the committed registry.

For every script that has a runtime-lane MATCH capture it records: the census capabilities
(``tools/pine_coverage/coverage_map.py::FEATURES``, the one authority), the R1 admission
reasons (``api/services/rollout_gate.py::pine_runtime_admission``, the real function: it is
lifted out of that file by AST, so nothing from the fastapi/auth import chain is loaded and
no ``/data`` path can be touched), and the verdicts of every capture of the same script.
It then states, per capability row, which runtime-lane MATCH scripts use it.

⛔ Script TEXT is never written out: names, slugs, ids, hashes (12 hex) and counts only.
Nothing here runs the engine, opens a database or touches the network.
"""
from __future__ import annotations

import argparse
import ast
import hashlib
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
sys.path.insert(0, ROOT)

from tools.pine_coverage import coverage_map as cm  # noqa: E402

HARNESS = os.path.join(ROOT, "tests", "fixtures", "vendor", "harness")
CORPUS = os.path.join(ROOT, "corpus", "committed")
PROBES = os.path.join(ROOT, "tools", "visual_conformance", "probes")
ALLOWLIST = os.path.join(ROOT, "api", "data", "pine_runtime_allowlist.json")
LANE_DIFF = os.path.join(HERE, "harness-lane-diff.json")
ROLLOUT_GATE = os.path.join(ROOT, "api", "services", "rollout_gate.py")
_ADMISSION_CONSTANTS = {"PINE_CAPABILITY_CONFORMANT", "PINE_CAPTURE_MATCH", "PINE_CAPTURE_PANE_ON"}


def read_json(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def sha256_text(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def real_admission():
    """``rollout_gate.pine_runtime_admission`` and its three constants, lifted by AST."""
    with open(ROLLOUT_GATE, encoding="utf-8") as fh:
        tree = ast.parse(fh.read())
    keep = []
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(
                isinstance(t, ast.Name) and t.id in _ADMISSION_CONSTANTS for t in node.targets):
            keep.append(node)
        elif isinstance(node, ast.FunctionDef) and node.name == "pine_runtime_admission":
            keep.append(node)
    if len(keep) != len(_ADMISSION_CONSTANTS) + 1:
        raise SystemExit("rollout_gate.py no longer has the shape this tool lifts")
    ns = {}
    exec(compile(ast.Module(body=keep, type_ignores=[]), "rollout_gate.py(AST)", "exec"), ns)  # noqa: S102
    return ns["pine_runtime_admission"]


def capture_head_hash(file):
    """The capture's own ``source.sha256``, found without parsing the (large) JSON."""
    with open(os.path.join(HARNESS, file), "rb") as fh:
        head = fh.read(900000).decode("utf-8", "replace")
    i = head.find('"source"')
    m = re.search(r'"sha256"\s*:\s*"([0-9a-f]{64})"', head[i:]) if i >= 0 else None
    return m.group(1) if m else None


def census_capabilities(source):
    code, _ = cm.strip_code(source)
    return sorted(fid for fid, _l, rx, fl in cm.FEATURES if re.search(rx, code, fl))


def corpus_by_hash():
    out = {}
    for f in sorted(os.listdir(CORPUS)):
        if f.endswith(".pine"):
            with open(os.path.join(CORPUS, f), encoding="utf-8") as fh:  # universal newlines, as the rails read it
                out[sha256_text(fh.read())] = f
    return out


def probes_by_hash():
    """The programme's own witness scripts (the probes pasted into TradingView), by source sha256."""
    out = {}
    for f in sorted(os.listdir(PROBES)):
        if f.endswith(".pine"):
            with open(os.path.join(PROBES, f), encoding="utf-8") as fh:
                out[sha256_text(fh.read())] = f
    return out


def slug_of(corpus_file, capture_id):
    if corpus_file:
        return corpus_file.split("__")[0]
    return re.sub(r"-(?:rddt|spy|aapl|brk-a|eurusd|btcusd|xlk|a)-[0-9a-z]+-20\d\d-\d\d-\d\d(?:-[a-z]+)?$", "", capture_id)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    ap.add_argument("--readiness")
    ap.add_argument("--probe")
    ap.add_argument("--probe-x4")
    ap.add_argument("--out", default=os.path.join(HERE, "stage1-candidates.json"))
    args = ap.parse_args(argv)

    diff = read_json(LANE_DIFF)
    registry = read_json(ALLOWLIST)["capabilities"]
    admission = real_admission()
    corpus = corpus_by_hash()
    probes = probes_by_hash()

    # captures by script identity (the capture's own recorded source hash)
    rows = {r["file"]: r for r in diff["all"]}
    by_hash = {}
    for file, row in sorted(rows.items()):
        h = capture_head_hash(file)
        if h:
            by_hash.setdefault(h, []).append(row)

    def lane(row):
        """runtime = drawn by the runtime lane (the pane-off run did not already grade it)."""
        if row["runtimeOn"] == "MATCH" and row["production"] != "MATCH":
            return "runtime-MATCH"
        if row["runtimeOn"] == "DIVERGE" and row["production"] != "DIVERGE":
            return "runtime-DIVERGE"
        return "other"

    pool = []
    for h, caps_rows in sorted(by_hash.items()):
        if not any(lane(r) == "runtime-MATCH" for r in caps_rows):
            continue
        first_match = next(r for r in caps_rows if lane(r) == "runtime-MATCH")
        with open(os.path.join(HARNESS, first_match["file"]), encoding="utf-8") as fh:
            cap = json.load(fh)
        text = cap["source"]["text"]
        if sha256_text(text) != cap["source"]["sha256"] or cap["source"]["sha256"] != h:
            raise SystemExit(f"{first_match['file']}: source text does not hash to its recorded sha256")
        corpus_file = corpus.get(h)
        probe_file = probes.get(h)
        slug = slug_of(corpus_file, first_match["file"][:-5])
        caps = census_capabilities(text)
        matches = [{"id": r["file"][:-5], "production": r["production"], "runtimeOn": r["runtimeOn"],
                    "lane": lane(r)} for r in caps_rows]
        reasons = admission(
            {"capabilities": caps, "captures": [
                {"id": m["id"], "verdict": "MATCH", "runtimePane": "on"} for m in matches if m["lane"] == "runtime-MATCH"]},
            registry)
        pool.append({
            "slug": slug,
            "sha256": h,
            "source": (f"corpus/committed/{corpus_file}" if corpus_file
                       else f"tools/visual_conformance/probes/{probe_file}" if probe_file
                       else "capture source only (no committed .pine file hashes to it)"),
            "kind": "corpus" if corpus_file else "probe" if probe_file else "capture-only",
            "captures": matches,
            "runtimeMatchCaptures": sum(1 for m in matches if m["lane"] == "runtime-MATCH"),
            "runtimeDivergeCaptures": sum(1 for m in matches if m["lane"] == "runtime-DIVERGE"),
            "capabilities": caps,
            "r1Reasons": reasons,
            "r1Clean": not reasons,
            "divergentCapabilities": [c for c in caps if (registry.get(c) or {}).get("status") == "divergent"],
            "capabilitiesWithoutARow": [c for c in caps if c not in registry],
        })

    # the runtime-lane DIVERGE captures of scripts with NO runtime-lane MATCH (listed for the withheld table)
    diverge_only = []
    for h, caps_rows in sorted(by_hash.items()):
        if any(lane(r) == "runtime-MATCH" for r in caps_rows):
            continue
        d = [r for r in caps_rows if lane(r) == "runtime-DIVERGE"]
        if d:
            with open(os.path.join(HARNESS, d[0]["file"]), encoding="utf-8") as fh:
                dcaps = census_capabilities(json.load(fh)["source"]["text"])
            diverge_only.append({
                "sha256": h,
                "source": (f"corpus/committed/{corpus[h]}" if h in corpus
                           else f"tools/visual_conformance/probes/{probes[h]}" if h in probes else None),
                "slug": slug_of(corpus.get(h), d[0]["file"][:-5]),
                "capabilities": dcaps,
                "capabilitiesWithoutARow": [c for c in dcaps if c not in registry],
                "divergentCapabilities": [c for c in dcaps if (registry.get(c) or {}).get("status") == "divergent"],
                "captures": [{"id": r["file"][:-5], "runtimeOn": r["runtimeOn"],
                              "reason": r["reasonRuntimeOn"]} for r in d]})

    # capability matrix: per census capability, who uses it among the runtime-lane MATCH scripts
    conformant = {c for c, v in registry.items() if v.get("status") == "conformant"}
    matrix = {}
    for entry in pool:
        for c in entry["capabilities"]:
            slot = matrix.setdefault(c, {"registry": (registry.get(c) or {}).get("status", "no row"),
                                         "usedByRuntimeMatchScripts": [], "isolating": [], "alsoInADivergingScript": [],
                                         "runtimeMatchCaptures": [], "isolatingCaptures": []})
            match_ids = [m["id"] for m in entry["captures"] if m["lane"] == "runtime-MATCH"]
            slot["usedByRuntimeMatchScripts"].append(entry["slug"])
            slot["runtimeMatchCaptures"].extend(match_ids)
            if set(entry["capabilities"]) <= conformant | {c}:
                # isolating: every OTHER capability this script uses is already conformant, so its
                # MATCH can only be about this one
                slot["isolating"].append(entry["slug"])
                slot["isolatingCaptures"].extend(match_ids)
            if entry["runtimeDivergeCaptures"]:
                slot["alsoInADivergingScript"].append(entry["slug"])
    for slot in matrix.values():
        for k in ("usedByRuntimeMatchScripts", "isolating", "alsoInADivergingScript",
                  "runtimeMatchCaptures", "isolatingCaptures"):
            slot[k] = sorted(set(slot[k]))

    out = {
        "generatedBy": "docs/pine/evidence/w2-arming-2026-11-02/candidates.py",
        "inputs": {
            "laneDiff": "docs/pine/evidence/w2-arming-2026-11-02/harness-lane-diff.json",
            "registry": "api/data/pine_runtime_allowlist.json (capabilities{})",
            "census": "tools/pine_coverage/coverage_map.py::FEATURES",
            "admission": "api/services/rollout_gate.py::pine_runtime_admission (lifted by AST)",
        },
        "registry": {c: v.get("status") for c, v in sorted(registry.items())},
        "runtimeLaneMatchScripts": pool,
        "runtimeLaneDivergeOnlyScripts": diverge_only,
        "capabilityMatrix": dict(sorted(matrix.items())),
    }
    for flag, key in (("readiness", "readiness"), ("probe", "probe"), ("probe_x4", "probeX4")):
        path = getattr(args, flag)
        if path:
            out.setdefault("measurementInputs", {})[key] = os.path.basename(path)
    if args.readiness:
        ready = {s["slug"]: s for s in read_json(args.readiness)["scripts"]}
        for entry in pool:
            r = ready.get(entry["slug"])
            if r:
                entry["readiness"] = {
                    "doorWarmMedianMs": r["doorWarmMedianMs"],
                    "runs": [{"length": x["length"], "medianMs": x["medianMs"], "maxMs": x["maxMs"],
                              "error": (x["error"] or {}).get("guard") if x.get("error") else None} for x in r["runs"]],
                    "budget": r["budget"],
                }
    for flag, key in (("probe", "desktop"), ("probe_x4", "x4")):
        path = getattr(args, flag)
        if not path:
            continue
        probe = read_json(path)
        low = probe.get("lowEnd") or {}
        src = probe if key == "desktop" else low
        out.setdefault("probeRuns", {})[key] = {
            "file": os.path.basename(path), "verdict": src.get("verdict", probe.get("verdict")),
            "workerBytes": probe.get("workerBytes"), "options": probe.get("options"),
            "worstMainFrameGapMs": probe.get("worstMainFrameGapMs") if key == "desktop" else None,
            "instrumentControl": probe.get("control") if key == "desktop" else low.get("control"),
        }
        summ = {(r["slug"], r["length"]): r for r in src.get("summary", [])}
        ticks = {c["slug"]: c for c in src.get("checkpoint", [])}
        for entry in pool:
            row = summ.get((entry["slug"], "D 5000"))
            tick = ticks.get(entry["slug"])
            if row is None and tick is None:
                continue
            entry.setdefault("probe", {})[key] = {
                "D5000": {k: row[k] for k in ("n", "coldMs", "p50Ms", "p95Ms", "answers", "withinBudget")} if row else None,
                "b5Tick": {k: tick[k] for k in ("fullMs", "fullAnswer", "ticks", "tickP50Ms", "tickP95Ms", "tickMaxMs",
                                                "answers")} if tick else None,
            }
    with open(args.out, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps(out, indent=1, sort_keys=True) + "\n")
    print(f"wrote {os.path.relpath(args.out, ROOT)}: {len(pool)} scripts with a runtime-lane MATCH, "
          f"{sum(1 for e in pool if e['r1Clean'])} R1-clean")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
