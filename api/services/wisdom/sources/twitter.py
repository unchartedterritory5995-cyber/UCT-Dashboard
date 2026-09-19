"""Twitter source (stream S-C addition, 2026-09-19): the three official trader accounts
only, read from the existing tweets.db cache -- never a second fetcher.

WHY THIS MODULE NEVER TALKS TO THE TWITTER API. `api/services/twitterapi_io.py` +
`tweet_poller.py` already own fetching, rate limiting and the account roster; a second
fetcher here would be a second authority over the same data. This module is READ-ONLY
against tweets.db (`mode=ro`), the same discipline `sunday_scans.py` uses against desk.db.

WHY THIS IS URGENT. `tweet_cleanup.py` hard-deletes anything older than
TWEET_RETENTION_DAYS (unset -> 7-day code default) every night. A tweet not copied
into wisdom_sources before that sweep is gone for good -- there is no undo and no
second chance to backfill it later. The listener therefore polls every few hours,
not daily.

AUTHOR FILTER (S0.4e, mirrors Discord's allowlist exactly, but simpler). tweets.db
holds ~19 accounts: the three official traders (TSDR_Trading, Braczyy, 1ChartMaster --
`tweet_store.OFFICIAL_ACCOUNTS`) plus curated market-news accounts (DeItaone,
WallStEngine, ...) that feed Stock Catalysts / MoversSidebar and have NOTHING to do
with the Wisdom Loop. `author_handle` already maps 1:1 onto `authors.json`'s
`x_handle` field, so unlike Discord (channel membership) or Sunday Scans (section
heading matching), attribution here needs no matcher at all -- it is a plain
dictionary lookup, and every match is high-confidence: an official account's own
tweet is unambiguously that trader's words.

VERSIONING. A tweet, once posted, does not change (unlike a Substack post an owner
can edit) -- so unlike sunday_scans.py this module never re-versions a source. It
follows Discord's simpler model instead: one tweet = one source = one segment,
version always 1, idempotency by primary key (wisdom_twitter_tweets.tweet_id) rather
than a content-hash comparison.

NO R2 WRITE. Like Discord messages and unlike Sunday Scans issues, a tweet's text
lives directly in wisdom_segments.text -- raw_r2_key stays NULL. A single short post
does not need an immutable object store entry of its own.
"""
from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional

from api.services.wisdom.core import ids, timeutil

# ⛔ STREAM MUST BE 'x', NOT 'twitter'. wisdom-db-v0.sql's base CHECK constraint on
# wisdom_sources.stream only allows a fixed enum, and 'x' -- not 'twitter' -- is the
# value already reserved there for exactly this source (external_ref comment in the
# same contract: "x:<handle>:<id>"). Every value outside that enum fails the CHECK
# and INSERT OR IGNORE swallows the violation silently: written=N gets reported while
# zero rows land, with no exception anywhere. Measured directly, 2026-09-19 -- this
# is not a hypothetical, it is what 'twitter' as the stream value actually does.
STREAM = "x"
NORMALIZER_VERSION = "twitter-v1"


# ── tweets.db (read-only) ────────────────────────────────────────────────────

def _tweets_db_path() -> str:
    from api.services import tweet_store

    return tweet_store._DB_PATH


def _handle_to_author() -> dict[str, str]:
    """{x_handle: author_id} for every author who has one, case-sensitive exact match --
    same discipline as every other identity match in this programme (CONTRACTS §2.1:
    'matched exactly, never inferred')."""
    from api.services.wisdom.core import authors

    return {a["x_handle"]: a["author_id"] for a in authors.authors() if a.get("x_handle")}


def official_tweets(limit: Optional[int] = None) -> list[dict]:
    """Every tweet from a handle in authors.json's x_handle set, oldest first so a
    resumed run processes in a stable, replayable order. Empty list, never raises,
    when tweets.db doesn't exist yet (mirrors sunday_scans.published_issues)."""
    handles = _handle_to_author()
    if not handles:
        return []
    path = Path(_tweets_db_path())
    if not path.exists():
        return []
    conn = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True, timeout=5.0)
    conn.row_factory = sqlite3.Row
    try:
        placeholders = ", ".join("?" for _ in handles)
        rows = [dict(r) for r in conn.execute(
            f"SELECT id, author_handle, author_name, text, created_at, url "
            f"FROM tweets WHERE author_handle IN ({placeholders}) "
            f"ORDER BY created_at ASC, id ASC",
            tuple(handles.keys()),
        )]
    finally:
        conn.close()
    for r in rows:
        r["author_id"] = handles[r["author_handle"]]
    if limit is not None:
        rows = rows[:int(limit)]
    return rows


def external_ref_for(handle: str, tweet_id: str) -> str:
    """Matches the contract's own documented shape: 'x:<handle>:<id>'."""
    return f"x:{handle}:{tweet_id}"


def _et_from_epoch(value) -> Optional[str]:
    try:
        return timeutil.iso_et(datetime.fromtimestamp(int(value), tz=timezone.utc))
    except (TypeError, ValueError, OSError, OverflowError):
        return None


# ── ingest ───────────────────────────────────────────────────────────────────

def ingest_tweet(tweet: dict, conn: sqlite3.Connection, *, now_iso: str) -> str:
    """Write one tweet's source+segment if not already tracked. Caller holds the
    write transaction. Returns 'written' or 'already_tracked'."""
    from api.services.wisdom.sources import common

    tweet_id = str(tweet["id"])
    existing = conn.execute(
        "SELECT segment_id FROM wisdom_twitter_tweets WHERE tweet_id = ?", (tweet_id,)
    ).fetchone()
    if existing is not None and existing["segment_id"]:
        return "already_tracked"
    external_ref = external_ref_for(tweet["author_handle"], tweet_id)
    text = tweet.get("text") or ""
    author_id = tweet["author_id"]
    raw_sha = ids.sha256_text(text)
    source_id = common.source_id_for(STREAM, external_ref, 1)
    common.insert_source(conn, {
        "source_id": source_id, "stream": STREAM, "external_ref": external_ref, "version": 1,
        "home_pointer": f"twitter handle={tweet['author_handle']} id={tweet_id}",
        "published_at_et": _et_from_epoch(tweet.get("created_at")),
        "title": text[:80] if text else None, "host_author_id": author_id,
        "raw_r2_key": None, "raw_sha256": raw_sha,
        "media_pointer": tweet.get("url") or None,
        "ingested_at": now_iso,
    })
    common.insert_segments(conn, source_id, 1, [{
        # kind is CHECK-constrained to a fixed enum (wisdom-db-v0.sql) that has no
        # 'tweet' value -- 'message' is the same shape Discord uses for one short
        # authored post, and INSERT OR IGNORE would otherwise swallow this silently
        # exactly like the STREAM enum violation above did (measured, 2026-09-19).
        "ordinal": 0, "kind": "message", "char_start": 0, "char_end": len(text),
        "speaker_label": tweet.get("author_name") or tweet.get("author_handle"),
        "author_id": author_id, "speaker_confidence": "high", "text": text,
    }], NORMALIZER_VERSION)
    segment_id = common.segment_id_for(source_id, 1, 0)
    conn.execute(
        """INSERT INTO wisdom_twitter_tweets
             (tweet_id, author_handle, author_id, created_at, segment_id, source_id, ingested_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(tweet_id) DO UPDATE SET
             segment_id = excluded.segment_id, source_id = excluded.source_id,
             ingested_at = excluded.ingested_at""",
        (tweet_id, tweet["author_handle"], author_id, tweet.get("created_at"),
         segment_id, source_id, now_iso),
    )
    return "written"


def ingest_all(*, limit: int = 500, dry_run: bool = False,
               log: Callable[[str], None] = None) -> dict:
    """Copy every not-yet-tracked official-account tweet into wisdom_sources/segments.
    dry_run writes nothing (no wisdom.db rows), mirroring every other source's contract."""
    from api.services.wisdom.core import store

    tweets = official_tweets(limit=limit)
    if dry_run:
        with store.read() as conn:
            tracked = {r[0] for r in conn.execute("SELECT tweet_id FROM wisdom_twitter_tweets")}
        new = [t for t in tweets if str(t["id"]) not in tracked]
        return {"seen": len(tweets), "would_write": len(new), "dry_run": True}
    now_iso = timeutil.iso_et(timeutil.now_et())
    written = 0
    errors: list[dict] = []
    with store.write() as conn:
        for tweet in tweets:
            try:
                outcome = ingest_tweet(tweet, conn, now_iso=now_iso)
            except Exception as exc:  # noqa: BLE001 — one bad row never stops the walk
                errors.append({"tweet_id": tweet.get("id"), "error": f"{type(exc).__name__}: {str(exc)[:200]}"})
                continue
            if outcome == "written":
                written += 1
                if log:
                    log(f"twitter {tweet['author_handle']} {tweet['id']} written")
    return {"seen": len(tweets), "written": written, "errors": errors, "dry_run": False}
