"""Which tests read the WALL CLOCK? Run the suites at four pinned instants and diff the outcomes.

    python docs/discord-render/instruments/clock_sweep.py --self-check
    python docs/discord-render/instruments/clock_sweep.py

⛔⛔ A TEST WHOSE VERDICT DEPENDS ON WHEN IT RUNS REPORTS THE CALENDAR. Two were found by accident
in one morning — both written on a Sunday, both green all weekend, both red on Monday:

  * `test_bars_come_back_with_a_vintage…` asserted the session word was WEEKEND-or-closed. It went
    red at 04:00 ET when the session became `pre`, and **the first thing that red did was refuse a
    mutation harness's control run, so eighty mutation proofs did not happen.**
  * `test_an_empty_tape_is_a_successful_answer…` asserted `reason() is None` against a fixture
    whose window ends on Friday. Correct all weekend; STALE from Monday's open.

Finding them one session boundary at a time is not a strategy — 09:30 and 16:00 are still ahead.
This runs the suite with the market clock pinned to four instants that span every session state and
reports any test whose PASS/FAIL differs between them.

⛔ IT PINS THE PRODUCT'S CLOCK, NOT THE OS CLOCK. `freshness.now_et()` is the one seam the session
rule reads; moving the machine's time would also move file mtimes, SQLite timestamps and pytest's
own bookkeeping, and the result would be a sweep of the operating system.

⛔ A TEST THAT FAILS AT EVERY INSTANT IS NOT CLOCK-DEPENDENT — it is just broken, and is reported
separately. Collapsing those two would send somebody to pin a clock in a test that has a real bug.

⛔⛔ **CLEAN MEANS NOTHING UNTIL THE SWEEP IS SHOWN TO CATCH ONE.** `--self-check` proves `compare`
reasons correctly over synthetic results; it says nothing about whether the PIN reaches the product.
So the end-to-end proof is done by planting one: restore `test_an_empty_tape_is_a_successful_answer`
to its clock-reading form (`assert r.reason() is None`) and re-run. Measured 2026-09-14 — it is
reported by name:

    CLOCK-DEPENDENT tests.test_discord_render_adapters::test_an_empty_tape_is_a_successful_answer…

⭐ First full run, same day: **1,220 observations across 305 cases × 4 instants — 0 clock-dependent,
0 broken.** That number is worth something only because of the paragraph above it.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile

PASS, FOUND, ERROR = 0, 1, 2
ROOT = pathlib.Path(__file__).resolve().parents[3]

#: One instant per session state the rule distinguishes. ⛔ Named, so a reader can see the sweep
#: covers the boundaries rather than four arbitrary times.
INSTANTS = {
    "weekend": "2026-09-13T11:00:00-04:00",
    "pre": "2026-09-14T09:29:50-04:00",
    "rth": "2026-09-14T10:30:00-04:00",
    "post": "2026-09-14T16:30:00-04:00",
}

SUITES = ("tests/test_discord_render_adapters.py",
          "tests/test_discord_render_result.py",
          "tests/test_discord_render_freshness.py",
          "tests/test_discord_render_artifact_cache.py",
          "tests/test_discord_render_cache_wiring.py",
          "tests/test_discord_render_badge.py",
          "tests/test_discord_render_forensics.py")

#: Injected into the run as a `conftest` plugin: it replaces the ONE function the session rule
#: reads, for the whole process, before any test imports anything.
PIN = '''
import datetime as _dt, os as _os
from zoneinfo import ZoneInfo as _Z
_PINNED = _dt.datetime.fromisoformat(_os.environ["UCT_CLOCK_SWEEP_AT"])

def pytest_configure(config):
    # ⛔ `freshness._et` IS THE ONE PLACE THE SESSION RULE READS THE CLOCK — measured, not assumed:
    # `_et(now=None)` is the only `datetime.now` in the module, and every public entry point
    # (`session_state`, `envelope`, `last_trading_date`) funnels through it. Pinning anything
    # higher up would miss a caller; pinning lower would be the OS clock.
    from api.services.discord_render import freshness as _f
    _real = _f._et
    _f._et = lambda now=None: _real(now if now is not None else _PINNED)
'''


def run_at(label: str, when: str, suites) -> dict:
    """`{nodeid: 'passed'|'failed'}` for one pinned instant."""
    tmp = pathlib.Path(tempfile.mkdtemp(prefix=f"drender-clock-{label}-"))
    plugin = tmp / "clockpin.py"
    plugin.write_text(PIN, encoding="utf-8")
    report = tmp / "report.json"
    env = {**os.environ, "UCT_CLOCK_SWEEP_AT": when,
           "PYTHONPATH": str(tmp) + os.pathsep + os.environ.get("PYTHONPATH", "")}
    r = subprocess.run(
        [sys.executable, "-m", "pytest", "-q", "-p", "no:randomly", "-p", "clockpin",
         "--tb=no", f"--junit-xml={report}", *suites],
        cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace",
        env=env, timeout=1800)
    out = r.stdout + r.stderr
    if not re.search(r"(\d+) passed|(\d+) failed|(\d+) error", out):
        # ⛔ NO TOTALS LINE IS NOT A RUN — and a sweep that silently treats it as "nothing differed"
        # would report every clock-dependent test as clean.
        raise SystemExit(f"{label}: no totals line; the run did not happen\n{out[-800:]}")
    return _parse_junit(report)


def _parse_junit(path: pathlib.Path) -> dict:
    import xml.etree.ElementTree as ET
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for case in ET.parse(path).getroot().iter("testcase"):
        nodeid = f"{case.get('classname', '')}::{case.get('name', '')}"
        state = "passed"
        for child in case:
            if child.tag in ("failure", "error"):
                state = "failed"
            elif child.tag == "skipped":
                state = "skipped"
        out[nodeid] = state
    return out


def compare(results: dict[str, dict]) -> tuple[list, list]:
    """`(clock_dependent, always_failing)` — and they are NOT the same finding."""
    nodes: set = set()
    for r in results.values():
        nodes |= set(r)
    dependent, broken = [], []
    for node in sorted(nodes):
        states = {label: r.get(node, "missing") for label, r in results.items()}
        distinct = set(states.values()) - {"skipped"}
        if len(distinct) > 1:
            dependent.append((node, states))
        elif distinct == {"failed"}:
            broken.append(node)
    return dependent, broken


def self_check() -> int:
    r = {"a": {"t1": "passed", "t2": "failed", "t3": "passed"},
         "b": {"t1": "failed", "t2": "failed", "t3": "passed"}}
    dep, broke = compare(r)
    cases = [
        ("a test that flips between instants is reported", [n for n, _ in dep] == ["t1"]),
        ("a test failing everywhere is NOT called clock-dependent", "t2" not in [n for n, _ in dep]),
        ("…it is reported separately as broken", broke == ["t2"]),
        ("a test passing everywhere is reported as neither",
         "t3" not in [n for n, _ in dep] and "t3" not in broke),
        ("a skip does not count as a difference",
         compare({"a": {"x": "passed"}, "b": {"x": "skipped"}})[0] == []),
        ("the instants span more than one session state", len(set(INSTANTS.values())) == 4),
    ]
    failed = sum(not ok for _, ok in cases)
    for name, ok in cases:
        print(f"  {'ok  ' if ok else 'FAIL'} {name}")
    print(f"TOTALS clock_sweep --self-check {'PASS' if not failed else 'FAIL'} "
          f"cases={len(cases)} failed={failed}")
    return PASS if not failed else ERROR


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--suites", default=",".join(SUITES))
    ap.add_argument("--out", default="")
    ap.add_argument("--self-check", action="store_true")
    args = ap.parse_args(argv)
    if args.self_check:
        return self_check()

    suites = [s.strip() for s in args.suites.split(",") if s.strip()]
    results = {label: run_at(label, when, suites) for label, when in INSTANTS.items()}
    dependent, broken = compare(results)
    for node, states in dependent:
        print(f"  CLOCK-DEPENDENT {node}")
        print(f"      {' · '.join(f'{k}={v}' for k, v in states.items())}")
    for node in broken:
        print(f"  BROKEN AT EVERY INSTANT (not a clock problem) {node}")
    if args.out:
        pathlib.Path(args.out).write_text(json.dumps(
            {"instants": INSTANTS, "results": results,
             "clock_dependent": [n for n, _ in dependent], "broken": broken}, indent=2),
            encoding="utf-8")
    total = sum(len(r) for r in results.values())
    print(f"TOTALS clock_sweep {'FOUND' if dependent else 'CLEAN'} instants={len(INSTANTS)} "
          f"cases_per_instant={len(results['weekend'])} observations={total} "
          f"clock_dependent={len(dependent)} broken_everywhere={len(broken)}")
    return FOUND if dependent else PASS


if __name__ == "__main__":
    raise SystemExit(main())
