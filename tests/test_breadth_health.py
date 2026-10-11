"""The nightly breadth health check (`api/services/breadth_health.py`). No network, no builds."""
from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from api.services import breadth_health as bh

_ET = ZoneInfo("America/New_York")
EVE = datetime(2026, 10, 9, 21, 30, tzinfo=_ET)       # Friday evening
MORN = datetime(2026, 10, 12, 9, 45, tzinfo=_ET)      # Monday morning -> Friday


def _bars(dates, c=50.0):
    return [{"t": d, "o": c, "h": c, "l": c, "c": c} for d in dates]


def _window(end="2026-10-09", n=bh.WINDOW):
    from datetime import date
    return bh._sessions_back(date.fromisoformat(end), n)


def test_expected_last_session():
    assert bh.expected_last(EVE, morning=False) == "2026-10-09"
    assert bh.expected_last(MORN, morning=True) == "2026-10-09"
    assert bh.expected_last(datetime(2026, 10, 10, 21, 30, tzinfo=_ET), morning=False) == "2026-10-09"


def test_a_healthy_series_passes():
    rows = [{"symbol": "UCTA50", "domain": "pct_0_100"}]
    res = bh.check_series(rows, EVE, False, served=lambda s: _bars(_window()))
    assert res["checked"] == 1 and not res["stale"] and not res["gaps"] and not res["values"]


def test_stale_gaps_and_bad_values_are_named():
    w = _window()
    rows = [{"symbol": "STALE", "domain": "pct_0_100"}, {"symbol": "HOLE", "domain": "count"},
            {"symbol": "BAD", "domain": "pct_0_100"}, {"symbol": "COLD", "domain": "count"}]
    data = {"STALE": _bars(w[:-1]), "HOLE": _bars(w[:10] + w[12:]),
            "BAD": _bars(w[:-1]) + [{"t": w[-1], "c": 142.0}], "COLD": None}
    res = bh.check_series(rows, EVE, False, served=lambda s: data[s])
    assert res["stale"] == [f"STALE: last bar {w[-2]}"]
    assert res["gaps"][0].startswith("HOLE: 2 missing")
    assert res["values"] == [f"BAD: {w[-1]}=142.0"]
    assert res["skipped"] == 1 and res["checked"] == 3          # cold: never built


def test_known_gaps_are_not_reported(monkeypatch):
    w = _window()
    monkeypatch.setitem(bh.KNOWN_GAPS, "UCTATH", {w[5]})
    res = bh.check_series([{"symbol": "UCTATH", "domain": "count"}], EVE, False,
                          served=lambda s: _bars(w[:5] + w[6:]))
    assert not res["gaps"]


def test_sentiment_freshness(monkeypatch):
    from api.services import breadth_monitor as bm
    monkeypatch.setattr(bm, "get_history", lambda n: [
        {"date": "2026-10-09", "aaii_survey_date": "2026-09-24", "naaim_date": "2026-10-07",
         "cboe_putcall": 0.8},
        {"date": "2026-10-08", "cboe_putcall": None}])
    issues = bh.check_sentiment(EVE)
    assert any(i.startswith("AAII") for i in issues)
    assert not any(i.startswith("NAAIM") for i in issues)


def test_one_alert_per_problem_class(monkeypatch, tmp_path):
    from api.services import breadth_alerts
    monkeypatch.setenv("BREADTH_ALERTS_STATE", str(tmp_path / "s.json"))
    monkeypatch.setenv("DISCORD_BREADTH_WEBHOOK_URL", "https://discord.test/b")
    monkeypatch.setattr(bh, "check_series", lambda rows, now, morning: {
        "stale": ["A: last bar x", "B: last bar x"], "gaps": [], "values": [], "checked": 2,
        "skipped": 0})
    monkeypatch.setattr(bh, "check_sentiment", lambda now: [])
    posts = []

    class _R:
        status_code = 204
    res = bh.run(EVE, post=lambda url, **k: posts.append(k["json"]["content"]) or _R(), rows=[])
    assert len(posts) == 1 and "A: last bar" in posts[0] and "B: last bar" in posts[0]
    assert set(res["sent"]) == {"stale"}


def test_weekends_do_not_run_the_evening_check():
    assert bh.run(datetime(2026, 10, 10, 21, 30, tzinfo=_ET), rows=[])["ran"] is False
