"""Tests for the next-earnings date helper in fundamentals."""
from __future__ import annotations

import time

import api.services.fundamentals as f


def test_next_earnings_picks_earliest_future():
    now = time.time()
    info = {
        "earningsTimestamp": now + 90 * 86400,        # 90d out
        "earningsTimestampStart": now + 30 * 86400,   # 30d out (earliest future)
        "earningsTimestampEnd": now + 31 * 86400,
    }
    iso = f._next_earnings_iso(info)
    assert iso is not None and len(iso) == 10  # YYYY-MM-DD
    # earliest future is the 30d one
    import datetime as _dt
    expected = _dt.datetime.fromtimestamp(now + 30 * 86400, tz=_dt.timezone.utc).strftime("%Y-%m-%d")
    assert iso == expected


def test_next_earnings_ignores_past():
    now = time.time()
    info = {"earningsTimestamp": now - 100 * 86400}  # last quarter, long past
    assert f._next_earnings_iso(info) is None


def test_next_earnings_allows_today_window():
    now = time.time()
    info = {"earningsTimestamp": now - 3600}  # a few hours ago (today) → still shown
    assert f._next_earnings_iso(info) is not None


def test_next_earnings_handles_missing_and_garbage():
    assert f._next_earnings_iso({}) is None
    assert f._next_earnings_iso({"earningsTimestamp": "not-a-number"}) is None
    assert f._next_earnings_iso({"earningsTimestamp": None}) is None
