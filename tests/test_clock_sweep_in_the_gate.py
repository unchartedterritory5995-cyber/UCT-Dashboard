"""The clock sweep is PERMANENTLY IN THE GATE (owner ruling, 2026-09-14).

⚰️ WHY. Two tests written on a Sunday were green all weekend and red on Monday, and the first thing
one of those reds did was refuse a mutation harness's CONTROL run — so eighty mutation proofs did
not happen, and nothing said so. `clock_sweep.py` runs the suites with the product's market clock
pinned to four instants spanning every session state and reports any test whose verdict differs
between them. It was built, it reported CLEAN over 1,220 observations, and then it was referenced
by NOTHING: the only mention of `clock_sweep` anywhere in the repo was its own filename.

⛔ AN INSTRUMENT NOBODY RUNS IS WORSE THAN NONE — IT READS AS COVERAGE. That is literally this
programme's own history (the desk insights pass was "written, documented as scheduled, wired into
no scheduler" for weeks). This file is the wire.

⛔ THIS TEST RUNS THE SWEEP'S OWN `--self-check`, NOT A FULL SWEEP. A full sweep re-runs whole
suites at four pinned instants and takes minutes; putting that inside the scoped gate would make
the gate slow enough to be skipped, which is how a gate stops being one. The full sweep is a
scheduled/pre-flip run; what the gate owes is that the sweep still WORKS and is still reachable.
"""
from __future__ import annotations

import pathlib
import subprocess
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SWEEP = ROOT / "docs" / "discord-render" / "instruments" / "clock_sweep.py"


def _run(*args) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(SWEEP), *args], cwd=ROOT,
                          capture_output=True, text=True, encoding="utf-8",
                          errors="replace", timeout=300)


def test_the_clock_sweep_still_exists_where_the_gate_expects_it():
    """⛔ Non-vacuity for everything below: if the file moved, every subprocess check would
    fail for a reason that has nothing to do with clock dependence, and 'the gate covers
    the clock sweep' would quietly become false."""
    assert SWEEP.is_file(), f"the clock sweep is not at {SWEEP}"


def test_the_clock_sweep_self_check_passes():
    """The sweep proves it can DETECT a clock-dependent test. If this goes red, the sweep's
    CLEAN verdict means nothing — an instrument that cannot see a presence cannot report an
    absence."""
    p = _run("--self-check")
    out = (p.stdout or "") + (p.stderr or "")
    # ⛔ A run with no totals line is not a run, whatever the exit code says.
    assert "TOTALS" in out, f"no TOTALS line from clock_sweep --self-check:\n{out[-2000:]}"
    assert p.returncode == 0, f"clock_sweep --self-check failed:\n{out[-2000:]}"


def test_the_self_check_reports_a_real_case_count():
    """⛔ THE DISCRIMINATOR. A self-check that enumerated zero cases would print a TOTALS line
    saying PASS and satisfy the row above while proving nothing. An empty result is a failed
    invocation until proven otherwise."""
    p = _run("--self-check")
    out = (p.stdout or "") + (p.stderr or "")
    totals = [L for L in out.splitlines() if "TOTALS" in L]
    assert totals, "no TOTALS line to read a count from"
    line = totals[-1]
    assert "cases=" in line, f"TOTALS line carries no case count: {line!r}"
    count = int(line.split("cases=")[1].split()[0])
    assert count > 0, f"clock_sweep --self-check enumerated ZERO cases: {line!r}"
    assert "failed=0" in line, f"clock_sweep --self-check has failures: {line!r}"


@pytest.mark.parametrize("flag", ["--self-check"])
def test_the_sweep_is_invokable_the_way_the_runbook_says(flag):
    """The runbook names this exact invocation. A runbook command that does not run is a
    documented workaround, not a procedure."""
    p = _run(flag)
    assert p.returncode == 0, (p.stdout or "") + (p.stderr or "")
