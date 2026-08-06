#!/usr/bin/env python3
"""Phase C's mutation gauntlet — the harness's own gate that it can SEE a change.

Generalized from `tools/flipc_mutation_gauntlet.py`. A mutation harness that never
starts scores a perfect KILLED, so this one refuses to report anything without:

  **CONTROL A** — the UNMUTATED suite, run first, ANSI-stripped, and ABORTED on a
  zero passed-count. A runner that cannot run makes every subsequent `rc=1` a
  claim about nothing.
  **CONTROL B** — the same `-k` / `-t` filter each mutation is judged under, run
  UNMUTATED, asserting a NONZERO passed count.

Verdicts come from the EXIT CODE, never from grepping output for the word FAIL.

    python tools/phase_c_gauntlet.py            # all
    python tools/phase_c_gauntlet.py --only M3

⚠️ NONZERO IS NECESSARY BUT NOT SUFFICIENT. B5 Task 10's M15 filter selected a
pure-helper case its binder mutation could not REACH, and CONTROL B reported
passed=1 throughout. Every mutation therefore declares `must_reach` — the test
whose failure is the kill — and a kill whose failing test is not that one is
reported SUSPECT, not KILLED.

⚠️ ARGV AS A LIST, shell=False. A `-t` containing a double quote SPLIT under
cmd.exe and selected TEN tests; a single-quoted `-t` selected NOTHING and
reported passed=None. Both happened, on this branch, in the same phase.

⚠️ `PYTHONDONTWRITEBYTECODE=1` IS NOT OPTIONAL. A same-size mutation applied
within one second of the previous run imports the previous `.pyc` and the
mutation silently never executes. Measured on this branch.

⚠️ `core.autocrlf` IS TRUE IN THIS CHECKOUT, so `git checkout -- <file>` does NOT
restore bytes and an anchor written with `\\n` matches ZERO times in a CRLF file.
Every mutator is handed LF; the restore is byte-for-byte from an in-memory backup
with sha256 asserted in BOTH directions.
"""
from __future__ import annotations

import argparse
import hashlib
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

TOOL = "tools/alert_replay.py"
TEST = "tests/test_alert_replay.py"

ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")


def strip(s: str) -> str:
    return ANSI.sub("", s)


def _env() -> dict:
    e = dict(os.environ)
    e["PYTHONDONTWRITEBYTECODE"] = "1"
    e["PYTHONIOENCODING"] = "utf-8"
    return e


def run_pytest(path: str, kfilter: str | None = None) -> dict:
    # ARGV AS A LIST, shell=False. See the module docstring.
    cmd = [sys.executable, "-m", "pytest", path, "-q"]
    if kfilter:
        cmd += ["-k", kfilter]
    # WARNING: `encoding=` IS NOT OPTIONAL ON THIS BOX. Without it Python decodes
    # the child's output as cp1252 and a single box-drawing character raises
    # UnicodeDecodeError inside the reader thread, stdout comes back None and the
    # verdict is a TypeError rather than a result.
    p = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True,
                       encoding="utf-8", errors="replace", env=_env())
    out = strip(p.stdout + p.stderr)
    m = re.search(r"(?:(\d+) failed,\s*)?(\d+) passed", out)
    failed = int(m.group(1)) if (m and m.group(1)) else 0
    passed = int(m.group(2)) if m else None
    # ⚠️ `passed=None` MUST MEAN ONE THING ONLY: "pytest reported no count I could
    # parse". Two runs print no "N passed" for opposite reasons — a filter that
    # selected NOTHING (abort, never record a phantom survivor) and a run where
    # every selected test FAILED (that is passed=0, a perfectly good kill). B5
    # measured the first; M6/M7 in this gauntlet produce the second. Distinguish
    # them here so a reader never has to guess which one they are looking at.
    if passed is None:
        only_failed = re.search(r"^(\d+) failed", out, re.M)
        if only_failed:
            failed = int(only_failed.group(1))
            passed = 0
        elif re.search(r"no tests ran", out, re.I):
            passed = 0
    names = re.findall(r"FAILED\s+\S+::(\S+)", out)
    names += re.findall(r"ERROR\s+\S+::(\S+)", out)
    return {"rc": p.returncode, "passed": passed, "failed": failed,
            "failing": names, "out": out}


# ── mutations ────────────────────────────────────────────────────────────────
# Each: a file, a callable returning the mutated TEXT (raising if the anchor it
# needs is gone -- a mutation that did not apply is the loudest possible false
# KILL), its `-k` filter, and the test whose failure IS the kill.

def _once(text: str, anchor: str, name: str) -> str:
    """The PREFLIGHT: the anchor must match EXACTLY ONCE.

    Zero matches is a mutation nobody ran (and on this checkout the usual cause is
    `core.autocrlf` -- an anchor written with `\\n` matches zero times in a CRLF
    file, which happened three times on this branch). TWO matches is worse: the
    mutator silently edits a second site nobody reasoned about, and the kill is
    then a claim about the wrong code.
    """
    n = text.count(anchor)
    if n != 1:
        raise SystemExit(f"{name}: anchor matched {n} times, expected exactly 1 "
                         f"-- {anchor.splitlines()[0][:70]!r}")
    return anchor


def _flatten_the_path(text: str) -> str:
    """M1: `intrabar_path` ignores k and returns the closed bar.

    The path model IS the oracle. Flattening it makes every k agree, the repaint
    count goes to 0, and the vacuity refusal is what has to catch it.
    """
    anchor = _once(
        text,
        "    if k < 1:\n        raise ValueError(f\"k must be >= 1, got {k!r}\")\n",
        "M1")
    return text.replace(anchor, anchor + "    return [dict(bar)]\n", 1)


def _repoint_rsi_at_mfi(text: str) -> str:
    """M2: the B5 control, verbatim — re-point one indicator's value fn at another.

    The fire log is an EQUALITY, not a shape check. Every RSI row in the log has
    to move, and the wick has to stop firing.
    """
    anchor = _once(
        text,
        "    from api.services import indicator_alert_evaluator as ev\n\n"
        "    value_memo:",
        "M2")
    return text.replace(
        anchor,
        "    from api.services import indicator_alert_evaluator as ev\n"
        "    ev.INDICATOR_FUNCS = dict(ev.INDICATOR_FUNCS,\n"
        "                              rsi=ev.INDICATOR_FUNCS['mfi'])\n\n"
        "    value_memo:", 1)


def _drop_value_from_fire_key(text: str) -> str:
    """M3: `value` leaves the key. A changed NUMBER then reads as no change."""
    anchor = _once(
        text,
        '    return (f["alert_key"], f["bar_index"], f["bar_time"],\n'
        '            repr(f["value"]), f["triggered"])',
        "M3")
    return text.replace(anchor,
                        '    return (f["alert_key"], f["bar_index"], f["bar_time"],\n'
                        '            f["triggered"])')


def _stop_writing_back_last_value(text: str) -> str:
    """M4: `replay` stops carrying `last_value` between samples.

    The cycle-carried `prev` IS the mechanism; without the write-back the forming
    lane accidentally looks closed-bar.
    """
    anchor = _once(text, '                a["last_value"] = value\n', "M4")
    return text.replace(anchor, '                pass\n', 1)


def _delete_the_per_address_guard_then_blind_an_address(text: str) -> str:
    """M5: delete the per-address non-vacuity assertion, THEN empty one ladder.

    ⚠️ DELETE-THE-GUARD-THEN-BREAK-IT IS THE ONLY LETHAL ORDERING HERE. B5 Task
    4's M8 was self-contradictory the other way round (break it, keep the guard)
    and measured rc=0 — the recorder simply refused to write, which is the guard
    WORKING, so the mutation proved nothing. Here the recorder is allowed to
    write a log that pins nothing about `cci`, and the rail that has to notice is
    the one re-checking non-vacuity from the COMMITTED file.
    """
    guard = _once(text, '    assert per_address and all(per_address.values()), (',
                  "M5")
    head, tail = text.split(guard, 1)
    # drop the assert and its message, up to the closing paren line
    rest = tail.split('    )\n', 1)[1]
    text = head + rest

    ladder = _once(text, '    lo, mid, hi = q(0.20), q(0.50), q(0.80)\n', "M5")
    return text.replace(
        ladder,
        '    lo, mid, hi = q(0.20), q(0.50), q(0.80)\n'
        '    import inspect as _i\n'
        '    if any("cci" in str(f.frame.f_locals.get("address")) '
        'for f in _i.stack()[:4]):\n'
        '        return []\n', 1)


def _let_the_oracle_report_zero(text: str) -> str:
    """M6: the vacuity refusal is deleted, so `--repaint` may print 0 and exit 0.

    Not one of the five the brief listed. It is here because the refusal is THE
    gate of this whole task — a repaint oracle that can report zero and pass is
    the shape that has been vacuous eighteen ways on this branch — and a gate with
    no mutation on it is a gate nobody has tested the test of.
    """
    anchor = _once(text, '    if not totals["keyed"] or not totals["identity"]:\n',
                   "M6")
    return text.replace(anchor, '    if False:\n', 1)


def _closed_bar_control_reads_the_forming_bar(text: str) -> str:
    """M7: the oracle's CONTROL is broken — the 'closed-bar' evaluator is handed
    the forming partial after all.

    The control is what makes `> 0` mean something. If it silently starts reading
    the forming bar it will also read non-zero, `== 0` fails, and the whole
    non-zero claim collapses into 'the harness always reports non-zero'.
    """
    anchor = _once(text, "    closed = seen[:-1]\n", "M7")
    return text.replace(anchor, "    closed = list(seen)\n", 1)


MUTATIONS = {
    "M1": dict(file=TOOL, mutate=_flatten_the_path, target=TEST,
               filter="intrabar_path or repaint_oracle or last_partial",
               must_reach="test_the_last_partial_is_the_closed_bar_at_every_k",
               why="intrabar_path returns the closed bar whatever k is"),
    # must_reach is the fire-log EQUALITY rail, not the wick test: with rsi
    # reading mfi the wick's `fires` list could in principle stay non-empty and
    # on the right bar by luck, but every recorded rsi row has to move.
    "M2": dict(file=TOOL, mutate=_repoint_rsi_at_mfi, target=TEST,
               filter="wick or fire_log or agrees_with_the_evaluators",
               must_reach="test_the_committed_fire_log_replays_exactly_for_the_wick_fixture",
               why="rsi's value fn re-pointed at mfi's (the B5 control, verbatim)"),
    "M3": dict(file=TOOL, mutate=_drop_value_from_fire_key, target=TEST,
               filter="fire_key or fire_log",
               must_reach="test_fire_key_puts_the_value_in_the_key",
               why="`value` dropped from fire_key -- a changed number reads as no change"),
    "M4": dict(file=TOOL, mutate=_stop_writing_back_last_value, target=TEST,
               filter="wick or fire_log",
               must_reach="test_the_wick_fires_once_because_last_value_is_carried",
               why="replay stops writing back last_value between samples"),
    "M5": dict(file=TOOL, mutate=_delete_the_per_address_guard_then_blind_an_address,
               target=TEST, filter="grid or ladder or vacuous",
               must_reach="test_the_grid_is_derived_from_the_live_catalog",
               why="the per-address guard deleted, THEN cci's ladder emptied"),
    "M6": dict(file=TOOL, mutate=_let_the_oracle_report_zero, target=TEST,
               filter="vacuity_refusal",
               must_reach="test_the_vacuity_refusal_is_still_in_the_tool",
               why="the repaint oracle's vacuity refusal deleted"),
    "M7": dict(file=TEST, mutate=_closed_bar_control_reads_the_forming_bar,
               target=TEST, filter="closed_bar_evaluator_reads_zero",
               must_reach="test_a_closed_bar_evaluator_reads_zero_on_the_same_oracle",
               why="the oracle's closed-bar CONTROL is handed the forming partial"),
}


def _sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*")
    args = ap.parse_args()
    names = args.only or list(MUTATIONS)

    print("=== CONTROL A - the unmutated suite ===")
    res = run_pytest(TEST)
    print(f"  pytest {TEST}: rc={res['rc']} passed={res['passed']} failed={res['failed']}")
    if res["rc"] != 0 or not res["passed"]:
        print(res["out"][-4000:])
        raise SystemExit("CONTROL A is not green with a nonzero passed count - "
                         "every verdict below would be a claim about nothing.")

    results = []
    for name in names:
        m = MUTATIONS[name]
        print(f"\n=== {name} ({m['why']}) ===")
        ctl = run_pytest(m["target"], m["filter"])
        print(f"  CONTROL B (unmutated, -k {m['filter']!r}): "
              f"rc={ctl['rc']} passed={ctl['passed']}")
        if ctl["rc"] != 0 or not ctl["passed"]:
            raise SystemExit(f"{name}: CONTROL B is not green with a nonzero passed "
                             "count - the filter selects nothing the mutation could "
                             "be judged by.")
        if not any(m["must_reach"] in n for n in
                   re.findall(r"(?m)^\S+::(\S+)", ctl["out"]) or [m["must_reach"]]):
            pass  # -q hides names; `must_reach` is verified from the FAILING list below

        path = ROOT / m["file"]
        original = path.read_bytes()
        before = _sha(original)
        try:
            mutated = m["mutate"](original.decode("utf-8").replace("\r\n", "\n"))
            path.write_text(mutated, encoding="utf-8", newline="\n")
            after = path.read_bytes()
            # PREFLIGHT: the mutation must have CHANGED THE FILE before anything runs.
            if after == original:
                raise SystemExit(f"{name}: the mutation produced identical bytes")
            print(f"  applied: {len(original)} -> {len(after)} bytes "
                  f"({_sha(after)[:12]}…)")
            got = run_pytest(m["target"], m["filter"])
        finally:
            path.write_bytes(original)          # restore IN PLACE, never via stash
        assert _sha(path.read_bytes()) == before, f"{name}: restore failed"

        reached = any(m["must_reach"] in f for f in got["failing"])
        verdict = ("KILLED" if got["rc"] != 0 and reached else
                   "SUSPECT" if got["rc"] != 0 else "SURVIVED")
        print(f"  mutated: rc={got['rc']} passed={got['passed']} failed={got['failed']}")
        # DISTINCT names, not the first N — a parametrized test contributes a row
        # per case and would otherwise crowd out the kill that actually matters.
        seen_names: list[str] = []
        for f in got["failing"]:
            base = f.split("[")[0]
            if base not in seen_names:
                seen_names.append(base)
        print(f"  failing: {seen_names or '(none)'}")
        print(f"  -> {verdict}" + ("" if reached or got["rc"] == 0
                                   else f"  (expected to reach: {m['must_reach']})"))
        results.append((name, verdict, got["failing"]))

    print("\n=== SUMMARY ===")
    for name, verdict, failing in results:
        print(f"  {name:4} {verdict:9} {failing[:2]}")
    bad = [n for n, v, _ in results if v != "KILLED"]
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
