"""TERM-075 / FB-A8-01 — the primary-vs-mentioned bit on the tweet story-to-ticker join.

Stored ADDITIVELY: `tweet_tickers.is_primary INTEGER NOT NULL DEFAULT 1`, so every
existing row reads as today's behaviour (every mention is a subject). The poller
writes the resolver's answer on new rows. Readers honour it ONLY while
`A8_PRIMARY_MENTION_ENABLED` is on; with it off every subject-count surface is
byte-identical to before the column existed.

The acceptance fixture is the ticket's: one headline naming two tickers, where
the mention-only ticker is not counted as a subject on any surface.
"""
from __future__ import annotations

import ast
import contextlib
import os
import sqlite3
import tempfile
import time
from pathlib import Path

import pytest

from api.services import tweet_poller, tweet_store

REPO = Path(__file__).resolve().parents[1]
FLAG = "A8_PRIMARY_MENTION_ENABLED"
HEADLINE = "$AMD jumps after $NVDA raises guidance"


@pytest.fixture
def store(monkeypatch):
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(tweet_store, "_DB_PATH", os.path.join(d, "tweets.db"))
        monkeypatch.delenv(FLAG, raising=False)
        tweet_store._init_db()
        yield tweet_store


def _tweet(id_, text, created_at=None):
    return {
        "id": id_, "author_handle": "DeItaone", "author_name": "DeItaone",
        "text": text, "created_at": created_at or int(time.time()),
        "url": f"https://x.com/DeItaone/status/{id_}", "reply_count": 0,
        "like_count": 0, "retweet_count": 0, "is_retweet": 0, "raw_json": "{}",
    }


def _poll_one(store, monkeypatch, tweets):
    """Drive the REAL poller over a fake API so the write path is the product's."""
    store.add_account("DeItaone")
    monkeypatch.setattr(tweet_poller.twitterapi_io, "get_user_last_tweets",
                        lambda handle, since_id=None: tweets)
    return tweet_poller.poll_account("DeItaone")


def _rows(store):
    with contextlib.closing(sqlite3.connect(store._DB_PATH)) as c:
        return sorted(c.execute("SELECT tweet_id, ticker, is_primary FROM tweet_tickers").fetchall())


# ── storage: additive, default reproduces today ─────────────────────────────
def test_the_column_is_additive_with_a_default_of_primary(store):
    with contextlib.closing(sqlite3.connect(store._DB_PATH)) as c:
        cols = {r[1]: r for r in c.execute("PRAGMA table_info(tweet_tickers)")}
    assert "is_primary" in cols
    _, _, typ, notnull, default, _ = cols["is_primary"]
    assert typ.upper() == "INTEGER" and notnull == 1 and str(default) == "1"


def test_a_pre_existing_db_gains_the_column_and_every_old_row_reads_primary(monkeypatch):
    """A tweets.db created BEFORE the column (the production shape) is migrated in
    place by _init_db, and every row already there reads is_primary=1 — no row is
    rewritten, and nothing is lost."""
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "tweets.db")
        with contextlib.closing(sqlite3.connect(path)) as c:
            c.executescript(tweet_store._SCHEMA)
            c.execute("INSERT INTO tweets (id, author_handle, text, created_at, url, ingested_at) "
                      "VALUES ('1','a','$AMD and $NVDA',1,'u',1)")
            c.executemany("INSERT INTO tweet_tickers (tweet_id, ticker) VALUES (?, ?)",
                          [("1", "AMD"), ("1", "NVDA")])
            c.commit()
            assert "is_primary" not in {r[1] for r in c.execute("PRAGMA table_info(tweet_tickers)")}
        monkeypatch.setattr(tweet_store, "_DB_PATH", path)
        tweet_store._init_db()
        tweet_store._init_db()  # idempotent — a second boot must not raise
        assert _rows(tweet_store) == [("1", "AMD", 1), ("1", "NVDA", 1)]


def test_upsert_without_a_primary_map_writes_todays_rows(store):
    store.upsert_tweet(_tweet("9", HEADLINE), ["AMD", "NVDA"])
    assert _rows(store) == [("9", "AMD", 1), ("9", "NVDA", 1)]


def test_the_poller_stores_the_resolvers_bit(store, monkeypatch):
    out = _poll_one(store, monkeypatch, [_tweet("10", HEADLINE)])
    assert out["stored"] == 1
    assert _rows(store) == [("10", "AMD", 1), ("10", "NVDA", 0)]


def test_a_resolver_failure_never_loses_the_tweet(store, monkeypatch):
    """The bit is an annotation: if it cannot be computed the tweet is still
    stored with today's rows (every ticker primary), never dropped."""
    def boom(*a, **k):
        raise RuntimeError("resolver down")
    monkeypatch.setattr(tweet_poller, "resolve_primary", boom)
    out = _poll_one(store, monkeypatch, [_tweet("11", HEADLINE)])
    assert out["stored"] == 1
    assert _rows(store) == [("11", "AMD", 1), ("11", "NVDA", 1)]


# ── the acceptance fixture, on every subject surface ────────────────────────
def _seed(store, monkeypatch):
    _poll_one(store, monkeypatch, [_tweet("20", HEADLINE)])


def test_flag_OFF_every_surface_is_todays(store, monkeypatch):
    """Flag off (the default) ⇒ a mention-only ticker is still counted, exactly as
    before the column existed."""
    _seed(store, monkeypatch)
    assert [t["id"] for t in store.tweets_for_ticker("NVDA")] == ["20"]
    assert store.batch_counts(["AMD", "NVDA"]) == {"AMD": 1, "NVDA": 1}
    assert {r["ticker"] for r in store.tape()} == {"AMD", "NVDA"}
    assert sorted(store.feed()[0]["tickers"]) == ["AMD", "NVDA"]


def test_flag_ON_a_mention_only_ticker_is_not_a_subject_on_any_surface(store, monkeypatch):
    _seed(store, monkeypatch)
    monkeypatch.setenv(FLAG, "1")
    assert store.tweets_for_ticker("NVDA") == []
    assert [t["id"] for t in store.tweets_for_ticker("AMD")] == ["20"]
    assert store.batch_counts(["AMD", "NVDA"]) == {"AMD": 1, "NVDA": 0}
    tape = store.tape()
    assert [r["ticker"] for r in tape] == ["AMD"]
    assert tape[0]["n_tweets"] == 1 and tape[0]["sample_tweet"]["id"] == "20"
    # The feed lists what a story MENTIONS; it is not a subject count and is unchanged.
    assert sorted(store.feed()[0]["tickers"]) == ["AMD", "NVDA"]


def test_flag_ON_a_ticker_that_is_the_subject_elsewhere_still_counts_there(store, monkeypatch):
    _poll_one(store, monkeypatch, [_tweet("30", HEADLINE), _tweet("31", "$NVDA beats on revenue")])
    monkeypatch.setenv(FLAG, "1")
    assert [t["id"] for t in store.tweets_for_ticker("NVDA")] == ["31"]
    assert store.batch_counts(["NVDA"]) == {"NVDA": 1}
    tape = {r["ticker"]: r for r in store.tape()}
    assert tape["NVDA"]["n_tweets"] == 1 and tape["NVDA"]["sample_tweet"]["id"] == "31"


def test_the_catalyst_engines_tweet_signal_honours_the_bit(store, monkeypatch):
    """The catalyst engine's tweet_mention_count comes from tape + tweets_for_ticker;
    with the flag on, the mentioned ticker earns no tweet signal from this story."""
    from api.services.catalyst import news_match, sources
    monkeypatch.setattr(news_match, "match_tickers", lambda text: set())
    _seed(store, monkeypatch)
    assert set(sources._pull_tweet_signals()) == {"AMD", "NVDA"}
    monkeypatch.setenv(FLAG, "1")
    assert set(sources._pull_tweet_signals()) == {"AMD"}


# ── the reader population is derived, not typed ─────────────────────────────
def _sql_readers_of_tweet_tickers() -> set[str]:
    """Every product module holding a SQL string that READS tweet_tickers."""
    out = set()
    for top in ("api", "tools", "scripts"):
        for p in (REPO / top).rglob("*.py"):
            rel = p.relative_to(REPO).as_posix()
            if "/tests/" in rel or p.name.startswith("test_") or p.name == "conftest.py":
                continue
            try:
                tree = ast.parse(p.read_text(encoding="utf-8"))
            except (SyntaxError, UnicodeDecodeError):
                continue
            for n in ast.walk(tree):
                if isinstance(n, ast.Constant) and isinstance(n.value, str):
                    v = " ".join(n.value.split())
                    if "FROM tweet_tickers" in v or "JOIN tweet_tickers" in v:
                        out.add(rel)
    return out


#: A reader that lists what a story MENTIONS (not a subject count) may ignore the
#: bit. Recorded, with why; anything else reading the table must live in tweet_store.
MENTION_LISTERS = {
    "api/services/wisdom/evals/context.py":
        "eval tooling that prints every ticker a tweet names — a mention list, like feed()",
}


def test_every_reader_of_the_join_is_tweet_store_or_a_recorded_mention_lister():
    readers = _sql_readers_of_tweet_tickers()
    assert "api/services/tweet_store.py" in readers  # non-vacuity: the scan sees the real one
    stray = sorted(readers - {"api/services/tweet_store.py"} - set(MENTION_LISTERS))
    assert not stray, ("these modules read tweet_tickers directly and would count a "
                       "mention-only ticker as a subject:\n" + "\n".join(stray))
    missing = sorted(set(MENTION_LISTERS) - readers)
    assert not missing, f"recorded mention-listers no longer read the table: {missing}"
