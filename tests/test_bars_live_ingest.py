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
