"""TERM-082 rank 5: `/api/breadth-monitor` serves its last good body while one
refresh runs behind the caller, and NEVER serves the pre-write Monitor.

Drives the real route over a seeded store (the same fixture shape as
test_breadth_cache_label.py). Ground truth is a counter on the reader, never the
label under test.
"""
from __future__ import annotations

import json
import sqlite3
import threading
import time

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("BREADTH_OHLC_DB", str(tmp_path / "ohlc.db"))
    monkeypatch.setenv("BREADTH_SENTIMENT_DB", str(tmp_path / "sent.db"))
    monkeypatch.setenv("BREADTH_DEEP_HISTORY", "1")
    from api.services import breadth_monitor as bm
    from api.services import breadth_daily_ohlc as ohlc
    from api.services import breadth_sentiment_history as sent
    from api.services import breadth_self_heal
    from api.services.cache import cache

    monkeypatch.setattr(bm, "_db_path", lambda: str(tmp_path / "monitor.db"))
    monkeypatch.setattr(bm, "_DEEP_ENABLED", True)
    monkeypatch.setattr(breadth_self_heal, "maybe_auto_heal", lambda *a, **k: None)
    ohlc._INIT_DONE = False
    sent._INIT_DONE = False
    bm.init_db()
    dates = sorted(f"2026-{1 + i // 28:02d}-{1 + i % 28:02d}" for i in range(40))
    with sqlite3.connect(bm._db_path()) as c:
        for i, d in enumerate(dates):
            c.execute("INSERT OR REPLACE INTO breadth_snapshots(date, metrics) VALUES (?,?)",
                      (d, json.dumps({"pct_above_50sma": 50 + i, "universe_count": 3700})))
        c.commit()

    import api.main as main
    from api.routers import breadth_monitor as rm
    main.app.dependency_overrides[rm.require_paid] = lambda: {"id": "t", "plan": "pro"}
    cache.delete_prefix("breadth_history_")
    rm._history_stale().forget(rm._body_cache_key(30, "", "le"))
    try:
        yield {"client": TestClient(main.app), "bm": bm, "rm": rm, "cache": cache,
               "dates": dates}
    finally:
        main.app.dependency_overrides.pop(rm.require_paid, None)
        cache.delete_prefix("breadth_history_")


def _counting(monkeypatch, env):
    ran = {"n": 0}
    real = env["bm"].get_history_deep

    def counted(*a, **k):
        ran["n"] += 1
        return real(*a, **k)

    monkeypatch.setattr(env["bm"], "get_history_deep", counted)
    return ran


def _tier(r):
    st = r.headers.get("server-timing", "")
    return st.split('desc="')[1].split('"')[0] if 'desc="' in st else None


def _wait_for(pred, timeout=5.0):
    t = time.time()
    while time.time() - t < timeout:
        if pred():
            return True
        time.sleep(0.02)
    return False


def test_an_expired_body_is_served_stale_and_refreshed_behind_the_caller(env, monkeypatch):
    c, rm = env["client"], env["rm"]
    bk = rm._body_cache_key(30, "", "le")
    first = c.get("/api/breadth-monitor?days=30")
    assert first.status_code == 200
    assert _tier(first) == "fetch", first.headers.get("server-timing")

    # The body TTL lapses (the generation sentinel does NOT: no writer ran).
    env["cache"].invalidate(bk)
    gate = threading.Event()
    real = env["bm"].get_history_deep

    def slow(*a, **k):
        gate.wait(5)
        return real(*a, **k)

    monkeypatch.setattr(env["bm"], "get_history_deep", slow)
    second = c.get("/api/breadth-monitor?days=30")
    assert second.status_code == 200
    assert _tier(second) == "stale-swr", second.headers.get("server-timing")
    assert "stale-age;dur=" in second.headers["server-timing"]
    assert second.content == first.content, "the stale answer must be the last good body"
    gate.set()
    # The refresh ran on its own thread and refilled the body cache.
    assert _wait_for(lambda: env["cache"].get(bk) is not None), "no background refresh landed"


def test_a_collector_write_is_never_answered_with_the_pre_write_body(env, monkeypatch):
    """THE RULE THIS EXISTS FOR. A writer calls delete_prefix('breadth_history_'),
    which wipes the generation; the remembered body must be forgotten, not served."""
    c, bm = env["client"], env["bm"]
    first = c.get("/api/breadth-monitor?days=30")
    assert first.status_code == 200
    with sqlite3.connect(bm._db_path()) as con:
        con.execute("INSERT OR REPLACE INTO breadth_snapshots(date, metrics) VALUES (?,?)",
                    ("2026-03-01", json.dumps({"pct_above_50sma": 99, "universe_count": 3700})))
        con.commit()
    env["cache"].delete_prefix("breadth_history_")   # what every writer does
    ran = _counting(monkeypatch, env)
    second = c.get("/api/breadth-monitor?days=30")
    assert second.status_code == 200
    assert _tier(second) == "fetch", (
        f"served {_tier(second)!r} after a write: the pre-write Monitor leaked")
    assert ran["n"] == 1
    assert json.loads(second.content)["top_date"] == "2026-03-01"


def test_a_build_that_straddles_a_write_is_never_remembered(env):
    rm = env["rm"]
    bk = rm._body_cache_key(30, "", "le")
    gen0 = rm._history_generation(create=True)
    rec = {"body": b"{}", "nrows": 5, "gen": gen0, "gen_end": None}
    assert rm._history_good(rec) is False
    assert rm._history_good(dict(rec, gen_end=gen0)) is True
    assert rm._history_good(dict(rec, gen_end=gen0, nrows=0)) is False, "an empty build is not good"
    assert rm._history_stale().peek(bk) == (None, None)


def test_the_slot_is_bounded():
    from api.routers import breadth_monitor as rm
    s = rm._history_stale()
    assert s.max_age == rm.HISTORY_STALE_MAX_AGE <= 5 * rm._BODY_CACHE_TTL
    assert s.max_keys == 16
    assert rm._GEN_KEY.startswith("breadth_history_"), (
        "the generation must ride the prefix every writer already deletes")
