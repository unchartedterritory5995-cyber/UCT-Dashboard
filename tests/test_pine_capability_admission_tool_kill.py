"""RT1 (2026-11-15): the admission measurement asks the kill list, as the member door does."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools" / "pine_coverage"))

import capability_admission as ca  # noqa: E402
from api.services import runtime_definitions as rt  # noqa: E402


def test_a_killed_script_reads_NOT_admitted_whatever_its_capabilities():
    src = (ROOT / "corpus" / "committed" / "trend-targets-algoalpha__92ff5628d7.pine").read_text(encoding="utf-8")
    every = set(ca.pc.CAPABILITY_IDS)          # as if every capability were admitted
    row = ca.admission_row(src, every)
    assert row["missing"] == [] and row["killed"] is True and row["admitted"] is False
    assert row["hash"] == rt.source_hash(src)


def test_CONTROL_an_unkilled_script_with_every_capability_admitted_reads_admitted():
    src = (ROOT / "corpus" / "committed" / "inside-bar-range-mother-candle-breakoutbreakdown-with-volume-confirmat__832e485b9c.pine").read_text(encoding="utf-8")
    row = ca.admission_row(src, set(ca.pc.CAPABILITY_IDS))
    assert row["killed"] is False and row["admitted"] is True
