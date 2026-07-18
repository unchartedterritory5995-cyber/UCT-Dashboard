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


class _Client2:
    """Batch entry with a spurious todaysChangePerc == 0 (weekend / stale)."""
    _api_key = "k"

    def __init__(self, day_c, prev_c):
        self._day_c, self._prev_c = day_c, prev_c

    def _get(self, url, timeout=None):
        return {"tickers": [{
            "ticker": "MU",
            "day": {"c": self._day_c, "o": self._day_c, "h": self._day_c, "l": self._day_c, "v": 100},
            "prevDay": {"c": self._prev_c},
            "lastTrade": {"p": self._day_c},
            "todaysChangePerc": 0,
            "todaysChange": 0,
        }]}


def test_change_pct_recomputed_from_closes_when_zero():
    # Massive returns todaysChangePerc == 0 but a real move exists in the closes →
    # recompute so consumers don't flash to 0.00%.
    out = lp._fetch_snapshots(_Client2(11.0, 10.0), ["MU"], "regular")
    assert out["MU"]["change_pct"] == 10.0   # (11-10)/10*100
    assert out["MU"]["change"] == 1.0


def test_change_pct_genuine_flat_stays_zero():
    out = lp._fetch_snapshots(_Client2(10.0, 10.0), ["MU"], "regular")
    assert out["MU"]["change_pct"] == 0.0    # day_c == prev_c → an honest flat


def test_change_pct_trusts_real_nonzero():
    out = lp._fetch_snapshots(_FakeClient(10.0), ["AAPL"], "regular")
    assert out["AAPL"]["change_pct"] == 1.0  # todaysChangePerc trusted verbatim
