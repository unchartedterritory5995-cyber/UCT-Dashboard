"""Existing structures stay byte-for-byte unchanged by the cup tier.

tests/fixtures/cup_tier_golden.json was written by tools/cup_tier_golden.py from origin/master BEFORE the tier
existed: one digest per scan of every row auto_structures.structures_for returned on a seeded synthetic sweep
(tests/cup_tier_sweep.py). Here the same sweep runs on the code under test with ONLY the tier stamp
(extras.cup_tier) removed, and every digest must match: no base box, pivot stamp or stale verdict moved.

Controls, so the rail cannot pass by comparing nothing: the sweep must carry rows, and a stamp forced onto every
row must move the scans when it is KEPT. This synthetic sweep carries NO cup box (its series are flags and flat
tops; the golden records cup_rows 0), so it proves the rows that are not cups did not move. The cup half -- real
cup rows on real bars, with the tier firing, byte-identical once the stamp is removed -- is
tests/test_cup_tier_lab_parity.py::test_structures_rows_are_byte_identical_with_the_stamp_off.
"""
import importlib.util
import json
import os

import pytest

from api.services import auto_structures
from api.services.pattern_engine import cup_tier

_HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("cup_tier_sweep", os.path.join(_HERE, "cup_tier_sweep.py"))
SW = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(SW)

with open(os.path.join(_HERE, "fixtures", "cup_tier_golden.json"), encoding="utf-8") as _f:
    GOLDEN = json.load(_f)


@pytest.fixture(scope="module")
def swept():
    stripped, counts = SW.run(auto_structures, strip=True)
    return {"stripped": stripped, "counts": counts}


def test_the_golden_is_from_code_without_the_tier_and_matches_this_sweep():
    assert GOLDEN["series"] == SW.SW.SERIES and GOLDEN["cuts"] == list(SW.SW.CUTS)
    assert GOLDEN["counts"]["stamped"] == 0
    assert set(GOLDEN["digests"]) == {k for k, _ in SW.SW.scans()}


def test_the_sweep_is_not_vacuous(swept):
    c = swept["counts"]
    assert c["scans"] == len(GOLDEN["digests"]) > 100
    assert c["rows"] == GOLDEN["counts"]["rows"] > 50
    assert c["cup_rows"] == GOLDEN["counts"]["cup_rows"]


def test_every_existing_structure_is_byte_for_byte_unchanged(swept):
    bad = sorted(k for k, d in GOLDEN["digests"].items() if swept["stripped"].get(k) != d)
    assert bad == [], f"{len(bad)} scans moved: {bad[:10]}"


def test_control_the_comparison_sees_a_stamp_when_it_is_kept(monkeypatch):
    """Every base box is stamped here (cup_tier_stamp is forced onto all of them), so the scans must move."""
    forced = {"tier": "cup_conf", "draw_round": 4, "withheld": "x"}

    def stamp_all(det, bars):
        det["geometry"]["extras"]["cup_tier"] = dict(forced)

    monkeypatch.setattr(auto_structures, "cup_tier_stamp", stamp_all)
    kept, counts = SW.run(auto_structures, strip=False)
    moved = {k for k, d in GOLDEN["digests"].items() if kept.get(k) != d}
    assert counts["rows"] >= counts["stamped"] > 0      # every base box (bc:base rows are appended unstamped)
    assert len(moved) > 0
