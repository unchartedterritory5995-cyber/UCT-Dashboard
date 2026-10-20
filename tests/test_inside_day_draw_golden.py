"""Existing structures stay byte-for-byte unchanged by the inside-day drawing.

tests/fixtures/base_draw_golden.json was written from code that had NEITHER drawing: one digest per
scan of every row auto_structures.structures_for returned on the seeded synthetic sweep
(tests/base_draw_sweep.py, 24 series x 7 cuts). Here the same sweep runs on the code under test and:

  * with the inside-day drawing's row (draw:inside-day) and the base drawing's row removed, every digest
    matches the golden: no base box, pivot stamp or base drawing moved by a single byte;
  * with the inside-day drawing switched OFF (its row builder returning None), every digest is
    byte-identical to the run that removes its row -- the drawing touches nothing but its own row;
  * controls, so the rail cannot pass by comparing nothing: the sweep draws inside days on some scans,
    and with that row KEPT the digests differ on exactly those scans.

Detector output (detect_all) is untouched by this drawing and railed separately
(tests/test_flat_top_golden.py). Synthetic bars only (public repo).
"""
import importlib.util
import json
import os

import pytest

from api.services import auto_structures

_HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("base_draw_sweep_id", os.path.join(_HERE, "base_draw_sweep.py"))
SW = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(SW)

with open(os.path.join(_HERE, "fixtures", "base_draw_golden.json"), encoding="utf-8") as _f:
    GOLDEN = json.load(_f)


@pytest.fixture(scope="module")
def swept():
    stripped, counts = SW.run(auto_structures, drop_base=True, drop_inside_day=True)
    kept, _ = SW.run(auto_structures, drop_base=True, drop_inside_day=False)
    saved = auto_structures.inside_day_draw_row
    try:
        auto_structures.inside_day_draw_row = lambda sym, bars: None
        off, off_counts = SW.run(auto_structures, drop_base=True, drop_inside_day=False)
    finally:
        auto_structures.inside_day_draw_row = saved
    return {"stripped": stripped, "kept": kept, "off": off, "counts": counts, "off_counts": off_counts}


def test_the_sweep_is_not_vacuous(swept):
    c = swept["counts"]
    assert c["scans"] == len(GOLDEN["digests"]) == 168
    assert c["inside_day_rows"] > 0                      # the drawing is made on some scans
    assert swept["off_counts"]["inside_day_rows"] == 0  # and switching it off removes every one


def test_every_existing_structure_is_byte_for_byte_unchanged(swept):
    bad = sorted(k for k, d in GOLDEN["digests"].items() if swept["stripped"].get(k) != d)
    assert bad == [], f"{len(bad)} scans moved: {bad[:10]}"


def test_with_the_drawing_off_every_scan_is_byte_identical(swept):
    assert swept["off"] == swept["stripped"]
    assert swept["off"] == {k: GOLDEN["digests"][k] for k in swept["off"]}


def test_control_the_comparison_sees_the_inside_day_row_when_it_is_kept(swept):
    moved = {k for k, d in GOLDEN["digests"].items() if swept["kept"].get(k) != d}
    assert len(moved) == swept["counts"]["inside_day_rows"] > 0
