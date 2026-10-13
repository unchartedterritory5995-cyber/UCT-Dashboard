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


# ── (2026-10-13) pending is not missing; one resolution when the row lands ──────────────────

def _wire2(monkeypatch, row, results, last_tick):
    from api.services import breadth_monitor as bm
    from api.services import breadth_eod_source as eod
    monkeypatch.setattr(bm, "raw_row", lambda d: row)
    monkeypatch.setattr(eod, "server_writes", lambda d: True)
    monkeypatch.setattr(eod, "status", lambda: {"mode": "server", "server_from": "2026-10-12",
                                                "job": {"last_results": list(results),
                                                        "last_tick": last_tick}})


NIGHT = datetime(2026, 10, 12, 21, 30, tzinfo=_ET)
PC_ROW = {"date": "2026-10-12", "adv_decline": 3}        # the partner PC's row, not the server's
WAITING = [{"date": "2026-10-12", "computed": True, "status": "insufficient_coverage"}]


def test_last_nights_case_is_a_pending_note_not_a_missing_alarm(env, monkeypatch):
    posts, post = env
    _wire2(monkeypatch, PC_ROW, WAITING, last_tick=NIGHT.timestamp() - 300)
    out = ba.check_eod_row(NIGHT, post=post)
    assert out["pending"] and out["sent"]
    body = posts[0][1]
    assert "pending (retrying)" in body and "insufficient_coverage" in body
    assert "PC collector's row is in place" in body and "row is missing" not in body


@pytest.mark.parametrize("results,last_tick,why", [
    (WAITING, NIGHT.timestamp() - 3600, "stalled"),                       # the job stopped ticking
    ([{"date": "2026-10-12", "status": "refused_degraded"}], NIGHT.timestamp() - 300, "refused_degraded"),
    ([{"date": "2026-10-12", "status": "store_failed"}], NIGHT.timestamp() - 300, "store_failed"),
])
def test_a_real_failure_keeps_the_full_alarm(env, monkeypatch, results, last_tick, why):
    posts, post = env
    _wire2(monkeypatch, PC_ROW, results, last_tick)
    out = ba.check_eod_row(NIGHT, post=post)
    assert not out.get("pending") and "official row is missing" in posts[0][1] and why in posts[0][1]
    assert "PC collector's row is serving meanwhile" in posts[0][1]   # still honest about charts


def test_still_unwritten_by_morning_is_the_full_alarm(env, monkeypatch):
    posts, post = env
    morning = datetime(2026, 10, 13, 9, 45, tzinfo=_ET)
    _wire2(monkeypatch, PC_ROW, WAITING, last_tick=morning.timestamp() - 300)
    out = ba.check_eod_row(morning, morning=True, post=post)
    assert not out.get("pending") and "still missing" in posts[0][1]


def test_the_row_landing_posts_one_resolution_from_the_writer(env, monkeypatch):
    posts, post = env
    _wire2(monkeypatch, PC_ROW, WAITING, last_tick=NIGHT.timestamp() - 300)
    ba.check_eod_row(NIGHT, post=post)                                    # pending note
    from api.services import breadth_eod_source as eod
    monkeypatch.setattr(eod, "mode", lambda: "server")
    monkeypatch.setattr(eod, "candidate_sessions", lambda now=None: ["2026-10-12"])
    monkeypatch.setattr(eod, "write_server_row",
                        lambda d: {"date": d, "computed": True, "status": "written"})
    import requests
    monkeypatch.setattr(requests, "post", post)
    eod.tick()
    assert len(posts) == 2 and "has landed" in posts[1][1]
    eod.tick()                                                            # nothing further
    _wire2(monkeypatch, {"date": "2026-10-12", "_source": "server"}, [], NIGHT.timestamp())
    ba.check_eod_row(datetime(2026, 10, 13, 9, 45, tzinfo=_ET), morning=True, post=post)
    assert len(posts) == 2                                                # resolved exactly once


def test_a_healthy_recheck_resolves_a_missing_alarm_once(env, monkeypatch):
    posts, post = env
    _wire2(monkeypatch, PC_ROW, [{"date": "2026-10-12", "status": "store_failed"}], NIGHT.timestamp())
    ba.check_eod_row(NIGHT, post=post)
    _wire2(monkeypatch, {"date": "2026-10-12", "_source": "server"}, [], NIGHT.timestamp())
    ba.check_eod_row(datetime(2026, 10, 13, 9, 45, tzinfo=_ET), morning=True, post=post)
    assert len(posts) == 2 and "now stored" in posts[1][1]


def test_nothing_to_resolve_posts_nothing(env):
    posts, post = env
    assert all(not r["sent"] for r in ba.resolve_eod_row("2026-10-12", post=post).values())
    assert posts == []
