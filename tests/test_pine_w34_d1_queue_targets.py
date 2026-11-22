"""W3W4-D1: the W3N-D1 probes must yield capture-queue targets (a probe column in the queue doc).

Without a probe column the generator cannot resolve `{a,b,c,d}.pine`, the four rows sit in
rowsNeedingProbe, and the capture operator is never handed them (the r2 review, N1).
"""
import functools
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools" / "vendor_harness"))
sys.path.insert(0, str(ROOT / "tools"))

import evidence_engine as ee  # noqa: E402


@functools.lru_cache(maxsize=1)
def _queue() -> dict:
    """The queue as the docs derive it NOW. (It was read from a committed capture-queue.json until
    2026-11-16; that snapshot is a local view now, see evidence_engine.QUEUE_OUT.)"""
    return ee.build_queue()


PROBES = [f"vw-w3n-draw-block-history-{k}.pine" for k in "abcd"]


def test_d1_probes_exist_and_are_queued_on_both_symbols():
    q = _queue()
    blob = [json.dumps(t) for t in q["targets"]]
    for p in PROBES:
        assert (ROOT / "tools/visual_conformance/probes" / p).is_file(), p
        stem = p[:-5]
        hits = [b for b in blob if stem in b]
        assert len(hits) == 2, (stem, len(hits))
        assert any("RDDT" in b for b in hits) and any("SPY" in b for b in hits), stem


def test_d1_rows_are_not_left_needing_a_probe():
    q = _queue()
    stuck = [r for r in q["rowsNeedingProbe"] if "W3N-D1" in json.dumps(r)]
    assert stuck == [], stuck
