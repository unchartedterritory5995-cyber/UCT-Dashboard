"""Silence means different things at 10:30 and at 02:00.

The Finnhub watchdog forced a full reconnect + resubscribe after 45s of no
messages while tickers were subscribed. During regular hours that is right —
trades flow constantly, so silence means a dead-but-open socket. Outside them
silence is the NORMAL state, and the rule turned it into a reconnect every ~60s
all night, on the pod that serves members (observed on prod 2026-08-29):

    [stream] No Finnhub messages for 45s with 5 active subs — feed silent, forcing reconnect
    [stream] Connecting to Finnhub WebSocket...
    [stream] Re-subscribed 5 active tickers on reconnect

The watchdog is KEPT — a socket that dies at 02:00 must still be caught before
the open. It is the tolerance that becomes market-aware. So the pair of facts
worth pinning is: quiet hours tolerate many windows, AND regular hours still
react to the first one.
"""
from __future__ import annotations

import inspect
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from api.services import realtime_stream as rs
from api.services.bars_liveness import is_market_open

ET = ZoneInfo("America/New_York")


def test_regular_hours_still_react_to_the_very_first_silent_window():
    """The discriminating half: making it lazy everywhere would hide a dead feed.

    If this ever needs relaxing, it is a real trade-off — during RTH a silent
    socket is a user-visible outage of live prices.
    """
    src = inspect.getsource(rs._run_websocket)
    assert "tolerance = 1 if is_market_open() else" in src, (
        "the RTH tolerance is no longer 1 — a dead feed during the session would "
        "go unnoticed for multiple windows"
    )


def test_closed_hours_tolerate_many_windows_before_reconnecting():
    assert rs._CLOSED_SILENCE_WINDOWS >= 5, (
        f"{rs._CLOSED_SILENCE_WINDOWS} windows is not enough tolerance to stop the "
        "overnight reconnect churn"
    )
    quiet_minutes = rs._CLOSED_SILENCE_WINDOWS * rs._RECV_TIMEOUT_S / 60.0
    assert quiet_minutes >= 5, (
        f"only {quiet_minutes:.1f} min of tolerated quiet — still reconnecting "
        "several times an hour overnight"
    )
    # …but not so lazy that a socket dying overnight is missed before the open.
    assert quiet_minutes <= 30, (
        f"{quiet_minutes:.1f} min is too long — a feed that dies overnight would "
        "still be dead at the bell"
    )


def test_the_counter_resets_on_traffic():
    """Otherwise windows accumulate across a quiet stretch and reconnect anyway."""
    src = inspect.getsource(rs._run_websocket)
    recv_at = src.index("raw_msg = await asyncio.wait_for")
    reset_at = src.index("silent_windows = 0", recv_at)
    warn_at = src.index("feed silent, forcing reconnect")
    assert reset_at > warn_at, (
        "silent_windows is not reset after a successful receive — a busy feed "
        "with occasional gaps would still churn"
    )


def test_the_counter_starts_fresh_on_every_connect():
    src = inspect.getsource(rs._run_websocket)
    connect_at = src.index("Finnhub WebSocket connected")
    init_at = src.index("silent_windows = 0", connect_at)
    warn_at = src.index("feed silent, forcing reconnect")
    assert init_at < warn_at, (
        "silent_windows is not initialised at connect time — it would carry over "
        "from the previous session (or NameError on the first timeout)"
    )


# ── the helper this now depends on has to mean what the fix assumes ─────────


@pytest.mark.parametrize("moment,expected", [
    (datetime(2026, 8, 26, 10, 30, tzinfo=ET), True),    # Wed mid-session
    (datetime(2026, 8, 26, 9, 30, tzinfo=ET), True),     # the bell
    (datetime(2026, 8, 26, 15, 59, tzinfo=ET), True),    # last minute
    (datetime(2026, 8, 26, 16, 0, tzinfo=ET), False),    # close
    (datetime(2026, 8, 26, 8, 0, tzinfo=ET), False),     # pre-market
    (datetime(2026, 8, 26, 2, 0, tzinfo=ET), False),     # overnight
    (datetime(2026, 8, 29, 11, 0, tzinfo=ET), True),     # Saturday? no — Sat is 8/29/2026
])
def test_is_market_open_boundaries(moment, expected):
    """The fix is only as good as this predicate, so pin its edges.

    ⚠️ 2026-08-29 is a SATURDAY, so the last case asserts the weekend rule, not
    a weekday one — spelled out because a date-based fixture that quietly means
    something else is how these rot.
    """
    if moment.weekday() >= 5:
        expected = False
    assert is_market_open(moment) is expected


def test_extended_hours_are_treated_as_closed_by_this_predicate():
    """Documents a KNOWN trade-off rather than pretending it away.

    `is_market_open` is 09:30-16:00 only, so pre/post-market get the lazy
    tolerance even though real (thin) trades occur then. That is deliberate: the
    volume is low enough that 45s gaps are ordinary, and the cost of the lazy
    path is a delayed reconnect, not a missed trade — the socket still delivers
    whatever arrives.
    """
    assert is_market_open(datetime(2026, 8, 26, 8, 0, tzinfo=ET)) is False
    assert is_market_open(datetime(2026, 8, 26, 18, 0, tzinfo=ET)) is False
