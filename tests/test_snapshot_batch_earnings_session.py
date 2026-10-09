"""Wave 5 (terminal headline): BMO / AMC beside the next earnings date.

`POST /api/research/snapshot-batch` with `session: true` adds `next_earnings_session`, read
from the earnings-calendar data ALREADY cached for that date. It never builds a week and never
calls a provider. The Watchlist (which does not ask) gets the payload unchanged.
"""
from __future__ import annotations

from datetime import date

import pytest


@pytest.fixture
def wired(monkeypatch):
    from api.routers import calendar as cal
    from api.routers import research as r
    from api.services import bars_sqlite
    from api.services.cache import cache

    monday = date(2026, 11, 16)  # this week, pinned
    monkeypatch.setattr(cal, "_week_dates", lambda: [monday])
    snaps = {
        "NVDA": {"name": "NVIDIA", "next_earnings": "2026-11-19"},   # this week, AMC
        "AAPL": {"name": "Apple", "next_earnings": "2026-11-24"},    # next week, cached, BMO
        "MSFT": {"name": "Microsoft", "next_earnings": "2026-12-08"},  # week not cached
        "TBDX": {"name": "Tbd Co", "next_earnings": "2026-11-20"},   # on the day, tbd
    }
    monkeypatch.setattr(r, "get_snapshot", lambda s: snaps[s])
    monkeypatch.setattr(bars_sqlite, "avg_daily_volume", lambda *a, **k: {})
    monkeypatch.setattr(bars_sqlite, "first_trade_dates", lambda *a, **k: {})

    built = []
    monkeypatch.setattr(cal, "_get_or_build_range_week", lambda m: built.append(m))
    monkeypatch.setattr(cal, "_build_range_week", lambda m: built.append(m))

    keys = ["calendar_weekly", "calendar_week_2026-11-23"]
    saved = {k: cache.get(k) for k in keys}
    cache.set("calendar_weekly", {"days": {
        "2026-11-19": {"bmo": [{"sym": "TGT"}], "amc": [{"sym": "nvda"}]},
        "2026-11-20": {"bmo": [], "amc": [], "tbd": [{"sym": "TBDX"}]},
    }}, ttl=600)
    cache.set("calendar_week_2026-11-23", {"days": {
        "2026-11-24": {"bmo": [{"sym": "AAPL"}], "amc": []},
    }}, ttl=600)
    yield r, built
    for k, v in saved.items():
        if v is None:
            cache.invalidate(k)
        else:
            cache.set(k, v, ttl=600)


def test_session_true_names_bmo_and_amc_from_the_cached_calendar(wired):
    r, built = wired
    out = r.research_snapshot_batch(tickers=["NVDA", "AAPL", "MSFT", "TBDX"], session=True)
    assert out["NVDA"]["next_earnings_session"] == "amc"
    assert out["AAPL"]["next_earnings_session"] == "bmo"
    assert out["MSFT"]["next_earnings_session"] is None   # its week is not cached: date only
    assert out["TBDX"]["next_earnings_session"] is None   # tbd is not a session
    assert built == []                                    # nothing was built or fetched


def test_without_session_the_payload_is_unchanged(wired):
    r, _ = wired
    out = r.research_snapshot_batch(tickers=["NVDA"], session=False)
    assert "next_earnings_session" not in out["NVDA"]
    assert out["NVDA"]["next_earnings"] == "2026-11-19"


def test_the_flag_is_a_body_field_on_the_route():
    from api.routers import research as r
    route = next(rt for rt in r.router.routes if getattr(rt, "path", "") == "/api/research/snapshot-batch")
    names = {p.name for p in route.dependant.body_params}
    assert {"tickers", "session"} <= names
