"""Universe live bars, web side (2026-10-14): minute bars roll into exact 5m buckets,
and a bucket that began before the socket connected is never forwarded."""
import json

import pytest

from api.services import bar_stream, bars_live_ingest as ing

T0 = 1_791_990_000  # a 5m boundary (unix seconds)


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    monkeypatch.setenv("BARS_UNIVERSE_STREAM_ENABLED", "1")
    ing._reset_for_tests()
    yield
    ing._reset_for_tests()


def _am(sym, minute_s, o, h, l, c, v):
    ing.on_am(sym, {"t": minute_s * 1000, "o": o, "h": h, "l": l, "c": c, "v": v})


def test_minutes_roll_into_one_exact_5m_bucket():
    ing.mark_connected(now_ms=(T0 - 10) * 1000)   # first full bucket = T0
    _am("AAA", T0, 10, 11, 9.5, 10.5, 100)
    _am("AAA", T0 + 60, 10.5, 12, 10, 11, 200)
    _am("AAA", T0 + 240, 11, 11.5, 8, 9, 50)
    p = ing.take_payload()
    assert p["rows"] == [["AAA", T0, 10.0, 12.0, 8.0, 9.0, 350]]
    assert p["first_full_bucket_ms"] == T0 * 1000


def test_a_repeated_minute_replaces_itself_rather_than_double_counting():
    ing.mark_connected(now_ms=(T0 - 10) * 1000)
    _am("AAA", T0, 10, 11, 9, 10, 100)
    _am("AAA", T0, 10, 11, 9, 10, 100)
    assert ing.take_payload()["rows"][0][6] == 100


def test_a_bucket_that_began_before_the_socket_is_never_forwarded():
    ing.mark_connected(now_ms=(T0 + 30) * 1000)    # mid-bucket: next full bucket T0+300
    _am("AAA", T0 + 60, 10, 11, 9, 10, 100)
    _am("AAA", T0 + 300, 10, 11, 9, 10, 100)
    rows = ing.take_payload()["rows"]
    assert [r[1] for r in rows] == [T0 + 300]


def test_class_shares_are_stored_under_the_hyphen_form():
    ing.mark_connected(now_ms=(T0 - 10) * 1000)
    _am("BRK.B", T0, 1, 1, 1, 1, 1)
    assert ing.take_payload()["rows"][0][0] == "BRK-B"


def test_a_reconnect_drops_everything_held_for_the_old_socket():
    ing.mark_connected(now_ms=(T0 - 10) * 1000)
    _am("AAA", T0, 1, 1, 1, 1, 1)
    ing.mark_connected(now_ms=(T0 + 400) * 1000)
    assert ing.take_payload()["rows"] == []


def test_under_the_universe_feed_per_symbol_subscribes_drop_AM():
    msg = json.loads(bar_stream._build_subscribe_message(["AAPL"]))
    assert msg["params"] == "A.AAPL,T.AAPL"
    un = json.loads(bar_stream._build_unsubscribe_message(["AAPL"]))
    assert "AM.AAPL" not in un["params"]


def test_with_the_flag_off_subscribes_are_unchanged(monkeypatch):
    monkeypatch.delenv("BARS_UNIVERSE_STREAM_ENABLED", raising=False)
    msg = json.loads(bar_stream._build_subscribe_message(["AAPL"]))
    assert msg["params"] == "AM.AAPL,A.AAPL,T.AAPL"


# ── continuity across reconnects and tier restarts (2026-10-14 evening) ──────────

def test_the_boundary_bucket_goes_out_as_minutes_not_as_a_row():
    ing.mark_connected(now_ms=(T0 + 30) * 1000)     # socket opened inside bucket T0
    _am("AAA", T0 + 60, 10, 11, 9, 10, 100)
    _am("AAA", T0 + 120, 10, 12, 9, 11, 50)
    p = ing.take_payload()
    assert p["rows"] == []
    assert p["minutes"] == [["AAA", T0 + 60, 10.0, 11.0, 9.0, 10.0, 100],
                            ["AAA", T0 + 120, 10.0, 12.0, 9.0, 11.0, 50]]


def test_seq_counts_acknowledged_flushes_and_resets_with_the_epoch():
    ing.mark_connected(now_ms=(T0 - 10) * 1000)
    p1 = ing.take_payload()
    assert p1["seq"] == 1
    ing.flushed(p1, {"accepted": 0})
    assert ing.take_payload()["seq"] == 2
    ing.mark_connected(now_ms=(T0 + 400) * 1000)
    assert ing.take_payload()["seq"] == 1


def test_a_resync_reply_starts_a_new_epoch_keeping_the_current_bucket_minutes():
    ing.mark_connected(now_ms=(T0 - 10) * 1000)
    _am("AAA", T0, 10, 11, 9, 10, 100)
    _am("AAA", T0 + 60, 10, 13, 9, 12, 40)
    p = ing.take_payload()
    old_epoch = p["epoch_ms"]
    ing.resync(now_ms=(T0 + 90) * 1000)
    q = ing.take_payload()
    assert q["epoch_ms"] != old_epoch and q["seq"] == 1
    assert q["first_full_bucket_ms"] == (T0 + 300) * 1000
    assert [m[1] for m in q["minutes"]] == [T0, T0 + 60]   # nothing the socket saw is lost
    assert q["rows"] == []


def test_the_flusher_obeys_a_resync_reply():
    ing.mark_connected(now_ms=(T0 - 10) * 1000)
    p = ing.take_payload()
    ing.flushed(p, {"accepted": 0, "resync": True})
    assert ing.status()["resyncs"] == 1
    assert ing.take_payload()["epoch_ms"] != p["epoch_ms"]


def test_an_unacknowledged_bucket_is_never_pruned():
    ing.mark_connected(now_ms=(T0 - 10) * 1000)
    for k in range(5):                              # five buckets, no flush succeeds
        _am("AAA", T0 + 300 * k, 1, 1, 1, 1, 1)
    rows = ing.take_payload()["rows"]
    assert sorted(r[1] for r in rows) == [T0 + 300 * k for k in range(5)]


def test_a_failed_flush_resends_everything_it_carried():
    ing.mark_connected(now_ms=(T0 - 10) * 1000)
    _am("AAA", T0, 1, 1, 1, 1, 1)
    p = ing.take_payload()
    for k in range(1, 5):                           # buckets keep closing while in flight
        _am("AAA", T0 + 300 * k, 1, 1, 1, 1, 1)
    ing.requeue(p)
    rows = ing.take_payload()["rows"]
    assert T0 in [r[1] for r in rows]


def test_holding_too_many_unflushed_buckets_starts_a_new_epoch():
    ing.mark_connected(now_ms=(T0 - 10) * 1000)
    e0 = ing.take_payload()["epoch_ms"]
    for k in range(ing.MAX_HELD_BUCKETS + 2):
        _am("AAA", T0 + 300 * k, 1, 1, 1, 1, 1)
    assert ing.status()["overflows"] >= 1
    assert ing.take_payload()["epoch_ms"] != e0
