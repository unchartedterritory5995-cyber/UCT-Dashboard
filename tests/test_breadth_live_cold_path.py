"""Perf wave 2: /api/breadth-monitor/live measured 4-5 s cold / 1.1 s warm.
- outside 9:00-16:30 ET weekdays the live compute holds 10 min (its inputs cannot move);
- concurrent cold callers share ONE full-market compute;
- a member read reuses the session-path scans for INTRADAY_READ_MEMO_S."""
from __future__ import annotations

import threading
import time
from datetime import datetime

import pytest

from api.services import breadth_live as live
from api.services.cache import cache


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    monkeypatch.setattr(live, "enabled", lambda: True)
    live._live_cache.clear()
    yield
    live._live_cache.clear()


def test_the_window_is_long_only_outside_the_session():
    assert live._live_ttl(datetime(2026, 10, 8, 10, 0)) == live._LIVE_TTL_SECONDS     # Thu 10:00
    assert live._live_ttl(datetime(2026, 10, 8, 16, 20)) == live._LIVE_TTL_SECONDS    # closing prints
    assert live._live_ttl(datetime(2026, 10, 8, 21, 0)) == live._LIVE_TTL_CLOSED_SECONDS
    assert live._live_ttl(datetime(2026, 10, 10, 12, 0)) == live._LIVE_TTL_CLOSED_SECONDS  # Sat


def test_after_hours_a_five_minute_old_payload_is_served_without_a_market_pull(monkeypatch):
    pulls = []
    monkeypatch.setattr(live, "_live_ttl", lambda now_et=None: live._LIVE_TTL_CLOSED_SECONDS)
    monkeypatch.setattr(live, "_compute_fresh", lambda now: pulls.append(1) or {"ok": True})
    live._live_cache.update(payload={"ok": True, "old": 1}, at=time.time() - 300)
    assert live.compute_live()["old"] == 1
    assert pulls == []


def test_concurrent_cold_callers_share_one_compute(monkeypatch):
    pulls = []

    def fresh(now):
        pulls.append(1)
        time.sleep(0.3)
        p = {"ok": True}
        with live._live_lock:
            live._live_cache.update(payload=p, at=time.time())
        return p
    monkeypatch.setattr(live, "_compute_fresh", fresh)
    ts = [threading.Thread(target=live.compute_live) for _ in range(5)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert len(pulls) == 1


def test_a_member_read_reuses_the_session_path_scans(monkeypatch):
    from api.routers import breadth_monitor as br
    from api.services import breadth_intraday as bi
    from api.services import breadth_monitor as svc
    scans = []
    monkeypatch.setattr(live, "compute_live", lambda force=False: {
        "ok": True, "session_date": "2099-01-02", "metrics": {}, "session_live": False})
    monkeypatch.setattr(svc, "get_history", lambda days=90: [])
    monkeypatch.setattr(svc, "derive_live_row", lambda row, recent: row)
    monkeypatch.setattr(bi, "session_path", lambda d, **k: scans.append("path") or {})
    monkeypatch.setattr(bi, "session_open", lambda d, **k: {})
    monkeypatch.setattr(bi, "health", lambda: {"ok": True})
    monkeypatch.setattr(bi, "latest_session", lambda: None)
    cache.invalidate("breadth_live_intraday::2099-01-02")
    try:
        br._live_payload(force=False, persist=False)
        br._live_payload(force=False, persist=False)
        assert scans == ["path"]
        br._live_payload(force=False, persist=True)       # the sampler always re-reads
        assert scans == ["path", "path"]
    finally:
        cache.invalidate("breadth_live_intraday::2099-01-02")
