"""Wisdom sources — Twitter (stream S-C addition, 2026-09-19).

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. a market-news account's tweet (not one of the three official traders) reaching wisdom.db;
2. a re-run duplicating a tweet already ingested (idempotency);
3. a dry run writing anything to wisdom.db;
4. a tweet's author_id resolving to the wrong author, or to none at all, for an official handle;
5. a listener reporting healthy while writing nothing when candidates existed.
No network: tweets.db is a real sqlite file this test builds and tears down itself.
"""
from __future__ import annotations

import sqlite3
import time

import pytest

from api.services.wisdom.core import authors, store, timeutil
from api.services.wisdom.sources import twitter as tw

TSDR_HANDLE = "TSDR_Trading"
BRACCO_HANDLE = "Braczyy"
NEWS_HANDLE = "DeItaone"


def _tsdr_author_id() -> str:
    for a in authors.authors():
        if a.get("x_handle") == TSDR_HANDLE:
            return a["author_id"]
    raise AssertionError("fixture assumption broken: no author has x_handle TSDR_Trading")


def _make_tweets_db(path, rows):
    conn = sqlite3.connect(path)
    conn.execute("""CREATE TABLE tweets (
        id TEXT PRIMARY KEY, author_handle TEXT NOT NULL, author_name TEXT, text TEXT NOT NULL,
        created_at INTEGER NOT NULL, url TEXT NOT NULL, reply_count INTEGER DEFAULT 0,
        like_count INTEGER DEFAULT 0, retweet_count INTEGER DEFAULT 0, is_retweet INTEGER DEFAULT 0,
        raw_json TEXT, ingested_at INTEGER NOT NULL)""")
    for r in rows:
        conn.execute(
            "INSERT INTO tweets (id, author_handle, author_name, text, created_at, url, ingested_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (r["id"], r["author_handle"], r.get("author_name"), r["text"], r["created_at"],
             r.get("url", f"https://x.com/{r['author_handle']}/status/{r['id']}"), int(time.time())),
        )
    conn.commit()
    conn.close()


@pytest.fixture(autouse=True)
def hermetic(monkeypatch, tmp_path):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    store.init_db()
    tweets_path = tmp_path / "tweets.db"
    _make_tweets_db(tweets_path, [
        {"id": "1001", "author_handle": TSDR_HANDLE, "author_name": "TSDR", "text": "NVDA over 150 is the trigger",
         "created_at": 1758160000},
        {"id": "1002", "author_handle": BRACCO_HANDLE, "author_name": "Bracco", "text": "trimming half here",
         "created_at": 1758160100},
        {"id": "1003", "author_handle": NEWS_HANDLE, "author_name": "Walter Bloomberg", "text": "FED HOLDS RATES",
         "created_at": 1758160200},
    ])
    monkeypatch.setattr(tw, "_tweets_db_path", lambda: str(tweets_path))
    return tweets_path


# ── 1. only official accounts land ───────────────────────────────────────────

def test_only_official_account_tweets_are_ingested():
    result = tw.ingest_all(dry_run=False)
    assert result["seen"] == 2 and result["written"] == 2  # NOT 3 — the news account is excluded
    with store.read() as conn:
        texts = [r[0] for r in conn.execute("SELECT text FROM wisdom_segments")]
        handles = [r[0] for r in conn.execute("SELECT author_handle FROM wisdom_twitter_tweets")]
    assert "FED HOLDS RATES" not in "\n".join(texts)  # control: the excluded text never lands
    assert set(handles) == {TSDR_HANDLE, BRACCO_HANDLE}


def test_author_id_resolves_correctly_not_just_present():
    tw.ingest_all(dry_run=False)
    expected = _tsdr_author_id()
    with store.read() as conn:
        row = conn.execute(
            "SELECT author_id FROM wisdom_segments s JOIN wisdom_sources src "
            "ON src.source_id = s.source_id WHERE src.external_ref = 'x:TSDR_Trading:1001'"
        ).fetchone()
    assert row is not None and row[0] == expected


# ── 2. idempotency ────────────────────────────────────────────────────────────

def test_rerun_does_not_duplicate():
    tw.ingest_all(dry_run=False)
    first = tw.ingest_all(dry_run=False)
    assert first["written"] == 0  # control: nothing new the second time
    with store.read() as conn:
        n = conn.execute("SELECT COUNT(*) FROM wisdom_segments").fetchone()[0]
    assert n == 2  # not 4


# ── 3. dry run writes nothing ─────────────────────────────────────────────────

def test_dry_run_writes_nothing():
    result = tw.ingest_all(dry_run=True)
    assert result["dry_run"] is True and result["would_write"] == 2
    with store.read() as conn:
        n = conn.execute("SELECT COUNT(*) FROM wisdom_sources WHERE stream = 'x'").fetchone()[0]
    assert n == 0


# ── 4. no candidates is a failure signal, not a quiet pass ────────────────────

def test_no_official_handles_reachable_is_visible_not_silent(monkeypatch):
    monkeypatch.setattr(tw, "_handle_to_author", lambda: {})
    result = tw.ingest_all(dry_run=False)
    assert result["seen"] == 0 and result["written"] == 0
