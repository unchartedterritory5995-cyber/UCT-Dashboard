"""get_earnings_intel's `consensus` leg — FMP `stable/grades-consensus`
primary, Finnhub `/stock/recommendation` fallback (data-dependability
migration plan, Task 5, first call site).

Mirrors the structure of test_earnings_intel_price_target_fallback.py (the
Task 6 precedent this task follows) but drives the CONSENSUS leg specifically
via the real _fh_get/_fh_take_token path so token-bucket accounting is real.
"""
from unittest.mock import patch

import pytest

from api.services import earnings_estimates as ee
from api.services import finnhub_client as fhc
from api.services.cache import cache

SYM = "CONSFMP"
KEY = f"earnings_intel_{SYM}"

_EARNINGS = [
    {"period": "2026-06-30", "actual": 8.17, "estimate": 6.25,
     "surprisePercent": 30.7, "quarter": 2, "year": 2026},
]
_FH_REC = [{"period": "2026-08-01", "strongBuy": 5, "buy": 10, "hold": 3, "sell": 1, "strongSell": 0}]
_PT = {"targetHigh": 500.0, "targetLow": 300.0, "targetMean": 420.0,
       "targetMedian": 415.0, "lastUpdated": "2026-08-01"}
_FMP_CONSENSUS_ROW = [{"symbol": SYM, "strongBuy": 2, "buy": 40, "hold": 15,
                        "sell": 3, "strongSell": 1, "consensus": "Buy"}]


class _Resp:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload if payload is not None else []

    def raise_for_status(self):
        if self.status_code >= 400:
            raise Exception(f"{self.status_code} error")

    def json(self):
        return self._payload


@pytest.fixture(autouse=True)
def _reset_state(monkeypatch):
    monkeypatch.setenv("FINNHUB_API_KEY", "test-key")
    monkeypatch.setenv("FMP_API_KEY", "test-fmp-key")
    fhc._fh_cooldown_until = 0.0
    fhc._fh_bucket_tokens = fhc._FH_RATE_LIMIT_PER_MIN
    fhc._fh_bucket_updated = ee._time.monotonic()
    cache.invalidate(KEY)
    yield
    fhc._fh_cooldown_until = 0.0
    fhc._fh_bucket_tokens = fhc._FH_RATE_LIMIT_PER_MIN
    fhc._fh_bucket_updated = ee._time.monotonic()
    cache.invalidate(KEY)


def _fh_responder(*, earnings_ok=True, rec_ok=True, pt_ok=True):
    def fake_get(url, params=None, timeout=None):
        assert "financialmodelingprep.com" not in url, "Finnhub responder hit an FMP URL"
        if "/stock/earnings" in url:
            return _Resp(200, _EARNINGS) if earnings_ok else _Resp(500)
        if "recommendation" in url:
            return _Resp(200, _FH_REC) if rec_ok else _Resp(500)
        if "price-target" in url:
            return _Resp(200, _PT) if pt_ok else _Resp(500)
        return _Resp(500)
    return fake_get


def test_fmp_consensus_used_when_available_finnhub_never_called(monkeypatch):
    monkeypatch.setattr(ee.requests, "get", _fh_responder())
    calls = []

    def fake_fmp_get(path, params, timeout=10):
        calls.append(path)
        if path == "/stable/grades-consensus":
            return _FMP_CONSENSUS_ROW
        return None  # price-target-consensus fallback never needed here (Finnhub pt_ok=True)

    monkeypatch.setattr(ee, "_fmp_get", fake_fmp_get)
    result = ee.get_earnings_intel(SYM)

    assert result["consensus"] == {
        "buy": 40, "hold": 15, "sell": 3, "strongBuy": 2, "strongSell": 1, "period": "",
    }
    # Finnhub /stock/recommendation must never have been requested.
    assert "/stable/grades-consensus" in calls


def test_falls_back_to_finnhub_when_fmp_consensus_unusable(monkeypatch):
    monkeypatch.setattr(ee.requests, "get", _fh_responder(pt_ok=True))
    monkeypatch.setattr(ee, "_fmp_get", lambda path, params, timeout=10: None)

    result = ee.get_earnings_intel(SYM)

    assert result["consensus"] == {
        "buy": 10, "hold": 3, "sell": 1, "strongBuy": 5, "strongSell": 0,
        "period": "2026-08-01",
    }


def test_fmp_consensus_call_never_consumes_a_finnhub_token(monkeypatch):
    monkeypatch.setattr(ee.requests, "get", _fh_responder())
    monkeypatch.setattr(ee, "_fmp_get",
                         lambda path, params, timeout=10: _FMP_CONSENSUS_ROW if path == "/stable/grades-consensus" else None)

    before = fhc._fh_bucket_tokens
    ee.get_earnings_intel(SYM)
    after = fhc._fh_bucket_tokens

    # beat_history (Finnhub, not yet migrated) is the only Finnhub leg that
    # should fire here — consensus resolved via FMP, price_target resolved
    # via Finnhub (pt_ok=True) = 2 Finnhub tokens total, never a 3rd for
    # a redundant /stock/recommendation call.
    assert abs((before - after) - 2.0) < 0.05
