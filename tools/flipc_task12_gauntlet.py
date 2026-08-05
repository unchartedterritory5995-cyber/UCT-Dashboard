#!/usr/bin/env python3
"""B5 Task 12's mutation gauntlet — Flip C, APPLIED, with the two controls.

Task 11's gauntlet (`tools/flipc_mutation_gauntlet.py`) judged the RECORD and the
CASE FILE while the cutover was still dark. This one judges the APPLY: the
constant, the sub-choices the owner answered, the per-case `expect`s that replaced
the budget, the ledger row that retired, and the deletion of `paneMargins.js`.

Same discipline, verbatim, because it is the discipline and not the list that
makes a gauntlet mean anything:

  **CONTROL A** — the UNMUTATED suites, run first, ANSI-stripped, and aborted on a
  zero passed count. A runner that cannot run scores a perfect KILLED.
  **CONTROL B** — the same `-t` filter each mutation is judged under, run
  UNMUTATED, asserting a NONZERO passed count. ⚠️ NECESSARY BUT NOT SUFFICIENT:
  B5 Task 10's M15 filter selected a case its mutation could not reach and Control
  B reported `passed=1` throughout. So every mutation also declares the test it
  MUST REACH, and a kill whose failing test is not that one is SUSPECT, not
  KILLED.

Verdicts come from the EXIT CODE, never from grepping output for the word FAIL.

⚠️ THE PIXEL MUTATIONS (M1-M4, M10) ARE JUDGED BY THE PARITY GATE, which needs two
servers already running and — for the three that mutate SOURCE — a rebuilt dist.
They are opt-in for that reason:

    python tools/flipc_task12_gauntlet.py                     # the JS/py ones
    python tools/flipc_task12_gauntlet.py --only M1 M2 \\
        --base-a http://127.0.0.1:5941 --base-b http://127.0.0.1:5942
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

CASES = "tools/chart_parity_cases.json"
GEOMETRY_TEST = "src/components/chart/engine/__tests__/flipCGeometry.test.jsx"
ENUM_TEST = "src/components/chart/engine/__tests__/enumerationSites.test.js"
LAYOUT_TEST = "src/components/chart/engine/paneLayout.test.js"
RECORD_TEST = "src/components/chart/engine/__tests__/flipCRecord.test.js"

PANE_LAYOUT_SRC = "app/src/components/chart/engine/paneLayout.js"
PLACEMENT_SRC = "app/src/components/chart/engine/placement.js"
STOCK_CHART_SRC = "app/src/components/StockChart.jsx"
INSTANCES_SRC = "app/src/components/chart/engine/instances.js"

ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")


def strip(s: str) -> str:
    return ANSI.sub("", s)


# ── runners ──────────────────────────────────────────────────────────────────

def run_vitest(path, tfilter=None):
    cmd = ["npx", "vitest", "run", path]
    if tfilter:
        cmd += ["-t", tfilter]
    # WARNING: `encoding=` IS NOT OPTIONAL ON THIS BOX. Without it Python decodes
    # the child's output as cp1252, one box-drawing character raises
    # UnicodeDecodeError inside the reader thread, stdout comes back None and the
    # verdict is a TypeError rather than a result.
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


_GATE = {"a": None, "b": None}


def run_gate(_path=None, cases=None):
    """The parity gate on one case. The verdict is its EXIT CODE."""
    if not _GATE["a"] or not _GATE["b"]:
        raise SystemExit("the pixel mutations need --base-a and --base-b")
    cmd = [sys.executable, "tools/chart_parity.py",
           "--base-a", _GATE["a"], "--base-b", _GATE["b"],
           "--dist-a", ".parity-dist-a", "--dist-b", ".parity-dist-b",
           "--instances-side", "none", "--repeat", "1",
           "--out", "tools/chart_parity_out_mut",
           "--cases", *(cases or ["rsi_only"])]
    p = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    out = strip(p.stdout + p.stderr)
    # A gate failure names the case and what it expected — that IS the "failing
    # test" for the reach check below.
    names = re.findall(r"(?m)^\s*[-*]?\s*`?(\w+)`?\s*(?:FAIL|failed).*$", out)
    fails = re.findall(r"run \d+: [^\n]+", out)
    return {"rc": p.returncode, "passed": 0 if p.returncode else 1,
            "failed": 1 if p.returncode else 0,
            "failing": fails or names, "out": out}


# ── mutations ────────────────────────────────────────────────────────────────
# Each returns the mutated TEXT and RAISES if the anchor it needs is gone — a
# mutation that did not apply is the loudest possible false KILL.

def _case(doc, name):
    for c in doc["cases"]:
        if c["name"] == name:
            return c
    raise SystemExit(f"{name} is gone from the case file")


def _expect_minus_one(text: str) -> str:
    doc = json.loads(text)
    c = _case(doc, "rsi_only")
    if "expect" not in c:
        raise SystemExit("M1: rsi_only carries no `expect` — Task 12 has not written the numbers")
    c["expect"] -= 1
    return json.dumps(doc, indent=2, ensure_ascii=False) + "\n"


def _price_plot_500(text: str) -> str:
    doc = json.loads(text)
    for r in _case(doc, "rsi_only")["regions"]:
        if r["name"] == "price_plot":
            if "expect" not in r:
                raise SystemExit("M2: price_plot carries no `expect`")
            r["expect"] = 500
            return json.dumps(doc, indent=2, ensure_ascii=False) + "\n"
    raise SystemExit("M2: rsi_only has no price_plot region")


def _separator_out_of_pane0(text: str) -> str:
    """The mutation plan §A6 exists to catch: the separator budget comes out of
    PANE 0 instead of the oscillators, so the CANDLE RECTANGLE moves.

    ⚠️ NOT "delete the shave loop" — that was this mutation's first draft and it
    was aimed at the WRONG INVARIANT. Deleting the loop makes `separatorPx` do
    nothing at all, so a with-vs-without comparison agrees and the case named
    after the claim stays GREEN; what went red were the two total-arithmetic
    cases, i.e. a kill for the wrong reason. The budget has to actually MOVE.
    """
    loop = ("  const paneHeights = rawPx.slice()\n"
            "  for (let budget = oscCount * separatorPx; budget > 0; budget--) {\n"
            "    paneHeights[tallestIndex(paneHeights)] -= 1\n"
            "  }")
    pane0 = "  const pane0HeightPx = mainHeightPx - px(oscTotalC)"
    if loop not in text or pane0 not in text:
        raise SystemExit("M3: the separator-budget loop or the pane-0 height moved")
    return (text.replace(loop, "  const paneHeights = rawPx.slice()")
                .replace(pane0, pane0 + " - oscCount * separatorPx"))


def _back_to_bands(text: str) -> str:
    anchor = "export const PANE_MODE = 'panes'"
    if anchor not in text:
        raise SystemExit("M4: PANE_MODE is not 'panes' — the flip is not applied")
    return text.replace(anchor, "export const PANE_MODE = 'bands'")


def _reimport_pane_margins(text: str) -> str:
    """A consumer reaches for the deleted module again. It cannot RESOLVE, which
    is the point: the rail must fail on the NAME, before any bundler does."""
    anchor = "import { createBinder } from './chart/engine/binder'"
    if anchor not in text:
        raise SystemExit("M5: StockChart's binder import moved")
    return text.replace(anchor, "const _m = computePaneMargins\n" + anchor)


def _blind_the_positive_control(text: str) -> str:
    """The non-vacuity half returns nothing, so `toEqual([])` proves nothing."""
    anchor = "        if (/computePaneLayout/.test(code)) positive.push(rel)"
    if anchor not in text:
        raise SystemExit("M6: the positive-control line moved")
    return text.replace(anchor, "        if (false) positive.push(rel)")


def _site_count_off_by_one(text: str) -> str:
    anchor = "const SITE_COUNT = 8"
    if anchor not in text:
        raise SystemExit("M7: SITE_COUNT moved")
    return text.replace(anchor, "const SITE_COUNT = 7")


def _restore_the_b5_floor(text: str) -> str:
    """The discovery-scan floor, derived from the now-EMPTY `B5` fate. `[]` passes
    `.filter(...).toEqual([])` while checking nothing — the collapse the
    re-derivation exists to make loud."""
    anchor = "LEDGER.filter(s => s.fate === 'keep').map(s => s.file)"
    if anchor not in text:
        raise SystemExit("M8: the keep-fated floor derivation moved")
    return text.replace(anchor, "LEDGER.filter(s => s.fate === 'B5').map(s => s.file)")


def _reverse_the_seed_order(text: str) -> str:
    anchor = "  'rsi', 'stoch', 'mfi', 'williamsR', 'cci', 'macd', 'adx', 'atr', 'obv',"
    if anchor not in text:
        raise SystemExit("M9: FROZEN_SHIPPED_STACK_ORDER's nine moved")
    return text.replace(anchor,
                        "  'obv', 'atr', 'adx', 'macd', 'cci', 'williamsR', 'mfi', 'stoch', 'rsi',")


def _axis_without_the_owner(text: str) -> str:
    """Sub-choice 2.2 UNDONE — an overlay scale named after the definition, i.e.
    the answer the owner did NOT give, taken silently."""
    anchor = "      paneIndex: pane.index,\n      scaleId: 'right',"
    if anchor not in text:
        raise SystemExit("M10: the panes branch's scaleId moved")
    return text.replace(anchor, "      paneIndex: pane.index,\n      scaleId: key,")


MUTATIONS = {
    "M1": dict(file=CASES, mutate=_expect_minus_one, runner="gate",
               target=None, filter=None,
               must_reach="changed = ", cases=["rsi_only"],
               why="rsi_only's total expect N -> N-1: the equality, from the LOW side"),
    "M2": dict(file=CASES, mutate=_price_plot_500, runner="gate",
               target=None, filter=None,
               must_reach="region price_plot", cases=["rsi_only"],
               why="rsi_only's price_plot expect -> 500"),
    "M3": dict(file=PANE_LAYOUT_SRC, mutate=_separator_out_of_pane0, runner="vitest",
               target=LAYOUT_TEST, filter="separator budget",
               must_reach="pane 0 is byte-identical with and without a separator budget",
               why="the separator budget comes out of PANE 0 — the mutation plan A6 exists to catch"),
    "M4": dict(file=PANE_LAYOUT_SRC, mutate=_back_to_bands, runner="vitest",
               target=GEOMETRY_TEST, filter="the cutover is APPLIED",
               must_reach="the cutover is APPLIED, and one constant is still the whole of it",
               why="PANE_MODE back to 'bands' — the flip un-applied"),
    "M5": dict(file=STOCK_CHART_SRC, mutate=_reimport_pane_margins, runner="vitest",
               target=GEOMETRY_TEST, filter="do not exist",
               must_reach="the four files do not exist, and NOTHING in app/src names their exports",
               why="a consumer names the deleted band machinery again"),
    "M6": dict(file="app/" + GEOMETRY_TEST, mutate=_blind_the_positive_control, runner="vitest",
               target=GEOMETRY_TEST, filter="do not exist",
               must_reach="the four files do not exist, and NOTHING in app/src names their exports",
               why="the scan's POSITIVE control returns nothing — the no-importer rail goes vacuous"),
    "M7": dict(file="app/" + ENUM_TEST, mutate=_site_count_off_by_one, runner="vitest",
               target=ENUM_TEST, filter="live sites",
               # The title is TEMPLATED from SITE_COUNT, so the mutant renames the very
               # case it fails. Matched on the invariant half of the title.
               must_reach="live sites, and every one of them is still where it says it is",
               why="SITE_COUNT 8 -> 7"),
    "M8": dict(file="app/" + ENUM_TEST, mutate=_restore_the_b5_floor, runner="vitest",
               target=ENUM_TEST, filter="hand-lists four or more indicators",
               must_reach="names every shipped module that hand-lists four or more indicators",
               why="the discovery-scan floor derived from the now-EMPTY B5 fate"),
    "M9": dict(file=INSTANCES_SRC, mutate=_reverse_the_seed_order, runner="vitest",
               target=LAYOUT_TEST, filter="SEEDED order",
               must_reach="the SEEDED order IS the shipped stack, top-to-bottom, and volume is not in it",
               why="the inlined seed order reversed — every existing user's panes upside down"),
    "M10": dict(file=PLACEMENT_SRC, mutate=_axis_without_the_owner, runner="vitest",
                target=GEOMETRY_TEST, filter="OWN pane",
                must_reach="each oscillator gets its OWN pane, in instance-list order",
                why="sub-choice 2.2 UNDONE — the per-pane axis taken away without the owner"),
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--base-a")
    ap.add_argument("--base-b")
    args = ap.parse_args()
    _GATE["a"], _GATE["b"] = args.base_a, args.base_b

    names = args.only or [n for n, m in MUTATIONS.items() if m["runner"] != "gate"]

    print("=== CONTROL A - the unmutated suites ===")
    for label, res in (("vitest " + GEOMETRY_TEST, run_vitest(GEOMETRY_TEST)),
                       ("vitest " + ENUM_TEST, run_vitest(ENUM_TEST)),
                       ("vitest " + LAYOUT_TEST, run_vitest(LAYOUT_TEST)),
                       ("vitest " + RECORD_TEST, run_vitest(RECORD_TEST))):
        print(f"  {label}: rc={res['rc']} passed={res['passed']} failed={res['failed']}")
        if res["rc"] != 0 or not res["passed"]:
            print(res["out"][-3000:])
            raise SystemExit("CONTROL A is not green with a nonzero passed count - "
                             "every verdict below would be a claim about nothing.")

    results = []
    for name in names:
        m = MUTATIONS[name]
        is_gate = m["runner"] == "gate"

        def run(mut=m, gate=is_gate):
            if gate:
                return run_gate(cases=mut.get("cases"))
            return run_vitest(mut["target"], mut["filter"])

        ctl = run()
        print(f"\n=== {name} ({m['why']}) ===")
        label = "the gate" if is_gate else f"-t {m['filter']!r}"
        print(f"  CONTROL B (unmutated, {label}): rc={ctl['rc']} passed={ctl['passed']}")
        if ctl["rc"] != 0 or not ctl["passed"]:
            print(ctl["out"][-3000:])
            raise SystemExit(f"{name}: CONTROL B is not green with a nonzero passed count - "
                             "the filter selects nothing the mutation could be judged by.")

        path = ROOT / m["file"]
        original = path.read_bytes()
        try:
            # ⚠️ `core.autocrlf` IS TRUE IN THIS CHECKOUT, so a source file in the
            # worktree is CRLF and an anchor written with `\n` matches ZERO times.
            # Every mutator sees LF; the restore is byte-for-byte the original.
            path.write_text(m["mutate"](original.decode("utf-8").replace("\r\n", "\n")),
                            encoding="utf-8", newline="\n")
            got = run()
        finally:
            path.write_bytes(original)          # restore IN PLACE, never via stash
        assert path.read_bytes() == original, f"{name}: restore failed"

        reached = any(m["must_reach"] in f for f in got["failing"])
        verdict = ("KILLED" if got["rc"] != 0 and reached else
                   "SUSPECT" if got["rc"] != 0 else "SURVIVED")
        print(f"  mutated: rc={got['rc']} passed={got['passed']} failed={got['failed']}")
        print(f"  failing: {got['failing'][:3] or '(none)'}")
        print(f"  -> {verdict}"
              + ("" if reached or got["rc"] == 0
                 else f"  (expected to reach: {m['must_reach']})"))
        results.append((name, verdict, got["failing"]))

    print("\n=== SUMMARY ===")
    for name, verdict, failing in results:
        print(f"  {name:4} {verdict:9} {failing[:1]}")
    bad = [n for n, v, _ in results if v != "KILLED"]
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
