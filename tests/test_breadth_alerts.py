"""Breadth alerts (`api/services/breadth_alerts.py`) — the #breadth-alerts channel and the
evening "is today's official breadth row stored?" check. No network: posts are captured."""
from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from api.services import breadth_alerts as ba

_ET = ZoneInfo("America/New_York")


class _R:
    status_code = 204


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("BREADTH_ALERTS_STATE", str(tmp_path / "state.json"))
    monkeypatch.setenv("DISCORD_BREADTH_WEBHOOK_URL", "https://discord.test/breadth")
    posts = []
    return posts, (lambda url, **k: posts.append((url, k["json"]["content"])) or _R())


def test_send_posts_to_the_breadth_channel_once_per_cooldown(env):
    posts, post = env
    assert ba.send("k", "Title", ["a", "b"], post=post, now=1000)["sent"]
    assert posts[0][0] == "https://discord.test/breadth" and "**Title**" in posts[0][1]
    assert ba.send("k", "Title", ["a"], post=post, now=2000)["reason"] == "cooldown"
    assert ba.send("k", "Title", ["a"], post=post, now=1000 + ba.COOLDOWN_S + 1)["sent"]
    ba.clear("k")
    assert ba.send("k", "Title", ["a"], post=post, now=1000 + ba.COOLDOWN_S + 2)["sent"]


def test_an_unset_variable_falls_back_to_the_ops_destination(env, monkeypatch):
    posts, post = env
    monkeypatch.delenv("DISCORD_BREADTH_WEBHOOK_URL")
    from api.services import alert_destination
    monkeypatch.setattr(alert_destination, "ops_webhook", lambda *a, **k: "https://discord.test/ops")
    assert ba.send("k2", "T", ["x"], post=post, now=5)["sent"]
    assert posts[-1][0] == "https://discord.test/ops"


def _wire(monkeypatch, row, server_writes=False, results=()):
    from api.services import breadth_monitor as bm
    from api.services import breadth_eod_source as eod
    monkeypatch.setattr(bm, "raw_row", lambda d: row)
    monkeypatch.setattr(eod, "server_writes", lambda d: server_writes)
    monkeypatch.setattr(eod, "status", lambda: {"mode": "server" if server_writes else "shadow",
                                                "server_from": "2026-10-14" if server_writes else None,
                                                "job": {"last_results": list(results)}})


def test_a_stored_row_is_ok_and_clears_the_alert(env, monkeypatch):
    posts, post = env
    _wire(monkeypatch, {"date": "2026-10-09", "adv_decline": 10})
    out = ba.check_eod_row(datetime(2026, 10, 9, 21, 30, tzinfo=_ET), post=post)
    assert out["ok"] and out["source"] == "collector" and posts == []


def test_a_missing_row_alerts_with_the_jobs_reason(env, monkeypatch):
    posts, post = env
    _wire(monkeypatch, None, server_writes=True,
          results=[{"date": "2026-10-14", "status": "insufficient_coverage", "reason": "0.4"}])
    out = ba.check_eod_row(datetime(2026, 10, 14, 21, 30, tzinfo=_ET), post=post)
    assert not out["ok"] and out["sent"]
    assert "2026-10-14" in posts[0][1] and "insufficient_coverage" in posts[0][1]


def test_after_the_switch_a_collector_only_row_is_a_failure(env, monkeypatch):
    posts, post = env
    _wire(monkeypatch, {"date": "2026-10-14", "adv_decline": 3}, server_writes=True)
    out = ba.check_eod_row(datetime(2026, 10, 14, 21, 30, tzinfo=_ET), post=post)
    assert not out["ok"] and "server did not write" in out["problem"]


def test_weekends_and_holidays_are_not_checked(env, monkeypatch):
    posts, post = env
    _wire(monkeypatch, None)
    assert not ba.check_eod_row(datetime(2026, 10, 10, 21, 30, tzinfo=_ET), post=post)["checked"]
    # Thanksgiving 2026-11-26
    assert not ba.check_eod_row(datetime(2026, 11, 26, 21, 30, tzinfo=_ET), post=post)["checked"]
    assert posts == []


def test_the_morning_run_checks_the_previous_trading_day(env, monkeypatch):
    posts, post = env
    seen = []
    from api.services import breadth_monitor as bm
    _wire(monkeypatch, None)
    monkeypatch.setattr(bm, "raw_row", lambda d: seen.append(d) or {"date": d})
    ba.check_eod_row(datetime(2026, 10, 12, 9, 45, tzinfo=_ET), morning=True, post=post)
    assert seen == ["2026-10-09"]                       # Monday morning -> Friday
