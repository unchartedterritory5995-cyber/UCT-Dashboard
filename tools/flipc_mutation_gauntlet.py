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


# ── the FIX's own mutations (Task 11b) ───────────────────────────────────────
# M1-M7 judge the RECORD and the CASE FILE. They say nothing about the three
# defects this task fixed, and a fix with no mutation coverage is a fix nobody
# has tested the tests of. Each of these RESTORES one defect exactly as B5 Task
# 11 measured it, and names the rail that must go red.

def _restore_D1_over_allocation(text: str) -> str:
    """D1 exactly as measured: the panes above the stack are given a budget that
    still contains THEIR OWN separators, so the layout over-allocates by
    `firstPaneIndex - 1` px and `paneHeightMismatch` throws.

    ⚠️ NOT "make `px` divide by chartHeight again" — that was the first draft of
    this mutation and it SURVIVED, because `pane0HeightPx = mainHeightPx -
    px(oscTotalC)` keeps the sum exact whatever `px` divides by. It changes every
    pane's SIZE and no total. A mutation aimed at the wrong invariant is a green
    that means nothing; D3's mutation (M9) is the one that catches the base."""
    anchor = "  const available = chartHeight - Math.max(0, n - 1) * separatorPx"
    if anchor not in text:
        raise SystemExit("M8: bandsAboveHeights' budget line moved")
    return text.replace(anchor, "  const available = chartHeight")


def _restore_D3_budget_divisor(text: str) -> str:
    """D3 alone: the candle pane's margins divided by the price-pane BUDGET."""
    anchor = "  above[mainPaneIndex] = pane0HeightPx"
    if anchor not in text:
        raise SystemExit("M9: the pane-0 height assignment moved")
    return text.replace(anchor, "  above[mainPaneIndex] = pane0HeightPx\n"
                                "  // MUTATION: divide by the budget, as it did before the fix.\n"
                                "  const _budget = above.reduce((s, v) => s + v, 0)")\
               .replace("        top: mainTopPx / pane0HeightPx,",
                        "        top: mainTopPx / _budget,")


def _lose_the_remainder(text: str) -> str:
    """`bandsAboveHeights` rounds EVERY share instead of giving the remainder to
    the candle pane — three equal weights over 100 then lose a pixel off the
    stack, which is the one-pixel drift nobody attributes for a week."""
    anchor = "  out[mainPaneIndex] = available - assigned"
    if anchor not in text:
        raise SystemExit("M10: the remainder line moved")
    return text.replace(anchor,
                        "  out[mainPaneIndex] = Math.round((available * abovePct[mainPaneIndex]) / total)")


def _throw_again(text: str) -> str:
    """D2 restored: a height disagreement takes the whole chart down."""
    anchor = "    mismatchRun += 1\n    if (mismatchRun === 1) {"
    if anchor not in text:
        raise SystemExit("M11: the converge branch moved")
    return text.replace(anchor, "    mismatchRun += 1\n    throw new Error(message)\n"
                                "    // eslint-disable-next-line no-unreachable\n"
                                "    if (mismatchRun === 1) {")


def _reset_the_run_on_apply(text: str) -> str:
    """The bug the first draft of the D2 fix actually had: resetting the
    consecutive-mismatch counter every time a layout is applied makes the REPORT
    unreachable, so "do not throw" quietly becomes "do not notice"."""
    anchor = "    pendingLayout = layout\n    pendingLaidOut = false\n"
    if anchor not in text:
        raise SystemExit("M12: applyPaneStretch's arming block moved")
    return text.replace(anchor, "    pendingLayout = layout\n    pendingLaidOut = false\n"
                                "    mismatchRun = 0\n", 1)


PANE_LAYOUT_SRC = "app/src/components/chart/engine/paneLayout.js"
BINDER_SRC = "app/src/components/chart/engine/binder.js"
GEOMETRY_TEST = "src/components/chart/engine/__tests__/flipCGeometry.test.jsx"

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
    # ⚠️ EVERY FILTER BELOW NAMES A CASE IN THE `shipped configuration` DESCRIBE,
    # i.e. one that builds a chart with a SEPARATE VOLUME PANE. A filter that
    # selected a `firstPaneIndex === 1` case would be green under all five of
    # these mutations — which is EXACTLY how the defects survived Task 10, so it
    # is the trap this gauntlet is aimed at.
    "M8": dict(file=PANE_LAYOUT_SRC, mutate=_restore_D1_over_allocation, runner="vitest",
               target=GEOMETRY_TEST, filter="TOTALS EXACTLY",
               must_reach="the layout TOTALS EXACTLY, which is the whole of D1",
               why="D1 restored: the above-stack budget still contains its own separators"),
    "M9": dict(file=PANE_LAYOUT_SRC, mutate=_restore_D3_budget_divisor, runner="vitest",
               target=GEOMETRY_TEST, filter="same absolute pixels",
               must_reach="the CANDLE RECTANGLE lands on the same absolute pixels",
               why="D3 restored: the candle margins divide by the price-pane BUDGET"),
    # ⚠️ NOT the 78/22 fixture. B5 Task 10 measured that a split which divides
    # evenly cannot tell `available - assigned` from `round(available*w/total)` --
    # 78/22 of 399 gives 311 either way and the mutation SURVIVES. Three equal
    # weights over 100 give 33+33+33 = 99 and lose a pixel off the stack.
    "M10": dict(file=PANE_LAYOUT_SRC, mutate=_lose_the_remainder, runner="vitest",
                target=GEOMETRY_TEST, filter="a fixture where the two arithmetics agree",
                must_reach="the remainder lands on the CANDLE pane",
                why="bandsAboveHeights rounds every share and loses the remainder"),
    "M11": dict(file=BINDER_SRC, mutate=_throw_again, runner="vitest",
                target=GEOMETRY_TEST, filter="CONVERGES instead of blanking",
                must_reach="a redistribution CONVERGES instead of blanking the chart",
                why="D2 restored: a height disagreement throws into the ErrorBoundary"),
    "M12": dict(file=BINDER_SRC, mutate=_reset_the_run_on_apply, runner="vitest",
                target=GEOMETRY_TEST, filter="SURVIVES its own re-apply",
                must_reach="a drift that SURVIVES its own re-apply is reported by name",
                why="the mismatch run resets on every apply, so the report is unreachable"),
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
            # ⚠️ `core.autocrlf` IS TRUE IN THIS CHECKOUT, so a source file in the
            # worktree is CRLF and an anchor written with `\n` matches ZERO times.
            # B5 Task 10 hit that twice and Task 11b hit it again on M11 — the
            # mutator REFUSED (which is the design) rather than reporting a
            # phantom survivor, but a refusal is still a mutation nobody ran.
            # Every mutator sees LF; the restore is byte-for-byte the original.
            path.write_text(m["mutate"](original.decode("utf-8").replace("\r\n", "\n")),
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
