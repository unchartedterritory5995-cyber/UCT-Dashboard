"""company-news store: latest_source_ok() — the O(1) ingestion-health read the Agent's dormant news.company
kind needs instead of health_snapshot (which COUNTs every item). INGESTION time, never publication time."""
from __future__ import annotations

import os
import sqlite3
import tempfile
from datetime import datetime, timedelta, timezone

import pytest

from api.services.news import store


@pytest.fixture()
def db(tmp_path):
    store.set_db_path(str(tmp_path / "news_health.db"))
    yield
    store.set_db_path(os.path.join(tempfile.gettempdir(), "unused_news_health.db"))


def _set_last_ok(source: str, when: str) -> None:
    with sqlite3.connect(store.db_path()) as c:
        c.execute("UPDATE news_source_health SET last_ok=? WHERE source=?", (when, source))


def test_normal_newest_success_across_sources(db):
    store.record_health("fmp", ok=True)
    store.record_health("rss", ok=True)
    _set_last_ok("fmp", "2026-11-01T14:00:00+00:00")
    _set_last_ok("rss", "2026-11-01T15:30:00+00:00")
    assert store.latest_source_ok() == "2026-11-01T15:30:00+00:00"


def test_empty_table_is_none_never_now(db):
    assert store.latest_source_ok() is None


def test_sources_that_never_succeeded_are_missing_not_zero(db):
    store.record_health("fmp", ok=False, error="timeout")
    store.record_health("rss", ok=False, error="403")
    assert store.latest_source_ok() is None


def test_a_failed_poll_never_moves_it(db):
    store.record_health("fmp", ok=True)
    first = store.latest_source_ok()
    store.record_health("fmp", ok=False, error="boom")
    assert store.latest_source_ok() == first


def test_stale_health_is_returned_as_is_for_the_caller_to_judge(db):
    old = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()
    store.record_health("fmp", ok=True)
    _set_last_ok("fmp", old)
    assert store.latest_source_ok() == old          # no rounding to "now", no freshness claim here


def test_it_is_ingestion_time_not_publication_time(db):
    # a successful poll that brought no articles: ingestion is healthy, and nothing was published
    store.record_health("fmp", ok=True)
    _set_last_ok("fmp", "2026-11-01T15:30:00+00:00")
    assert store.latest_source_ok() == "2026-11-01T15:30:00+00:00"
    assert store.newest_published() == ""           # publication time is a different signal


def test_unreadable_health_is_none(db, monkeypatch):
    def broken():
        raise sqlite3.OperationalError("database is locked")
    store.latest_source_ok()                         # init the schema first
    monkeypatch.setattr(store, "_connect", broken)
    assert store.latest_source_ok() is None


def test_read_only_no_write(db):
    store.record_health("fmp", ok=True)
    with sqlite3.connect(store.db_path()) as c:
        before = c.execute("SELECT * FROM news_source_health").fetchall()
    store.latest_source_ok()
    with sqlite3.connect(store.db_path()) as c:
        assert c.execute("SELECT * FROM news_source_health").fetchall() == before
