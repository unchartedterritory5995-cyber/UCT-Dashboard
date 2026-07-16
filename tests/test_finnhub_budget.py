"""Finnhub rate-budget guards (2026-07-15 incident: chronic 429s emptied the
calendar Beats column and intermittently dropped reported actuals).

Covers: junk-symbol skip, shared 429 cooldown, 403 plan-forbidden memo,
get_earnings_intel negative cache, and the sticky-actuals ledger that keeps
printed results on the calendar across degraded rebuilds.
"""
import json

import pytest

from api.services import earnings_estimates as ee
from api.services.cache import cache


class _Resp:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload if payload is not None else []
        self.ok = status_code < 400

    def raise_for_status(self):
        if self.status_code >= 400:
            raise Exception(f"{self.status_code} error")

    def json(self):
        return self._payload


@pytest.fixture(autouse=True)
def _reset_state(monkeypatch):
    monkeypatch.setenv("FINNHUB_API_KEY", "test-key")
    ee._fh_cooldown_until = 0.0
    for path in ("/stock/earnings", "/stock/recommendation", "/stock/price-target"):
        cache.invalidate(f"fh_forbidden_{path}")
    yield
    ee._fh_cooldown_until = 0.0


def _count_calls(monkeypatch, response):
    calls = {"n": 0}

    def fake_get(url, params=None, timeout=None):
        calls["n"] += 1
        return response

    monkeypatch.setattr(ee.requests, "get", fake_get)
    return calls


def test_junk_symbols_never_hit_network(monkeypatch):
    calls = _count_calls(monkeypatch, _Resp(200, []))
    for sym in ("$IDX:SEMICONDUCTORS", "^VIX", "BRK/B", "", None):
        assert ee._fh_get("/stock/earnings", {"symbol": sym, "limit": 4}) is None
    assert calls["n"] == 0


def test_429_engages_shared_cooldown(monkeypatch):
    calls = _count_calls(monkeypatch, _Resp(429))
    assert ee._fh_get("/stock/earnings", {"symbol": "AAPL", "limit": 4}) is None
    # Every subsequent call — any path, any symbol — is shed during cooldown.
    assert ee._fh_get("/stock/recommendation", {"symbol": "MSFT"}) is None
    assert ee._fh_get("/calendar/earnings", {"symbol": "TSLA"}) is None
    assert calls["n"] == 1


def test_cooldown_expires(monkeypatch):
    calls = _count_calls(monkeypatch, _Resp(200, [{"actual": 1.0}]))
    ee._fh_cooldown_until = 0.0  # already expired
    assert ee._fh_get("/stock/earnings", {"symbol": "AAPL", "limit": 4}) == [{"actual": 1.0}]
    assert calls["n"] == 1


def test_403_memoizes_forbidden_endpoint(monkeypatch):
    calls = _count_calls(monkeypatch, _Resp(403))
    assert ee._fh_get("/stock/price-target", {"symbol": "AAPL"}) is None
    assert ee._fh_get("/stock/price-target", {"symbol": "MSFT"}) is None
    assert calls["n"] == 1  # second call skipped via fh_forbidden memo
    # Other endpoints are unaffected.
    assert cache.get("fh_forbidden_/stock/earnings") is None


def test_intel_total_failure_negative_cached(monkeypatch):
    cache.invalidate("earnings_intel_ZZZQ")
    calls = _count_calls(monkeypatch, _Resp(500))
    assert ee.get_earnings_intel("ZZZQ") is None
    first = calls["n"]
    assert first >= 1
    # Second lookup inside the negative-cache window fires ZERO requests.
    assert ee.get_earnings_intel("ZZZQ") is None
    assert calls["n"] == first
    cache.invalidate("earnings_intel_ZZZQ")


def test_intel_success_still_cached_normally(monkeypatch):
    cache.invalidate("earnings_intel_GOODQ")

    def fake_get(url, params=None, timeout=None):
        if "/stock/earnings" in url:
            return _Resp(200, [{"period": "2026-06-30", "actual": 2.0, "estimate": 1.5,
                                "surprisePercent": 33.3}])
        return _Resp(500)

    monkeypatch.setattr(ee.requests, "get", fake_get)
    intel = ee.get_earnings_intel("GOODQ")
    assert intel and intel["beat_history"][0]["beat"] is True
    # Cached — a poisoned transport would raise if re-fetched.
    monkeypatch.setattr(ee.requests, "get", lambda *a, **k: (_ for _ in ()).throw(AssertionError("re-fetched")))
    assert ee.get_earnings_intel("GOODQ")["beat_history"]
    cache.invalidate("earnings_intel_GOODQ")


# ── Sticky actuals ledger ──────────────────────────────────────────────────────

def _day(entries):
    return {"bmo": entries, "amc": [], "tbd": []}


def test_sticky_actuals_survive_degraded_rebuild(tmp_path, monkeypatch):
    from api.routers import calendar as cal
    monkeypatch.setattr(cal, "_STICKY_ACTUALS_PATH", str(tmp_path / "actuals.json"))

    today = "2026-07-15"
    # Build 1: JNJ reported (patch succeeded).
    good = {today: _day([{"sym": "JNJ", "eps_act": 2.9, "eps_est": 2.87,
                          "rev_act": 25300.0, "rev_est": 25000.0}])}
    cal._merge_sticky_actuals(good, today)

    # Build 2 (degraded): the rebuild lost the actuals.
    degraded = {today: _day([{"sym": "JNJ", "eps_act": None, "eps_est": 2.87,
                              "rev_act": None, "rev_est": 25000.0}])}
    cal._merge_sticky_actuals(degraded, today)
    e = degraded[today]["bmo"][0]
    assert e["eps_act"] == 2.9
    assert e["rev_act"] == 25300.0


def test_sticky_actuals_skip_future_days_and_prune(tmp_path, monkeypatch):
    from api.routers import calendar as cal
    path = tmp_path / "actuals.json"
    monkeypatch.setattr(cal, "_STICKY_ACTUALS_PATH", str(path))

    today = "2026-07-15"
    # Pre-seed a stale date beyond the keep window.
    path.write_text(json.dumps({"2026-06-01": {"OLD": {"eps_act": 1.0}}}))

    days = {
        today: _day([{"sym": "MS", "eps_act": 3.46, "eps_est": 2.9,
                      "rev_act": None, "rev_est": None}]),
        "2026-07-17": _day([{"sym": "FUT", "eps_act": 9.9, "eps_est": 1.0,
                             "rev_act": None, "rev_est": None}]),
    }
    cal._merge_sticky_actuals(days, today)
    ledger = json.loads(path.read_text())
    assert "MS" in ledger.get(today, {})
    assert "2026-07-17" not in ledger      # future day never harvested
    assert "2026-06-01" not in ledger      # pruned past the 14-day window


def test_sticky_actuals_never_raise(monkeypatch):
    from api.routers import calendar as cal
    monkeypatch.setattr(cal, "_STICKY_ACTUALS_PATH", "Z:/definitely/not/a/dir/actuals.json")
    # Must swallow the write failure silently (best-effort layer).
    cal._merge_sticky_actuals({"2026-07-15": _day([{"sym": "A", "eps_act": 1.0,
                                                    "eps_est": None, "rev_act": None,
                                                    "rev_est": None}])}, "2026-07-15")
