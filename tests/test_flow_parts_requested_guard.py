"""`build_parts` must accept a stream iff it carries what was REQUESTED.

⚰️ THE DEFECT THIS PINS, measured on prod 2026-09-11 (flow-worker):

    only=rest             -> None   5.5 s   [flow-agg] parts stream unusable
                                            (18,971,776 bytes, 9 frames)
    only=rest+bootstrap   -> dict   5.8 s   all 9 parts

The preparer's pass 2 asks for `SERVED_PART_NAMES - FIRST_PAINT_PARTS`, which by
construction never contains `bootstrap`, while the guard read
`if not frames or "bootstrap" not in frames: return None`. So every roll spawned
node, ran processFlowData in full, piped back ~19 MB of VALID frames, and threw
all of it away. After 889 prepared rolls the prod parts cache held exactly
['bootstrap', 'TOP_PICKS'] with 22 of 24 slots free, and `build_failures` sat at
885 — one per prepared roll — while `prepare.failed` read 0.

The guard predates the `--only=` emission filter, when every build emitted every
part and "bootstrap is present" WAS "the stream is complete". It is now the wrong
question in both directions: it rejects a valid partial stream, and it ACCEPTS a
stream that is missing a requested part as long as bootstrap happens to be there.
"""
from __future__ import annotations

import subprocess

import pytest

from api.services import flow_aggregate as fa


def _frames(parts: dict, stats: bytes = b'{"totalTrades":1}') -> bytes:
    """The CLI's length-prefixed wire format (see _read_frames)."""
    out = b""
    for name, body in parts.items():
        out += b"PART %s %d\n%s\n" % (name.encode(), len(body), body)
    out += b"STATS %d\n%s\n" % (len(stats), stats)
    return out


@pytest.fixture
def stub(monkeypatch):
    """Make build_parts run without node, returning a stream we choose."""
    monkeypatch.setattr(fa, "available", lambda: True)
    monkeypatch.setattr(fa, "_write_etf_replica_file", lambda: None)

    def _install(stream: bytes):
        def fake_run(argv, **kw):
            return subprocess.CompletedProcess(argv, 0, stdout=stream, stderr=b"")
        monkeypatch.setattr(fa.subprocess, "run", fake_run)
    return _install


def test_a_bootstrap_less_only_set_is_usable(stub):
    """PASS 2's EXACT SHAPE. Nothing here asks for bootstrap, so its absence is
    correct output, not a broken stream."""
    only = tuple(p for p in fa.SERVED_PART_NAMES if p not in fa.FIRST_PAINT_PARTS)
    assert "bootstrap" not in only          # control: the case really is bootstrap-less
    stub(_frames({p: b"[]" for p in only}))

    got = fa.build_parts("csv", "Last1", only=only)

    assert got is not None, "a stream carrying every requested part was rejected"
    assert set(got["parts"]) == set(only)


def test_a_stream_missing_a_requested_part_is_rejected(stub):
    """THE OTHER HALF. The old guard would ACCEPT this — bootstrap is present —
    and cache a set missing an array the page asked for."""
    stub(_frames({"bootstrap": b"{}"}))     # WATCH requested, never emitted

    got = fa.build_parts("csv", "Last1", only=("bootstrap", "WATCH"))

    assert got is None, "a stream missing a requested part was accepted"


def test_an_empty_stream_is_still_rejected(stub):
    """CONTROL: the guard must not have been loosened into absence."""
    stub(b"")
    assert fa.build_parts("csv", "Last1", only=("WATCH",)) is None


def test_a_rejection_is_counted_distinctly_from_a_crashed_build(stub):
    """⛔ A SILENT FALLBACK NEEDS ITS OWN NUMBER. `build_failures` already covers
    timeouts, non-zero exits and unparseable stdout; a stream that arrived intact
    and was refused is a different fact and was invisible for 885 rolls."""
    before = fa.stats().get("parts_rejected_missing", 0)
    stub(_frames({"bootstrap": b"{}"}))

    fa.build_parts("csv", "Last1", only=("bootstrap", "WATCH"))

    assert fa.stats().get("parts_rejected_missing", 0) == before + 1
