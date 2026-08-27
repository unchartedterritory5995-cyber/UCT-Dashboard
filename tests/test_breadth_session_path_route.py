"""A finished session's shape is history, not an estimate.

`/api/breadth-monitor/live` withholds everything once the collector writes the
day — correct for the provisional ROW, but it takes the session's PATH with it,
and the path describes what already happened. The Daily Overview hero needs
that shape after the close, so `/api/breadth-monitor/session-path/{date}`
serves it straight from the intraday store (7-day retention).
"""
from __future__ import annotations

from datetime import date, timedelta

import pytest

# Derived, never typed — see test_breadth_live_router.py: a literal date walks
# past RETENTION_DAYS and the store prunes the fixture inside the test.
SESSION = date.today().isoformat()

from tests.authclients import PAID_MEMBER, authorize


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("BREADTH_INTRADAY_DB", str(tmp_path / "intraday.db"))
    from api.routers import breadth_monitor as rt
    from api.services import breadth_intraday as bi

    monkeypatch.setattr(bi, "_schema_ready", False)
    monkeypatch.setattr(bi, "_last_prune", 0.0)
    monkeypatch.setattr(bi, "MIN_SAMPLE_SECONDS", 0)

    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    app = FastAPI()
    app.include_router(rt.router)
    authorize(app, PAID_MEMBER)
    return TestClient(app), bi


def test_a_recorded_session_comes_back_as_its_path(client):
    c, bi = client
    assert bi.record(SESSION, {"pct_above_50sma": 61.0, "up_4pct_today": 140},
                     now=1_700_000_000)
    assert bi.record(SESSION, {"pct_above_50sma": 63.4, "up_4pct_today": 178},
                     now=1_700_003_600)

    r = c.get(f"/api/breadth-monitor/session-path/{SESSION}")
    assert r.status_code == 200
    out = r.json()
    assert out["ok"] is True
    assert out["date"] == SESSION
    assert out["path"]["pct_above_50sma"] == [[1_700_000_000, 61.0],
                                              [1_700_003_600, 63.4]]
    # "Since the open" is only honest against the FIRST sample actually taken.
    assert out["open"]["pct_above_50sma"] == 61.0


def test_a_day_with_no_samples_is_ok_false_not_an_error(client):
    c, _ = client
    r = c.get(f"/api/breadth-monitor/session-path/{SESSION}")
    assert r.status_code == 200
    out = r.json()
    assert out["ok"] is False
    assert out["path"] == {}
    assert out["open"] == {}


def test_a_malformed_date_is_rejected_before_it_reaches_the_store(client):
    c, _ = client
    assert c.get("/api/breadth-monitor/session-path/not-a-date").status_code == 400
    assert c.get("/api/breadth-monitor/session-path/2026-8-1").status_code == 400
