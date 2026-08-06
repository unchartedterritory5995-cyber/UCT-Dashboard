"""P2 T8b — `beat_history` carries Finnhub's own `quarter`/`year` (the fiscal
identity `implied_store` and `earningsHistoryModel.js` pair on), purely
additive on top of the existing period/actual/estimate/beat/surprise fields.

Covers: fields present + correctly typed when Finnhub sends them, absent
(None, never a phantom 0) when it doesn't, and a genuine `0` surviving rather
than being flattened to None (the `Number(null) === 0` trap, backend side).
"""
from unittest.mock import patch

import pytest

from api.services import earnings_estimates as ee
from api.services import finnhub_client as fhc
from api.services.cache import cache


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
    fhc._fh_cooldown_until = 0.0
    yield
    fhc._fh_cooldown_until = 0.0
    cache.invalidate("earnings_intel_FISCALQ")


def _fake_get_factory(stock_earnings_payload):
    def fake_get(url, params=None, timeout=None):
        if "/stock/earnings" in url:
            return _Resp(200, stock_earnings_payload)
        return _Resp(500)
    return fake_get


def test_beat_history_carries_quarter_and_year_when_finnhub_sends_them(monkeypatch):
    cache.invalidate("earnings_intel_FISCALQ")
    monkeypatch.setattr(ee.requests, "get", _fake_get_factory([
        {"period": "2025-12-31", "actual": 2.01, "estimate": 1.99,
         "surprisePercent": 1.0, "quarter": 1, "year": 2026},
    ]))
    intel = ee.get_earnings_intel("FISCALQ")
    row = intel["beat_history"][0]
    assert row["quarter"] == 1
    assert row["year"] == 2026
    # existing fields are untouched by the addition
    assert row["period"] == "2025-12-31"
    assert row["actual"] == 2.01
    assert row["beat"] is True


def test_beat_history_quarter_year_absent_stay_none_not_phantom_zero(monkeypatch):
    cache.invalidate("earnings_intel_FISCALQ")
    monkeypatch.setattr(ee.requests, "get", _fake_get_factory([
        {"period": "2025-12-31", "actual": 2.01, "estimate": 1.99, "surprisePercent": 1.0},
    ]))
    intel = ee.get_earnings_intel("FISCALQ")
    row = intel["beat_history"][0]
    assert row["quarter"] is None
    assert row["year"] is None


class TestIntOrNone:
    """`_int_or_none` is the guard that keeps this additive: absent stays
    None, a genuine 0 survives, in both directions."""

    def test_none_stays_none(self):
        assert ee._int_or_none(None) is None

    def test_genuine_zero_survives(self):
        assert ee._int_or_none(0) == 0

    def test_coerces_a_real_int(self):
        assert ee._int_or_none(3) == 3

    def test_unparseable_value_is_none_not_a_crash(self):
        assert ee._int_or_none("not-a-number") is None
