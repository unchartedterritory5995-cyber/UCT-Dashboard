"""A PARTIAL intel fetch must not be cached as if it were complete.

`get_earnings_intel` composes three independent Finnhub legs (beat_history,
consensus, price_target). The negative cache is correctly conservative — it
only fires when ALL THREE fail. But the positive branch used to store whatever
it got for `_CACHE_TTL` (6 HOURS), so one transient miss on the /stock/earnings
leg (while the other two answered) pinned `beat_history: []` on that symbol for
six hours.

That is not a cosmetic gap downstream: it is the earnings modal's entire
Earnings History section rendering "No reported quarters yet" for a company
that has plainly reported. Observed live 2026-08-04 — enrichment returned CAT
with 4 quarters, then 0 minutes later, while a direct Finnhub call for CAT was
HTTP 200 with 4 rows. Same class as the market-cap cache poison already
documented in this repo: never cache a failed fetch as a value.

A partial result is still worth SERVING (dropping it would discard good
consensus/price-target data) — it just has to expire on the short failure TTL
so the missing leg self-heals in minutes.
"""
from unittest.mock import patch

import pytest

from api.services import earnings_estimates as ee
from api.services.cache import cache

SYM = "PARTIALQ"
KEY = f"earnings_intel_{SYM}"

_EARNINGS = [
    {"period": "2026-06-30", "actual": 8.17, "estimate": 6.25,
     "surprisePercent": 30.7, "quarter": 2, "year": 2026},
]
_REC = [{"period": "2026-08-01", "strongBuy": 5, "buy": 10, "hold": 3, "sell": 1, "strongSell": 0}]
_PT = {"targetHigh": 500.0, "targetLow": 300.0, "targetMean": 420.0,
       "targetMedian": 415.0, "lastUpdated": "2026-08-01"}


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
    ee._fh_cooldown_until = 0.0
    cache.invalidate(KEY)
    yield
    ee._fh_cooldown_until = 0.0
    cache.invalidate(KEY)


def _responder(*, earnings_ok=True, rec_ok=True, pt_ok=True):
    def fake_get(url, params=None, timeout=None):
        if "/stock/earnings" in url:
            return _Resp(200, _EARNINGS) if earnings_ok else _Resp(500)
        if "recommendation" in url:
            return _Resp(200, _REC) if rec_ok else _Resp(500)
        if "price-target" in url:
            return _Resp(200, _PT) if pt_ok else _Resp(500)
        return _Resp(500)
    return fake_get


def _captured_ttl(monkeypatch, responder):
    """Run get_earnings_intel and return (result, ttl_it_cached_with)."""
    seen = {}
    real_set = cache.set

    def spy(key, value, ttl=None, **kw):
        if key == KEY:
            seen["ttl"] = ttl
            seen["value"] = value
        return real_set(key, value, ttl, **kw) if ttl is not None else real_set(key, value, **kw)

    monkeypatch.setattr(ee.requests, "get", responder)
    monkeypatch.setattr(cache, "set", spy)
    result = ee.get_earnings_intel(SYM)
    return result, seen.get("ttl")


def test_a_complete_fetch_is_cached_for_the_full_ttl(monkeypatch):
    result, ttl = _captured_ttl(monkeypatch, _responder())
    assert len(result["beat_history"]) == 1
    assert result["consensus"] is not None
    assert result["price_target"] is not None
    assert ttl == ee._CACHE_TTL          # 6h is correct ONLY when nothing failed


def test_a_missing_beat_history_leg_is_not_pinned_for_six_hours(monkeypatch):
    """THE regression: the /stock/earnings leg fails, the other two answer."""
    result, ttl = _captured_ttl(monkeypatch, _responder(earnings_ok=False))
    # the good legs are still served — we do not throw away real data
    assert result is not None
    assert result["consensus"] is not None
    assert result["price_target"] is not None
    # ...but the empty history must expire in minutes, not hours
    assert result["beat_history"] == []
    assert ttl == ee._INTEL_FAIL_TTL
    assert ttl < ee._CACHE_TTL


def test_a_missing_consensus_leg_also_shortens_the_ttl(monkeypatch):
    result, ttl = _captured_ttl(monkeypatch, _responder(rec_ok=False))
    assert len(result["beat_history"]) == 1      # good leg still served
    assert result["consensus"] is None
    assert ttl == ee._INTEL_FAIL_TTL


def test_a_missing_price_target_leg_also_shortens_the_ttl(monkeypatch):
    result, ttl = _captured_ttl(monkeypatch, _responder(pt_ok=False))
    assert result["price_target"] is None
    assert ttl == ee._INTEL_FAIL_TTL


def test_all_three_failing_still_negative_caches_and_returns_none(monkeypatch):
    """The pre-existing 429-storm damper must be untouched by this change."""
    result, ttl = _captured_ttl(
        monkeypatch, _responder(earnings_ok=False, rec_ok=False, pt_ok=False))
    assert result is None
    assert ttl == ee._INTEL_FAIL_TTL
