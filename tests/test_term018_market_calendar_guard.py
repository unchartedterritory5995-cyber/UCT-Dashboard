"""TERM-018 / G-18, G-19, G-20: the NYSE closure-table runway alert, fired THROUGH ITS
ROUTE with an INJECTED CLOCK.

`GET /api/market-calendar` is the only door to `market_calendar._announce`. The table
runs to `_COVERS_THROUGH` (the end of the last year it enumerates), so on the real
clock nothing here can fire before ~2027-07. These tests do not wait: they freeze the
module's `date.today()` at a chosen distance from `_COVERS_THROUGH` (read from the
module, never typed) and GET the same `market_calendar.router` object `api/main.py`
includes. Only the clock and the sink are replaced; the classification, the milestone
gate and the key/severity choice are the real code.

The three audit tiers share ONE derived guard (key and severity are both computed), so
each tier is driven on its own day:
  * G-18  a milestone day inside the 180-day window -> one `critical` (a page), keyed
          by its milestone;
  * G-19  an ordinary expiring day -> one `warning`, under the shared stale key, never
          a page;
  * G-20  past the horizon -> one `critical`, day-stamped.
CONTROL: a day with more runway than the window raises nothing.
"""
from __future__ import annotations

from datetime import date, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routers.market_calendar as market_calendar
from api.services import chart_health_alerts

HORIZON = date.fromisoformat(market_calendar._COVERS_THROUGH)


def _frozen(day: date) -> type:
    class _Frozen(date):
        @classmethod
        def today(cls):  # noqa: D401 - the injected clock
            return cls(day.year, day.month, day.day)
    return _Frozen


@pytest.fixture
def alerts(monkeypatch):
    seen: list[tuple[str, str]] = []

    def emit(key, severity, message=None, metadata=None, **kw):
        seen.append((key, severity))
        return True

    monkeypatch.setattr(chart_health_alerts, "emit", emit)
    return seen


def _get_on(monkeypatch, day: date) -> dict:
    monkeypatch.setattr(market_calendar, "date", _frozen(day))
    app = FastAPI()
    app.include_router(market_calendar.router)
    r = TestClient(app).get("/api/market-calendar")
    assert r.status_code == 200, r.text
    return r.json()


def test_a_milestone_day_inside_the_window_pages_critical(monkeypatch, alerts):
    days = market_calendar._MILESTONE_DAYS[1]               # 90, read from the module
    body = _get_on(monkeypatch, HORIZON - timedelta(days=days))
    assert body["status"] == "expiring" and body["days_remaining"] == days
    assert alerts == [(f"market_calendar_expiring_{days}d", "critical")]


def test_an_ordinary_expiring_day_is_a_warning_never_a_page(monkeypatch, alerts):
    days = market_calendar._MILESTONE_DAYS[1] + 10          # inside the window, not a milestone
    assert days not in market_calendar._MILESTONE_DAYS
    assert days <= market_calendar._EXPIRING_WITHIN_DAYS
    body = _get_on(monkeypatch, HORIZON - timedelta(days=days))
    assert body["status"] == "expiring"
    assert alerts == [("market_calendar_stale", "warning")]


def test_a_lapsed_table_pages_critical_and_is_day_stamped(monkeypatch, alerts):
    today = HORIZON + timedelta(days=1)
    body = _get_on(monkeypatch, today)
    assert body["status"] == "expired" and body["days_remaining"] == -1
    assert alerts == [(f"market_calendar_expired_{today.isoformat()}", "critical")]


def test_CONTROL_a_table_with_runway_raises_nothing(monkeypatch, alerts):
    days = market_calendar._EXPIRING_WITHIN_DAYS + 1
    body = _get_on(monkeypatch, HORIZON - timedelta(days=days))
    assert body["status"] == "ok"
    assert alerts == []
