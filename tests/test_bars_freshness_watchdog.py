"""Phase 0 hardening: prewarmer liveness + daily-store freshness watchdog.

These are the signals whose absence let the 2026-08-11 week-long daily freeze go
undetected — the prewarmer thread died and nothing noticed. Cover the pure decision
machine, the freshness sampler, and the heartbeat alive-window.
"""
import time

from api.worker_main import _bars_freshness_decision, _bars_alert_text
from api.services import bars_prewarm


def _fresh():
    return {"bad": False, "last_alert_at": None}


# ── watchdog state machine ───────────────────────────────────────────────────

def test_healthy_never_alerts():
    st, ev = _bars_freshness_decision(_fresh(), healthy=True, now=1000)
    assert ev is None and st["bad"] is False


def test_goes_stale_then_holds_then_renags():
    st = _fresh()
    st, ev = _bars_freshness_decision(st, healthy=False, now=1000)
    assert ev == "stale" and st["bad"] is True and st["last_alert_at"] == 1000
    # before the re-nag window → no repeat
    st, ev = _bars_freshness_decision(st, healthy=False, now=1000 + 900, renag_s=1800)
    assert ev is None
    # past the re-nag window → still_stale
    st, ev = _bars_freshness_decision(st, healthy=False, now=1000 + 1900, renag_s=1800)
    assert ev == "still_stale" and st["last_alert_at"] == 1000 + 1900


def test_recovers_exactly_once():
    st = _fresh()
    st, _ = _bars_freshness_decision(st, healthy=False, now=1000)
    st, ev = _bars_freshness_decision(st, healthy=True, now=2000)
    assert ev == "recovered" and st["bad"] is False
    st, ev = _bars_freshness_decision(st, healthy=True, now=2100)
    assert ev is None  # stays healthy, no repeat


def test_alert_text_names_the_reasons():
    txt = _bars_alert_text(
        "stale",
        {"alive": False, "age_seconds": 4000, "last_error": "database is locked"},
        {"stale": True, "days_behind": 7, "newest_session": 20260811, "expected_session": 20260818},
    )
    assert "prewarmer DEAD" in txt and "7d behind" in txt and "database is locked" in txt


# ── daily freshness sampler ──────────────────────────────────────────────────

def test_freshness_report_flags_a_frozen_store(monkeypatch):
    from api.services import bars_sqlite, bars_fetch
    monkeypatch.setattr(bars_sqlite, "get_last_ts", lambda sym, tf: 20260811)  # a week stale
    monkeypatch.setattr(bars_fetch, "_expected_latest_session_yyyymmdd", lambda now=None: 20260818)
    r = bars_prewarm.daily_freshness_report()
    assert r["sampled"] > 0 and r["newest_session"] == 20260811
    assert r["days_behind"] == 7 and r["stale"] is True


def test_freshness_report_fresh_store_not_stale(monkeypatch):
    from api.services import bars_sqlite, bars_fetch
    monkeypatch.setattr(bars_sqlite, "get_last_ts", lambda sym, tf: 20260818)
    monkeypatch.setattr(bars_fetch, "_expected_latest_session_yyyymmdd", lambda now=None: 20260818)
    r = bars_prewarm.daily_freshness_report()
    assert r["days_behind"] == 0 and r["stale"] is False


def test_freshness_report_graceful_on_empty(monkeypatch):
    from api.services import bars_sqlite
    monkeypatch.setattr(bars_sqlite, "get_last_ts", lambda sym, tf: None)
    r = bars_prewarm.daily_freshness_report()
    assert r["sampled"] == 0 and r["stale"] is None


# ── heartbeat alive-window ───────────────────────────────────────────────────

def test_heartbeat_alive_only_within_window(monkeypatch):
    monkeypatch.setitem(bars_prewarm._PREWARM_STATE, "last_beat_ts", time.time())
    assert bars_prewarm.prewarm_heartbeat()["alive"] is True
    monkeypatch.setitem(bars_prewarm._PREWARM_STATE, "last_beat_ts", time.time() - 3000)
    assert bars_prewarm.prewarm_heartbeat()["alive"] is False  # >2700s → dead
