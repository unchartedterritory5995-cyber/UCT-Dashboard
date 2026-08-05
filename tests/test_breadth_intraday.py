"""The intraday store records the SHAPE of a session.

Two things it must never do: reach the permanent daily series, or break the live
read that owns the request. Everything below is about one of those, or about the
sparkline agreeing with the number printed next to it.
"""
from __future__ import annotations

import json
import sqlite3

import pytest


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setenv("BREADTH_INTRADAY_DB", str(tmp_path / "intraday.db"))
    from api.services import breadth_intraday as bi
    monkeypatch.setattr(bi, "_schema_ready", False)
    monkeypatch.setattr(bi, "_last_prune", 0.0)
    return bi


def _sample(i):
    return {"breadth_score": 60 + i, "pct_above_50sma": 45.0 + i,
            "adv_decline": 100 * i, "_measured": 2701}


def test_a_sample_round_trips_as_a_path(store):
    for i in range(3):
        assert store.record("2026-08-05", _sample(i), now=1_000 + i * 60)
    path = store.session_path("2026-08-05")
    assert [p[1] for p in path["breadth_score"]] == [60, 61, 62]
    assert path["breadth_score"][0][0] == 1_000        # oldest first


def test_diagnostics_are_not_stored_as_metrics(store):
    store.record("2026-08-05", _sample(0), now=1_000)
    assert "_measured" not in store.session_path(
        "2026-08-05", metrics=("_measured", "breadth_score"))


def test_samples_closer_than_the_minimum_interval_are_dropped(store):
    """`compute_live` caches ~55s, but a `force=1` refresh must not be able to
    turn a read into a write loop."""
    assert store.record("2026-08-05", _sample(0), now=1_000) is True
    assert store.record("2026-08-05", _sample(1), now=1_010) is False
    assert store.record("2026-08-05", _sample(2),
                        now=1_000 + store.MIN_SAMPLE_SECONDS) is True
    assert len(store.session_path("2026-08-05")["breadth_score"]) == 2


def test_sessions_do_not_bleed_into_each_other(store):
    store.record("2026-08-04", _sample(0), now=1_000)
    store.record("2026-08-05", _sample(5), now=100_000)
    assert [p[1] for p in store.session_path("2026-08-05")["breadth_score"]] == [65]
    assert [p[1] for p in store.session_path("2026-08-04")["breadth_score"]] == [60]


def test_downsampling_always_keeps_the_open_and_the_latest(store):
    """A sparkline whose last point isn't the current reading disagrees with the
    number printed beside it — the one thing it exists to corroborate."""
    for i in range(300):
        store.record("2026-08-05", _sample(i), now=1_000 + i * 60)
    full = store.session_path("2026-08-05", limit=0)["breadth_score"]
    thin = store.session_path("2026-08-05", limit=20)["breadth_score"]
    assert len(thin) <= 21
    assert thin[0] == full[0]
    assert thin[-1] == full[-1]
    assert [p[0] for p in thin] == sorted(p[0] for p in thin)


def test_the_open_is_the_first_sample_actually_taken(store):
    for i in range(5):
        store.record("2026-08-05", _sample(i), now=1_000 + i * 60)
    assert store.session_open("2026-08-05")["breadth_score"] == 60


def test_retention_drops_old_sessions_but_keeps_the_window(store, monkeypatch):
    from datetime import datetime, timezone
    now = int(datetime(2026, 8, 5, 20, 0, tzinfo=timezone.utc).timestamp())
    store.record("2026-07-01", _sample(0), now=now - 35 * 86_400)   # past the window
    store.record("2026-08-02", _sample(1), now=now - 3 * 86_400)    # inside it
    store.record("2026-08-05", _sample(2), now=now)
    monkeypatch.setattr(store, "_last_prune", 0.0)   # record() already pruned once
    store._maybe_prune(now)
    assert store.session_path("2026-07-01") == {}
    assert store.session_path("2026-08-02")
    assert store.session_path("2026-08-05")


def test_pruning_does_not_run_on_every_write(store, monkeypatch):
    """It is a housekeeping sweep, not part of recording a sample."""
    calls = []
    real = store._conn
    monkeypatch.setattr(store, "_conn", lambda: (calls.append(1), real())[1])
    for i in range(5):
        store.record("2026-08-05", _sample(i), now=1_000 + i * 60)
    # 5 writes = 5 connections, plus at most ONE for the first prune.
    assert len(calls) <= 6


def test_a_broken_store_never_takes_the_live_read_down(store, monkeypatch):
    """The live read is the product; this is a record of it."""
    def boom(*a, **k):
        raise sqlite3.OperationalError("disk I/O error")
    monkeypatch.setattr(store, "_conn", boom)
    assert store.record("2026-08-05", _sample(0)) is False
    assert store.session_path("2026-08-05") == {}
    assert store.session_open("2026-08-05") == {}
    assert "error" in store.status()


def test_nothing_is_written_without_a_session_or_metrics(store):
    assert store.record("", _sample(0)) is False
    assert store.record("2026-08-05", {}) is False


def test_the_store_is_a_separate_file_from_the_daily_series(store, tmp_path):
    """The collector is the only writer of `breadth_snapshots`. A different file
    with a different schema makes the mistake unavailable, not just unlikely —
    this is the NAAIM failure, where a placeholder indistinguishable from a
    reading sat in permanent history for 93 sessions."""
    from api.services import breadth_monitor
    assert store._db_path() != breadth_monitor._db_path()
    store.record("2026-08-05", _sample(0), now=1_000)
    with sqlite3.connect(store._db_path()) as c:
        tables = {r[0] for r in c.execute(
            "SELECT name FROM sqlite_master WHERE type='table'")}
    assert "breadth_snapshots" not in tables
    assert "breadth_intraday" in tables
