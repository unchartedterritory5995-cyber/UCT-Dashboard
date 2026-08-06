"""FMP migration for the per-candidate analyst-action enrichment
(finnhub_recent_action / _fmp_recent_action) — Finnhub /stock/upgrade-downgrade
403s permanently on this plan (live-probed 2026-08-05); FMP stable/grades is
now the primary leg, Finnhub kept as a fallback.
"""
import time
from datetime import datetime, timedelta, timezone

import pytest

from api.services.catalyst import analyst_actions as aa


class _Resp:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload if payload is not None else []
        self.text = str(self._payload)

    def raise_for_status(self):
        if self.status_code >= 400:
            raise Exception(f"{self.status_code} error")

    def json(self):
        return self._payload


@pytest.fixture(autouse=True)
def _reset_finnhub_state(monkeypatch):
    """Isolate from other tests' shared Finnhub token-bucket / 403-memo state
    (api/services/finnhub_client.py is a process-wide singleton)."""
    from api.services import finnhub_client as fhc
    from api.services.cache import cache

    monkeypatch.setenv("FINNHUB_API_KEY", "test-fh-key")
    monkeypatch.setenv("FMP_API_KEY", "test-fmp-key")
    fhc._fh_cooldown_until = 0.0
    fhc._fh_bucket_tokens = fhc._FH_RATE_LIMIT_PER_MIN
    fhc._fh_bucket_updated = time.monotonic()
    cache.invalidate("fh_forbidden_/stock/upgrade-downgrade")
    yield
    fhc._fh_cooldown_until = 0.0
    fhc._fh_bucket_tokens = fhc._FH_RATE_LIMIT_PER_MIN
    fhc._fh_bucket_updated = time.monotonic()
    cache.invalidate("fh_forbidden_/stock/upgrade-downgrade")


def _mock_fmp_only(monkeypatch, rows):
    """FMP returns `rows`; a Finnhub call would mean the FMP leg failed to
    short-circuit it — fail loudly instead of silently falling through."""
    def fake_get(url, params=None, timeout=None):
        if "financialmodelingprep.com" in url:
            return _Resp(200, rows)
        raise AssertionError(f"unexpected network call (FMP should have satisfied this): {url}")
    monkeypatch.setattr("requests.get", fake_get)


def _iso(now: float, days_ago: int) -> str:
    d = datetime.fromtimestamp(now, tz=timezone.utc).date() - timedelta(days=days_ago)
    return d.isoformat()


# ── FMP leg: field-shape mapping ─────────────────────────────────────────────

def test_fmp_leg_maps_fields_and_lowercases_action(monkeypatch):
    now = time.time()
    _mock_fmp_only(monkeypatch, [
        {"symbol": "AAPL", "date": _iso(now, 0), "gradingCompany": "TD Cowen",
         "previousGrade": "Hold", "newGrade": "Buy", "action": "Upgrade"},
    ])
    result = aa.finnhub_recent_action("AAPL", within_hours=36, now=now)
    assert result is not None
    assert result["action"] == "upgrade"       # normalized lowercase, per _norm_meta
    assert result["firm"] == "TD Cowen"        # gradingCompany -> firm
    assert result["from_rating"] == "Hold"     # previousGrade -> from_rating
    assert result["to_rating"] == "Buy"        # newGrade -> to_rating
    assert result["at"] is not None


def test_fmp_leg_picks_newest_dated_row_not_list_order(monkeypatch):
    now = time.time()
    _mock_fmp_only(monkeypatch, [
        {"symbol": "V", "date": _iso(now, 1), "gradingCompany": "Older",
         "previousGrade": "Hold", "newGrade": "Hold", "action": "maintain"},
        {"symbol": "V", "date": _iso(now, 0), "gradingCompany": "Newer",
         "previousGrade": "Hold", "newGrade": "Buy", "action": "upgrade"},
    ])
    result = aa.finnhub_recent_action("V", within_hours=36, now=now)
    assert result["firm"] == "Newer"


# ── FMP leg: a row with no parseable date is EXCLUDED, not epoch-zeroed ─────

def test_row_with_no_date_excluded_not_treated_as_newest(monkeypatch):
    now = time.time()
    _mock_fmp_only(monkeypatch, [
        {"symbol": "AAPL", "date": None, "gradingCompany": "Dateless",
         "previousGrade": "Hold", "newGrade": "Strong Buy", "action": "upgrade"},
        {"symbol": "AAPL", "date": _iso(now, 0), "gradingCompany": "Dated",
         "previousGrade": "Hold", "newGrade": "Buy", "action": "maintain"},
    ])
    result = aa.finnhub_recent_action("AAPL", within_hours=36, now=now)
    assert result is not None
    assert result["firm"] == "Dated"


def test_all_rows_dateless_returns_none(monkeypatch):
    now = time.time()
    _mock_fmp_only(monkeypatch, [
        {"symbol": "AAPL", "date": None, "gradingCompany": "X",
         "previousGrade": "Hold", "newGrade": "Buy", "action": "upgrade"},
        {"symbol": "AAPL", "date": "", "gradingCompany": "Y",
         "previousGrade": "Hold", "newGrade": "Sell", "action": "downgrade"},
    ])
    assert aa._fmp_recent_action("AAPL", within_hours=36, now=now) is None


# ── FMP leg: window is day-granularity (ceil(within_hours/24)) ──────────────

def test_within_hours_ceiling_two_day_window_boundary(monkeypatch):
    """36h -> ceil(36/24)=2 calendar days: exactly 2 days back is INCLUDED,
    3 days back is EXCLUDED."""
    now = time.time()

    _mock_fmp_only(monkeypatch, [
        {"symbol": "V", "date": _iso(now, 2), "gradingCompany": "X",
         "previousGrade": "Hold", "newGrade": "Hold", "action": "maintain"},
    ])
    assert aa._fmp_recent_action("V", within_hours=36, now=now) is not None

    _mock_fmp_only(monkeypatch, [
        {"symbol": "V", "date": _iso(now, 3), "gradingCompany": "X",
         "previousGrade": "Hold", "newGrade": "Hold", "action": "maintain"},
    ])
    assert aa._fmp_recent_action("V", within_hours=36, now=now) is None


def test_all_actions_older_than_window_returns_none_via_full_fallthrough(monkeypatch):
    """An all-stale FMP set (older than the window) AND an empty Finnhub
    fallback together yield None — the acceptance-gate scenario from the plan."""
    now = time.time()

    def fake_get(url, params=None, timeout=None):
        if "financialmodelingprep.com" in url:
            return _Resp(200, [{"symbol": "XOM", "date": _iso(now, 30), "gradingCompany": "X",
                                 "previousGrade": "Hold", "newGrade": "Hold", "action": "maintain"}])
        if "finnhub.io" in url:
            return _Resp(200, [])
        raise AssertionError(f"unexpected host: {url}")

    monkeypatch.setattr("requests.get", fake_get)
    assert aa.finnhub_recent_action("XOM", within_hours=36, now=now) is None


# ── Finnhub fallback: used only when FMP yields nothing ─────────────────────

def test_finnhub_fallback_used_when_fmp_empty(monkeypatch):
    now = time.time()

    def fake_get(url, params=None, timeout=None):
        if "financialmodelingprep.com" in url:
            return _Resp(200, [])
        if "finnhub.io" in url:
            return _Resp(200, [{"symbol": "MSFT", "action": "up", "company": "Barclays",
                                 "fromGrade": "Hold", "toGrade": "Buy",
                                 "gradeTime": int(now - 3600)}])
        raise AssertionError(f"unexpected host: {url}")

    monkeypatch.setattr("requests.get", fake_get)
    result = aa.finnhub_recent_action("MSFT", within_hours=36, now=now)
    assert result is not None
    assert result["action"] == "up"
    assert result["firm"] == "Barclays"


def test_finnhub_fallback_stale_grade_returns_none(monkeypatch):
    now = time.time()

    def fake_get(url, params=None, timeout=None):
        if "financialmodelingprep.com" in url:
            return _Resp(200, [])
        if "finnhub.io" in url:
            return _Resp(200, [{"symbol": "MSFT", "action": "up", "company": "Barclays",
                                 "fromGrade": "Hold", "toGrade": "Buy",
                                 "gradeTime": int(now - 40 * 3600)}])  # 40h old, outside 36h window
        raise AssertionError(f"unexpected host: {url}")

    monkeypatch.setattr("requests.get", fake_get)
    assert aa.finnhub_recent_action("MSFT", within_hours=36, now=now) is None


# ── Guardrails: no fabrication, no wasted calls ──────────────────────────────

def test_empty_ticker_returns_none_without_any_network_call(monkeypatch):
    def fail(*a, **k):
        raise AssertionError("should not call network for an empty ticker")
    monkeypatch.setattr("requests.get", fail)
    assert aa.finnhub_recent_action("", within_hours=36) is None


def test_total_failure_returns_none_never_an_empty_dict(monkeypatch):
    now = time.time()

    def fake_get(url, params=None, timeout=None):
        return _Resp(500)

    monkeypatch.setattr("requests.get", fake_get)
    result = aa.finnhub_recent_action("ZZZQ", within_hours=36, now=now)
    assert result is None
