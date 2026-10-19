"""Existing structures stay byte-for-byte unchanged by the base drawing.

tests/fixtures/base_draw_golden.json was written by tools/base_draw_golden.py from origin/master
BEFORE the drawing existed: one digest per scan of every row auto_structures.structures_for returned
on a seeded synthetic sweep (tests/base_draw_sweep.py). Here the same sweep runs on the code under
test with ONLY the drawing's own row (bc:base) removed, and every digest must match: no base box,
pivot stamp or stale verdict moved by a single byte.

Controls, so the rail cannot pass by comparing nothing: the sweep must carry base boxes and at least
one base drawing; with the bc:base row KEPT the digests must differ exactly on the scans that draw one.
Detector output (detect_all) is untouched by this drawing and railed separately
(tests/test_flat_top_golden.py: every detector's rows on a 168-scan sweep against a pre-drawing golden).
"""
import importlib.util
import json
import os

import pytest

from api.services import auto_structures

_HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("base_draw_sweep", os.path.join(_HERE, "base_draw_sweep.py"))
SW = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(SW)

with open(os.path.join(_HERE, "fixtures", "base_draw_golden.json"), encoding="utf-8") as _f:
    GOLDEN = json.load(_f)


@pytest.fixture(scope="module")
def swept():
    stripped, counts = SW.run(auto_structures, drop_base=True)
    kept, _ = SW.run(auto_structures, drop_base=False)
    return {"stripped": stripped, "kept": kept, "counts": counts}


def test_the_golden_is_from_code_without_the_drawing_and_matches_this_sweep():
    assert GOLDEN["series"] == SW.SW.SERIES and GOLDEN["cuts"] == list(SW.SW.CUTS)
    assert GOLDEN["counts"]["base_rows"] == 0          # the pre-drawing code draws no base
    assert set(GOLDEN["digests"]) == {k for k, _ in SW.SW.scans()}


def test_the_sweep_is_not_vacuous(swept):
    c = swept["counts"]
    assert c["scans"] == len(GOLDEN["digests"]) == 168
    assert c["rows"] - c["base_rows"] == GOLDEN["counts"]["rows"] > 100
    assert c["base_rows"] > 0                          # the drawing is made on some scans


def test_every_existing_structure_is_byte_for_byte_unchanged(swept):
    bad = sorted(k for k, d in GOLDEN["digests"].items() if swept["stripped"].get(k) != d)
    assert bad == [], f"{len(bad)} scans moved: {bad[:10]}"


def test_control_the_comparison_sees_the_base_row_when_it_is_kept(swept):
    moved = {k for k, d in GOLDEN["digests"].items() if swept["kept"].get(k) != d}
    assert len(moved) == swept["counts"]["base_rows"] > 0
