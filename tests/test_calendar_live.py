"""Regression tests for the calendar live-earnings path.

Root cause (2026-06-14): EarningsWhispers connection-drops parallel bursts, so the
old 5-thread `_build_live` got ~4/5 days blocked → an empty weekly calendar. Fix:
fetch EW sequentially (paced) with retry, and fall back to wire when live is empty.
"""
from datetime import date, timedelta

import api.services.engine as eng
from api.routers import calendar as cal


def _ew_item(sym, hour="bmo"):
    return {
        "symbol": sym, "hour": hour,
        "eps_actual": None, "eps_estimate": 1.0,
        "rev_actual": None, "rev_estimate": None,
        "ew_total": 3,
    }


def test_ew_resilient_retries_then_succeeds(monkeypatch):
    calls = {"n": 0}

    def fake(ds):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("blocked")     # first attempt blocked
        return [_ew_item("NVDA", "amc")]

    monkeypatch.setattr(eng, "_fetch_ew_live", fake)
    monkeypatch.setattr(cal, "_EW_RETRY_BACKOFF", 0)   # no real sleep in tests

    out = cal._fetch_ew_day_resilient("2026-06-16")
    assert calls["n"] == 2                              # retried once
    assert out and out[0]["symbol"] == "NVDA"


def test_ew_resilient_returns_empty_after_all_fail(monkeypatch):
    def always_fail(ds):
        raise RuntimeError("blocked")

    monkeypatch.setattr(eng, "_fetch_ew_live", always_fail)
    monkeypatch.setattr(cal, "_EW_RETRY_BACKOFF", 0)

    assert cal._fetch_ew_day_resilient("2026-06-16") == []


def test_build_live_populates_every_weekday_paced(monkeypatch):
    # One synthetic reporter per weekday; Finviz stubbed to empty (no network).
    monkeypatch.setattr(cal, "_fetch_ew_day_resilient",
                        lambda ds: [_ew_item(f"T{ds[-2:]}")])
    monkeypatch.setattr(cal, "_fetch_finviz_week", lambda strs: {})
    monkeypatch.setattr(cal, "_EW_PACE_SECONDS", 0)

    week = [date(2026, 6, 15) + timedelta(days=i) for i in range(5)]
    days = cal._build_live(week, date(2026, 6, 14))

    total = sum(len(d["bmo"]) + len(d["amc"]) for d in days.values())
    assert total == 5                                  # one per weekday, none dropped
