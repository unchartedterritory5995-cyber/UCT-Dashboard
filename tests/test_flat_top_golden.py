"""Existing drawings stay byte-for-byte unchanged by the "flat top" drawing.

tests/fixtures/flat_top_golden.json was written by tools/flat_top_golden.py from origin/master BEFORE
the drawing existed: one digest per (series, cut) of EVERY detection every registered detector made
on a seeded synthetic sweep (tests/flat_top_sweep.py). Here the same sweep runs on the code under
test with ONLY the drawing's own stamp (draw_flat_top + draw_round, on a uct_flat_top_breakout row)
removed, and every digest must match: no other detector's row, and no unstamped flat-top row, moved
by a single byte.

Controls, so the rail cannot pass by comparing nothing: the sweep must produce flat-top fires and
at least one v2 drawing; with the stamp KEPT the digests must differ exactly on the scans that carry
one; and no detector may have raised (a crash would drop rows from both sides alike).
"""
import importlib.util
import json
import logging
import os

import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("flat_top_sweep", os.path.join(_HERE, "flat_top_sweep.py"))
SW = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(SW)

with open(os.path.join(_HERE, "fixtures", "flat_top_golden.json"), encoding="utf-8") as _f:
    GOLDEN = json.load(_f)


#: Detectors registered AFTER the golden was written (code 88e55ab52e). Their rows are
#: new by construction, so they are left out of the comparison; every other
#: detector must still match byte for byte. Add an id here only for a NEW detector,
#: never for an existing one that moved.
_ADDED_SINCE_GOLDEN = ("uct_flat_top_breakout_ftb4",)


@pytest.fixture(scope="module")
def swept():
    SW.load_detectors()
    from api.services.pattern_engine import detect_all
    from api.services.pattern_engine.primitives.context import build_context

    raised = []

    class _Catch(logging.Handler):
        def emit(self, record):
            if "raised" in record.getMessage():
                raised.append(record.getMessage())
    h = _Catch(level=logging.WARNING)
    lg = logging.getLogger("api.services.pattern_engine")
    lg.addHandler(h)
    try:
        stripped, counts = SW.run(detect_all, build_context, drop_flat_top=True,
                                  drop_ids=_ADDED_SINCE_GOLDEN)
        kept, _ = SW.run(detect_all, build_context, drop_flat_top=False,
                         drop_ids=_ADDED_SINCE_GOLDEN)
    finally:
        lg.removeHandler(h)
    return {"stripped": stripped, "kept": kept, "counts": counts, "raised": raised}


def test_the_golden_is_from_code_without_the_drawing_and_matches_this_sweep():
    assert GOLDEN["series"] == SW.SERIES and GOLDEN["cuts"] == list(SW.CUTS)
    assert GOLDEN["counts"]["flat_top_stamped"] == 0          # the pre-drawing code stamps nothing
    assert set(GOLDEN["digests"]) == {k for k, _ in SW.scans()}


def test_the_added_ids_are_real_detectors():
    """A typo in _ADDED_SINCE_GOLDEN would drop nothing and hide nothing; a name that
    is not registered is caught here instead."""
    SW.load_detectors()
    from api.services.pattern_engine.detectors import registry
    assert set(_ADDED_SINCE_GOLDEN) <= set(registry.list_pattern_ids())


def test_the_sweep_is_not_vacuous(swept):
    c = swept["counts"]
    assert swept["raised"] == [], swept["raised"][:3]
    assert c["scans"] == len(GOLDEN["digests"])
    assert c["detections"] == GOLDEN["counts"]["detections"] > 1000
    assert c["pattern_ids"] == GOLDEN["counts"]["pattern_ids"] > 20
    assert c["flat_top"] == GOLDEN["counts"]["flat_top"] > 0     # the detector fires in the sweep
    assert c["flat_top_stamped"] > 0                             # and the drawing is made on some


def test_every_existing_drawing_is_byte_for_byte_unchanged(swept):
    bad = sorted(k for k, d in GOLDEN["digests"].items() if swept["stripped"].get(k) != d)
    assert bad == [], f"{len(bad)} scans moved: {bad[:10]}"


def test_control_the_comparison_sees_the_stamp_when_it_is_kept(swept):
    moved = {k for k, d in GOLDEN["digests"].items() if swept["kept"].get(k) != d}
    assert moved, "keeping the stamp changed nothing: the digest cannot see a drawing"
    assert len(moved) <= swept["counts"]["flat_top_stamped"]
