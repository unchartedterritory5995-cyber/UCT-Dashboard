"""PACKET-S CP2 — FRED cache TTL tightened from 1800s to 300s (RG-21 §1b)."""
import time
from unittest.mock import patch, MagicMock

import pytest

from api.services import fred_economic


@pytest.fixture(autouse=True)
def _key(monkeypatch):
    monkeypatch.setenv("FRED_API_KEY", "test-fred-key")


@pytest.fixture(autouse=True)
def _clear_cache():
    fred_economic._CACHE.clear()
    yield
    fred_economic._CACHE.clear()


def _fred_resp():
    r = MagicMock()
    r.raise_for_status.return_value = None
    r.json.return_value = {
        "observations": [
            {"date": "2026-09-01", "value": "3.1"},
            {"date": "2026-08-01", "value": "3.0"},
        ]
    }
    return r


def test_cache_ttl_constant_is_300_seconds():
    assert fred_economic._CACHE_TTL == 300


def test_cache_ttl_is_no_longer_the_old_1800_value():
    # Control: proves this test would have FAILED against the pre-fix constant
    # — a bare "== 300" assertion alone can't distinguish "tightened" from
    # "changed to something else that happens to be 300 already".
    assert fred_economic._CACHE_TTL != 1800
    assert fred_economic._CACHE_TTL < 1800


def test_get_series_populates_cache_with_a_300s_window_not_1800s():
    now = time.time()
    with patch("requests.get", return_value=_fred_resp()):
        result = fred_economic.get_series("cpi", periods=2)
    assert "error" not in result

    cache_key = "fred::CPIAUCSL::2"
    value, expires_at = fred_economic._CACHE._store[cache_key]
    ttl_actually_set = expires_at - now

    # Within a few seconds of 300s (test execution jitter), and nowhere near
    # the old 1800s window — this is the control: the old constant would fail
    # the upper-bound assertion.
    assert 290 <= ttl_actually_set <= 310
    assert ttl_actually_set < 1800


def test_second_call_within_ttl_is_served_from_cache_not_refetched():
    with patch("requests.get", return_value=_fred_resp()) as g:
        fred_economic.get_series("cpi", periods=2)
        fred_economic.get_series("cpi", periods=2)
    assert g.call_count == 1
