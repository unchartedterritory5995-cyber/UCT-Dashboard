"""TERM-055 / FB-D5-01 second observable: `_is_intraday_stale()` is NOT the split detector.

The ledger (CLAUDE.md "Stale intraday detection") said the 5-day staleness floor
"catches pre-split bars". Measured here against the real fetch chain: a split inside a
FRESH payload never trips it, adjusted or not. The floor answers one question -- is the
newest bar older than 5 days -- and a split is a question about the middle of the series.
Split detection is `bars_sanitize.unadjusted_splits` (the one detector) on D/W/M.
"""
from __future__ import annotations

import time

import pytest

from api.services import bars_fetch
from api.services import source_circuit_breaker as scb


def _fresh_series(split_at: int, factor: float, n: int = 60, adjusted: bool = True):
    """n 30-minute bars ending now; a `factor`-for-1 split at bar `split_at`."""
    now = int(time.time()) // 1800 * 1800
    out = []
    for i in range(n):
        px = 50.0 if (adjusted or i >= split_at) else 50.0 * factor
        out.append({"t": now - (n - 1 - i) * 1800, "o": px, "h": px * 1.002,
                    "l": px * 0.998, "c": px, "v": 1000})
    return out


@pytest.fixture
def chain(monkeypatch):
    calls = []
    monkeypatch.setattr(scb, "is_ok", lambda src: True)
    monkeypatch.setattr(scb, "record_attempt", lambda *a, **k: None)

    def fallback(name):
        def f(ticker, tf, bars):
            calls.append(name)
            return _fresh_series(30, 2.0)
        return f

    monkeypatch.setattr(bars_fetch, "_fetch_intraday_fmp", fallback("fmp"))
    monkeypatch.setattr(bars_fetch, "_fetch_intraday_yfinance", fallback("yfinance"))
    return calls


@pytest.mark.parametrize("adjusted", [True, False], ids=["vendor-adjusted", "unadjusted-cliff"])
def test_a_split_in_a_fresh_payload_does_not_trigger_the_staleness_fallback(
        chain, monkeypatch, adjusted):
    payload = _fresh_series(30, 2.0, adjusted=adjusted)
    monkeypatch.setattr(bars_fetch, "_fetch_intraday_massive", lambda t, tf, b: payload)
    assert bars_fetch._is_intraday_stale(payload) is False
    got = bars_fetch.fetch_with_validation(
        "SPLT", "30", 60, expected_session=bars_fetch._payload_last_session_yyyymmdd(payload))
    assert got is payload
    assert chain == []                       # no alternate source was consulted


def test_control_a_series_that_STOPPED_is_what_the_floor_catches(chain, monkeypatch):
    """Non-vacuity: the floor can fire, and the chain does escalate, when the newest
    bar really is old -- so the test above is not passing because nothing ever does."""
    old = _fresh_series(30, 2.0)
    for b in old:
        b["t"] -= 30 * 86400
    assert bars_fetch._is_intraday_stale(old) is True
    monkeypatch.setattr(bars_fetch, "_fetch_intraday_massive", lambda t, tf, b: old)
    bars_fetch.fetch_with_validation(
        "GONE", "30", 60,
        expected_session=bars_fetch._payload_last_session_yyyymmdd(_fresh_series(30, 2.0)))
    assert chain and chain[0] == "fmp"
