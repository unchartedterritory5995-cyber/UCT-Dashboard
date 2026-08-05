#!/usr/bin/env python3
"""B5 Task 11's mutation gauntlet — with the two controls that make it mean anything.

A mutation harness that never starts scores a perfect KILLED. This one therefore
refuses to report anything without:

  **CONTROL A** — the UNMUTATED suite, run first, ANSI-stripped, and aborted on a
  zero passed-count. A runner that cannot run makes every subsequent `rc=1` a
  claim about nothing.
  **CONTROL B** — the same `-t` filter each mutation is judged under, run
  UNMUTATED, asserting a NONZERO passed count. ⚠️ B5 Task 10 measured that this is
  NECESSARY BUT NOT SUFFICIENT: its M15 filter selected a case the mutation could
  not reach and Control B reported `passed=1` throughout. So this harness also
  records WHICH test failed for each kill, and a kill whose failing test is not
  one the mutation could plausibly reach is reported as SUSPECT, not KILLED.

Verdicts come from the EXIT CODE, never from grepping output for the word FAIL.

    python tools/flipc_mutation_gauntlet.py            # all
    python tools/flipc_mutation_gauntlet.py --only M3
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"
RECORD = "docs/decisions/2026-08-04-flip-c-pane-geometry.md"
RECORD_TEST = "src/components/chart/engine/__tests__/flipCRecord.test.js"
CASES = "tools/chart_parity_cases.json"
HARNESS_TEST = "tests/test_chart_parity_harness.py"

ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")


def strip(s: str) -> str:
    return ANSI.sub("", s)


# ── runners ──────────────────────────────────────────────────────────────────

def run_vitest(path, tfilter=None):
    cmd = ["npx", "vitest", "run", path]
    if tfilter:
        cmd += ["-t", tfilter]
    # WARNING: `encoding=` IS NOT OPTIONAL ON THIS BOX. Without it Python decodes
    # the child's output as cp1252, a single box-drawing character from vitest
    # raises UnicodeDecodeError INSIDE the reader thread, stdout comes back None
    # and the verdict is a TypeError rather than a result. B5 Task 6 and Task 10
    # both lost time to this exact trap; PYTHONIOENCODING covers the SUBPROCESS,
    # not the parent's decode of it.
    p = subprocess.run(cmd, cwd=APP, capture_output=True, text=True,
                       encoding="utf-8", errors="replace", shell=True)
    out = strip(p.stdout + p.stderr)
    m = re.search(r"Tests\s+(?:(\d+) failed\s*\|\s*)?(\d+) passed", out)
    failed = int(m.group(1)) if (m and m.group(1)) else 0
    passed = int(m.group(2)) if m else None
    if passed is None and re.search(r"No test files found|no tests", out, re.I):
        passed = 0
    names = re.findall(r"FAIL\s+\S+\s*>\s*(.+)", out)
    return {"rc": p.returncode, "passed": passed, "failed": failed,
            "failing": [n.strip() for n in names], "out": out}


def run_pytest(path, kfilter=None):
    cmd = [sys.executable, "-m", "pytest", path, "-q"]
    if kfilter:
        cmd += ["-k", kfilter]
    p = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    out = strip(p.stdout + p.stderr)
    m = re.search(r"(?:(\d+) failed,\s*)?(\d+) passed", out)
    failed = int(m.group(1)) if (m and m.group(1)) else 0
    passed = int(m.group(2)) if m else None
    names = re.findall(r"FAILED\s+\S+::(\S+)", out)
    return {"rc": p.returncode, "passed": passed, "failed": failed,
            "failing": names, "out": out}


# ── mutations ────────────────────────────────────────────────────────────────
# Each: a file, a callable that returns the mutated TEXT (and raises if the
# anchor it needs is gone -- a mutation that did not apply is the loudest
# possible false KILL), the runner, its filter, and the test it must reach.

def _drop_a_case_row(text: str) -> str:
    anchor = "`engine_three_bands_stacked`"
    if anchor not in text:
        raise SystemExit("M1: no case row to delete -- the tables are not filled in yet")
    lines = text.splitlines(keepends=True)
    out = [ln for ln in lines if anchor not in ln]
    if len(out) == len(lines):
        raise SystemExit("M1 removed nothing")
    return "".join(out)


def _write_a_placeholder(text: str) -> str:
    anchor = "| 2.1 separator colour | *(pending)* | |"
    if anchor not in text:
        raise SystemExit("M2: the sub-choice answer table moved")
    return text.replace(anchor, "| 2.1 separator colour | " + "T" + "BD | |")


def _blind_the_helper(text: str) -> str:
    anchor = "  return doc.cases.filter((c) => !c.status || c.status !== 'placeholder').map((c) => c.name)"
    if anchor not in text:
        raise SystemExit("M3: liveCaseNames() moved")
    return text.replace(anchor, "  return []")


def _region_named_rest(text: str) -> str:
    doc = json.loads(text)
    for case in doc["cases"]:
        if case["name"] == "rsi_only":
            case["regions"][1]["name"] = "rest"
            return json.dumps(doc, indent=2, ensure_ascii=False) + "\n"
    raise SystemExit("M4: rsi_only is gone")


def _zero_height_box(text: str) -> str:
    doc = json.loads(text)
    for case in doc["cases"]:
        if case["name"] == "rsi_only":
            box = case["regions"][0]["box"]
            box[3] = box[1]
            return json.dumps(doc, indent=2, ensure_ascii=False) + "\n"
    raise SystemExit("M5: rsi_only is gone")


def _unstamp_a_region_block(text: str) -> str:
    doc = json.loads(text)
    for case in doc["cases"]:
        if case["name"] == "macd_only":
            case.pop("_regionsFrom")
            return json.dumps(doc, indent=2, ensure_ascii=False) + "\n"
    raise SystemExit("M6: macd_only is gone")


def _box_off_canvas(text: str) -> str:
    doc = json.loads(text)
    for case in doc["cases"]:
        if case["name"] == "atr_only":
            case["regions"][1]["box"][3] += 400
            return json.dumps(doc, indent=2, ensure_ascii=False) + "\n"
    raise SystemExit("M7: atr_only is gone")


MUTATIONS = {
    "M1": dict(file=RECORD, mutate=_drop_a_case_row, runner="vitest",
               target=RECORD_TEST, filter="names a number for every live parity case",
               must_reach="names a number for every live parity case, or says why not",
               why="a case row deleted from the record"),
    "M2": dict(file=RECORD, mutate=_write_a_placeholder, runner="vitest",
               target=RECORD_TEST, filter="leaves no",
               must_reach="leaves no TBD behind",
               why="an unfilled placeholder written into a signed-off cell"),
    "M3": dict(file="app/" + RECORD_TEST, mutate=_blind_the_helper, runner="vitest",
               target=RECORD_TEST, filter="the Flip-C decision record",
               must_reach="read the whole live case list, so the assertions above are not vacuous",
               why="liveCaseNames() returns [] -- every toMatch above goes vacuous"),
    "M4": dict(file=CASES, mutate=_region_named_rest, runner="pytest",
               target=HARNESS_TEST, filter="region",
               must_reach="test_every_region_block_in_the_case_file_survives_validate_regions",
               why="a case declares the computed `rest` bucket"),
    "M5": dict(file=CASES, mutate=_zero_height_box, runner="pytest",
               target=HARNESS_TEST, filter="region",
               must_reach="test_every_region_block_in_the_case_file_survives_validate_regions",
               why="a zero-height price_plot -- a region that can only ever report 0"),
    "M6": dict(file=CASES, mutate=_unstamp_a_region_block, runner="pytest",
               target=HARNESS_TEST, filter="region",
               must_reach="test_every_region_block_records_the_TWO_BUILDS_it_was_derived_from",
               why="a rectangle with no derivation stamp -- i.e. one drawn by hand"),
    "M7": dict(file=CASES, mutate=_box_off_canvas, runner="pytest",
               target=HARNESS_TEST, filter="region",
               must_reach="test_every_region_block_in_the_case_file_survives_validate_regions",
               why="a box past the canvas edge, which Pillow pads with BLACK = 'unchanged'"),
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*")
    args = ap.parse_args()

    names = args.only or list(MUTATIONS)

    print("=== CONTROL A - the unmutated suites ===")
    for label, res in (("vitest " + RECORD_TEST, run_vitest(RECORD_TEST)),
                       ("pytest " + HARNESS_TEST, run_pytest(HARNESS_TEST))):
        print(f"  {label}: rc={res['rc']} passed={res['passed']} failed={res['failed']}")
        if res["rc"] != 0 or not res["passed"]:
            print(res["out"][-3000:])
            raise SystemExit("CONTROL A is not green with a nonzero passed count - "
                             "every verdict below would be a claim about nothing.")

    results = []
    for name in names:
        m = MUTATIONS[name]
        run = run_vitest if m["runner"] == "vitest" else run_pytest
        ctl = run(m["target"], m["filter"])
        print(f"\n=== {name} ({m['why']}) ===")
        print(f"  CONTROL B (unmutated, -t {m['filter']!r}): rc={ctl['rc']} passed={ctl['passed']}")
        if ctl["rc"] != 0 or not ctl["passed"]:
            raise SystemExit(f"{name}: CONTROL B is not green with a nonzero passed count - "
                             "the filter selects nothing the mutation could be judged by.")

        path = ROOT / m["file"]
        original = path.read_bytes()
        try:
            path.write_text(m["mutate"](original.decode("utf-8")),
                            encoding="utf-8", newline="\n")
            got = run(m["target"], m["filter"])
        finally:
            path.write_bytes(original)          # restore IN PLACE, never via stash
        assert path.read_bytes() == original, f"{name}: restore failed"

        reached = any(m["must_reach"] in f for f in got["failing"])
        verdict = ("KILLED" if got["rc"] != 0 and reached else
                   "SUSPECT" if got["rc"] != 0 else "SURVIVED")
        print(f"  mutated: rc={got['rc']} passed={got['passed']} failed={got['failed']}")
        print(f"  failing: {got['failing'] or '(none)'}")
        print(f"  -> {verdict}"
              + ("" if reached or got["rc"] == 0
                 else f"  (expected to reach: {m['must_reach']})"))
        results.append((name, verdict, got["failing"]))

    print("\n=== SUMMARY ===")
    for name, verdict, failing in results:
        print(f"  {name:4} {verdict:9} {failing[:2]}")
    bad = [n for n, v, _ in results if v != "KILLED"]
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
