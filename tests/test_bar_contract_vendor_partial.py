"""The forming bucket on a FIRST /api/bars answer (bar_contract._vendor_partial).

Owner 2026-11-23: "as soon as someone opens a different ticker or switches to a different stock
on an intraday time frame, that current candle should be completely accurate as if they were
already watching it. It should not change." The store holds closed minutes only, so a first
answer used to stop one bucket short; the vendor's minute aggregates of the bucket so far are
added as `developing`, only where the answer already runs up to that bucket.
"""
from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from api.services import bar_contract as bc
from api.services import bars_fetch as bf

ET = ZoneInfo("America/New_York")


def et(h, mi, s=0):
    return int(datetime(2026, 11, 23, h, mi, s, tzinfo=ET).timestamp())


def row(t, o=10.0, c=10.5):
    return {"t": t, "o": o, "h": max(o, c), "l": min(o, c), "c": c, "v": 100}


@pytest.fixture
def vendor(monkeypatch):
    calls = []
    minutes = {}

    def fake(ticker, from_ms, to_ms, timeout=1.5):
        calls.append((ticker, from_ms, to_ms, timeout))
        if isinstance(minutes.get("raise"), Exception):
            raise minutes["raise"]
        return [m for m in minutes.get("rows", []) if from_ms // 1000 <= m["t"] <= to_ms // 1000]

    monkeypatch.setattr(bf, "fetch_minutes_between", fake)
    bc._VENDOR_PARTIAL_CACHE.clear()
    yield calls, minutes
    bc._VENDOR_PARTIAL_CACHE.clear()


def test_1m_first_answer_gets_the_vendor_minute_so_far(vendor):
    calls, minutes = vendor
    now = et(13, 45, 31)
    minutes["rows"] = [{"t": et(13, 45), "o": 11.0, "h": 11.4, "l": 10.9, "c": 11.2, "v": 700}]
    d = bc._vendor_partial("ZZA", "1", "rth", "eth-clock", [row(et(13, 43)), row(et(13, 44))], now)
    assert d is not None and d["t"] == et(13, 45)
    assert (d["o"], d["h"], d["l"], d["c"], d["v"]) == (11.0, 11.4, 10.9, 11.2, 700)
    assert d["rev"] == now * 1000
    assert calls[0][1] == et(13, 45) * 1000 and calls[0][2] == now * 1000


def test_5m_bucket_is_built_from_every_minute_so_far(vendor):
    calls, minutes = vendor
    now = et(13, 47, 10)
    minutes["rows"] = [
        {"t": et(13, 45), "o": 11.0, "h": 11.4, "l": 10.9, "c": 11.2, "v": 700},
        {"t": et(13, 46), "o": 11.2, "h": 11.9, "l": 11.1, "c": 11.8, "v": 300},
        {"t": et(13, 47), "o": 11.8, "h": 11.8, "l": 10.5, "c": 10.6, "v": 50},
    ]
    d = bc._vendor_partial("ZZA", "5", "rth", "eth-clock", [row(et(13, 40))], now)
    assert (d["t"], d["o"], d["h"], d["l"], d["c"], d["v"]) == (et(13, 45), 11.0, 11.9, 10.5, 10.6, 1050)


def test_no_bar_when_the_answer_does_not_reach_the_current_bucket(vendor):
    """A regular-session answer before the open (newest row = the previous close) must not gain
    a pre-market bar; nor an answer with a gap (no trade last minute)."""
    calls, minutes = vendor
    minutes["rows"] = [{"t": et(8, 12), "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}]
    assert bc._vendor_partial("ZZA", "1", "rth", "eth-clock", [row(et(7, 59))], et(8, 12, 30)) is None
    assert calls == [], "no vendor call when the bar would not belong to the answer"


def test_the_regular_open_bucket_is_filled_after_an_overnight_gap(vendor):
    calls, minutes = vendor
    minutes["rows"] = [{"t": et(9, 30), "o": 12.0, "h": 12.5, "l": 11.8, "c": 12.1, "v": 9000}]
    prev_close = int(datetime(2026, 11, 20, 15, 59, tzinfo=ET).timestamp())
    d = bc._vendor_partial("ZZA", "5", "rth", "eth-clock", [row(prev_close)], et(9, 31, 5))
    assert d is not None and d["t"] == et(9, 30) and d["o"] == 12.0


def test_an_answer_that_already_holds_the_current_bucket_is_left_alone(vendor):
    calls, _ = vendor
    assert bc._vendor_partial("ZZA", "1", "rth", "eth-clock", [row(et(13, 45))], et(13, 45, 20)) is None
    assert calls == []


def test_vendor_error_or_empty_never_invents_a_bar_and_is_cached_briefly(vendor):
    calls, minutes = vendor
    rows = [row(et(13, 44))]
    minutes["raise"] = RuntimeError("timeout")
    assert bc._vendor_partial("ZZA", "1", "rth", "eth-clock", rows, et(13, 45, 2)) is None
    assert bc._vendor_partial("ZZA", "1", "rth", "eth-clock", rows, et(13, 45, 2)) is None
    assert len(calls) == 1, "one vendor call per symbol/bucket per TTL"
    bc._VENDOR_PARTIAL_CACHE.clear()
    minutes["raise"] = None
    minutes["rows"] = []
    assert bc._vendor_partial("ZZA", "1", "rth", "eth-clock", rows, et(13, 45, 2)) is None


def test_daily_and_delta_answers_never_call_the_vendor(vendor):
    calls, _ = vendor
    assert bc._vendor_partial("ZZA", "D", None, "rth", [row("2026-11-20")], et(13, 45)) is None
    assert calls == []
