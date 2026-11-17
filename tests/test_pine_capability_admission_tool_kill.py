"""RT1 (2026-11-15): the admission measurement asks the kill list, as the member door does."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools" / "pine_coverage"))

import capability_admission as ca  # noqa: E402
from api.services import runtime_definitions as rt  # noqa: E402
from tests.test_pine_capability_admission import synthetic_kill  # noqa: E402 -- the one synthetic subject


def test_a_killed_script_reads_NOT_admitted_whatever_its_capabilities(tmp_path, monkeypatch):
    """The committed kill list is empty since 2026-11-16 (parabolic-sar lifted): a SYNTHETIC entry kills."""
    src = synthetic_kill(tmp_path, monkeypatch)
    every = set(ca.pc.CAPABILITY_IDS)          # as if every capability were admitted
    row = ca.admission_row(src, every)
    assert row["missing"] == [] and row["killed"] is True and row["admitted"] is False
    assert row["hash"] == rt.source_hash(src)


def test_a_script_whose_kill_was_lifted_reads_unkilled_parabolic_sar():
    """parabolic-sar: killed in s28 (a label one decimal short on SPY), lifted 2026-11-16 (runtime-on MATCH on
    RDDT and SPY once `round_to_mintick` counts ticks as `x * (1 / mintick)`)."""
    src = (ROOT / "corpus" / "committed" / "parabolic-sar__xoeoPMOWGJ.pine").read_text(encoding="utf-8")
    row = ca.admission_row(src, set(ca.pc.CAPABILITY_IDS))
    assert row["killed"] is False and row["admitted"] is True


def test_a_script_whose_kill_was_lifted_reads_unkilled():
    """trend-targets-algoalpha: killed in s28, lifted by PR #1374 (the runtime-on re-grade to MATCH)."""
    src = (ROOT / "corpus" / "committed" / "trend-targets-algoalpha__92ff5628d7.pine").read_text(encoding="utf-8")
    row = ca.admission_row(src, set(ca.pc.CAPABILITY_IDS))
    assert row["killed"] is False and row["admitted"] is True


def test_CONTROL_an_unkilled_script_with_every_capability_admitted_reads_admitted():
    src = (ROOT / "corpus" / "committed" / "inside-bar-range-mother-candle-breakoutbreakdown-with-volume-confirmat__832e485b9c.pine").read_text(encoding="utf-8")
    row = ca.admission_row(src, set(ca.pc.CAPABILITY_IDS))
    assert row["killed"] is False and row["admitted"] is True
