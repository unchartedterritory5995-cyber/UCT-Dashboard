"""The live 5m stream's proof moves only after the push's rows are written (review of #2708, round 2).

`ingest` set `_state["watermark_ms"]` before `_write_rows`: a request between the two read `proven_through_s` (the end of
the watermark minute, the roll) for rows not yet in the store, and the 15m/30m/60m series derived from the 5m inherited
it (`_live_derived_proof`, `_local_tail_repair`). The 1m path already set its watermark after the write.
  W1  while a push's rows are being written, the proof is still the previous push's; after the write it is this one's
  W2  a push that writes no rows still moves the proof (the minute was delivered with nothing to write)
"""
import sqlite3

import pytest

from api.services import bars_live_store as bls, bars_sqlite


@pytest.fixture
def live(monkeypatch, tmp_path):
    monkeypatch.setenv("BARS_LIVE_COVERAGE_ENABLED", "1")
    monkeypatch.setattr(bars_sqlite, "put_bars_many", lambda tf, by: sum(len(v) for v in by.values()))
    db = sqlite3.connect(str(tmp_path / "bars.db"), check_same_thread=False)
    monkeypatch.setattr(bars_sqlite, "_conn", lambda: db)
    bls._reset_for_tests()
    yield bls
    bls._reset_for_tests()


FFB = 1_000_000_200_000


def _push(wm, rows, seq=1):
    return bls.ingest({"epoch_ms": 1, "seq": seq, "first_full_bucket_ms": FFB, "watermark_ms": wm, "rows": rows})


def test_W1_the_proof_moves_only_after_the_rows_are_written(live, monkeypatch):
    seen = []
    real = bls._write_rows

    def spy(tf, rows):
        seen.append((tf, bls._state["watermark_ms"]))
        return real(tf, rows)
    monkeypatch.setattr(bls, "_write_rows", spy)
    _push(FFB, [["AAA", FFB // 1000, 1, 2, 1, 2, 20]])
    assert seen[-1] == ("5", None)                     # the first push's rows: no proof yet
    assert bls._state["watermark_ms"] == FFB
    _push(FFB + 60_000, [["AAA", FFB // 1000, 1, 3, 1, 3, 30]], seq=2)
    assert seen[-1] == ("5", FFB)                      # while writing, still the previous push's proof
    assert bls._state["watermark_ms"] == FFB + 60_000


def test_W2_a_push_with_no_rows_still_moves_the_proof(live):
    _push(FFB, [])
    assert bls._state["watermark_ms"] == FFB
