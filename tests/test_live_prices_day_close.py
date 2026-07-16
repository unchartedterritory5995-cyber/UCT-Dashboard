"""`/api/live-prices` payload carries day_close (today's regular-session close,
null pre-market) — powers the RH-style After-Hours split on the journal hero."""
from __future__ import annotations

from api.routers import live_prices as lp


class _FakeClient:
    _api_key = "k"

    def __init__(self, day_c):
        self._day_c = day_c

    def _get(self, url, timeout=None):
        return {"tickers": [{
            "ticker": "AAPL",
            "day": {"c": self._day_c, "o": 1, "h": 2, "l": 0.5, "v": 100},
            "prevDay": {"c": 9.5},
            "lastTrade": {"p": 10.2},
            "todaysChangePerc": 1.0,
            "todaysChange": 0.1,
        }]}


def test_day_close_present_when_session_traded():
    out = lp._fetch_snapshots(_FakeClient(10.0), ["AAPL"], "regular")
    assert out["AAPL"]["day_close"] == 10.0


def test_day_close_null_premarket():
    out = lp._fetch_snapshots(_FakeClient(0), ["AAPL"], "pre_market")
    assert out["AAPL"]["day_close"] is None
    # ext fields still work pre-market
    assert out["AAPL"]["ext_price"] == 10.2
    assert out["AAPL"]["ext_session"] == "pre_market"
