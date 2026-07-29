"""A momentarily-empty `lastTrade` must NOT drop the extended-hours session.

Massive's snapshot intermittently returns an empty `lastTrade` for a thin
pre/post name. Before `_EXT_LAST`, that poll shipped `ext_price: None` +
`ext_session: None` while `price` fell through to day.c / prevDay.c — the RTH
or PRIOR close. The chart's live-tick writer then folded that stale close into
the developing pre-market candle: a wick shooting down to the SAME price every
few seconds, the right-axis tag snapping to it, then both reverting on the next
good poll (the "ghost wick" report, 2026-07-29).
"""
from __future__ import annotations

from api.routers import live_prices as lp


class _FlappyClient:
    """Same ticker, but `lastTrade` can be present or empty per call."""
    _api_key = "k"

    def __init__(self, last_p):
        self._last_p = last_p

    def _get(self, url, timeout=None):
        return {"tickers": [{
            "ticker": "SNXX",
            # Pre-market: no day aggregate yet, so `price` would fall through.
            "day": {"o": 0, "h": 0, "l": 0, "c": 0, "v": 0},
            "prevDay": {"c": 8.04},
            "lastTrade": ({"p": self._last_p} if self._last_p else {}),
            "todaysChangePerc": 0.75,
            "todaysChange": 0.06,
        }]}


def _clear():
    lp._EXT_LAST.clear()


def test_ext_hole_reserves_last_known_print():
    _clear()
    # Good poll — establishes the pre-market print.
    first = lp._fetch_snapshots(_FlappyClient(8.10), ["SNXX"], "pre_market")
    assert first["SNXX"]["ext_price"] == 8.10
    assert first["SNXX"]["ext_session"] == "pre_market"

    # Next poll: Massive returns an EMPTY lastTrade. The session must survive.
    hole = lp._fetch_snapshots(_FlappyClient(None), ["SNXX"], "pre_market")
    assert hole["SNXX"]["ext_session"] == "pre_market", (
        "an empty lastTrade must never read as 'the extended session ended' — "
        "that is what sent the chart back to the prior close for one tick"
    )
    assert hole["SNXX"]["ext_price"] == 8.10

    # And the recovery poll picks the new print straight back up.
    back = lp._fetch_snapshots(_FlappyClient(8.13), ["SNXX"], "pre_market")
    assert back["SNXX"]["ext_price"] == 8.13


def test_ext_memo_does_not_leak_across_sessions():
    _clear()
    lp._fetch_snapshots(_FlappyClient(8.10), ["SNXX"], "pre_market")
    # A post-market hole must NOT be filled with the pre-market print.
    out = lp._fetch_snapshots(_FlappyClient(None), ["SNXX"], "post_market")
    assert out["SNXX"]["ext_session"] is None
    assert out["SNXX"]["ext_price"] is None


def test_ext_memo_never_applies_in_regular_hours():
    _clear()
    lp._fetch_snapshots(_FlappyClient(8.10), ["SNXX"], "pre_market")
    out = lp._fetch_snapshots(_FlappyClient(8.20), ["SNXX"], "regular")
    assert out["SNXX"]["ext_session"] is None
    assert out["SNXX"]["ext_price"] is None
