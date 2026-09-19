"""sources migrations (stream S-C). Names start with "sources_". Additive only.

sources_001 is the Discord message ledger CONTRACTS.md §3 assigns to this
package, plus one VIEW that keeps the legacy-classified #tsdr corpus out of
extraction by construction (W1 §2.1: "reconcile ... so nothing double-counts").

sources_002 holds the two facts the base contract has no column for:
  * WHO a Sunday Scans section is attributed to and WHY (the D4 ruling is a
    provenance statement, not an author id, so it gets its own row);
  * each public-URL verification of a Sunday Scans issue (the base table keeps
    only the latest verdict in wisdom_sources.published_check).
"""
from __future__ import annotations

_SOURCES_001 = """
CREATE TABLE IF NOT EXISTS wisdom_discord_messages (
  message_id            TEXT PRIMARY KEY,
  channel_id            TEXT NOT NULL,
  author_id             TEXT,                    -- wisdom author id; NULL only for a legacy id not yet fetched
  created_at            TEXT NOT NULL,           -- ET ISO, derived from the snowflake
  segment_id            TEXT,                    -- the one wisdom_segments row for this message
  source_id             TEXT,
  legacy_classified     INTEGER NOT NULL DEFAULT 0,  -- 1 = in the 7,766-message pre-classified corpus; never re-extracted
  reply_to_message_id   TEXT,                    -- pointer only; the replied-to text is never read or stored
  attachments_json      TEXT NOT NULL DEFAULT '[]',  -- media pointers only
  ingested_at           TEXT
);
CREATE INDEX IF NOT EXISTS ix_discord_messages_channel ON wisdom_discord_messages(channel_id, message_id);
CREATE INDEX IF NOT EXISTS ix_discord_messages_segment ON wisdom_discord_messages(segment_id);

CREATE VIEW IF NOT EXISTS wisdom_sources_extractable_segments AS
  SELECT s.*
  FROM wisdom_segments s
  LEFT JOIN wisdom_discord_messages m ON m.segment_id = s.segment_id
  WHERE COALESCE(m.legacy_classified, 0) = 0;
"""

_SOURCES_002 = """
CREATE TABLE IF NOT EXISTS wisdom_source_attributions (
  segment_id            TEXT PRIMARY KEY,
  source_id             TEXT NOT NULL,
  author_id             TEXT,
  attribution_source    TEXT NOT NULL,           -- 'signed section' | 'D4 ruling'
  rule                  TEXT NOT NULL,           -- which matcher decided it
  section_title         TEXT
);
CREATE INDEX IF NOT EXISTS ix_source_attributions_source ON wisdom_source_attributions(source_id);

CREATE TABLE IF NOT EXISTS wisdom_sunday_scans_checks (
  check_id              TEXT PRIMARY KEY,
  lineage_id            TEXT NOT NULL,           -- sha24('sunday_scans' | external_ref): stable across versions
  url                   TEXT NOT NULL,
  checked_at            TEXT NOT NULL,
  result                TEXT NOT NULL CHECK (result IN ('public_api_match','mismatch','unchecked')),
  audience              TEXT,
  similarity            REAL,
  stored_sha256         TEXT,
  public_sha256         TEXT,
  reason                TEXT
);
CREATE INDEX IF NOT EXISTS ix_sunday_scans_checks_lineage ON wisdom_sunday_scans_checks(lineage_id, checked_at);
"""

# sources_003: the twitter.py tracking ledger (2026-09-19), the same role
# wisdom_discord_messages plays for Discord -- idempotency by primary key, since a
# tweet (unlike a Substack post) never changes after posting, so there is no
# content-hash re-versioning to track here.
_SOURCES_003 = """
CREATE TABLE IF NOT EXISTS wisdom_twitter_tweets (
  tweet_id              TEXT PRIMARY KEY,
  author_handle         TEXT NOT NULL,
  author_id             TEXT NOT NULL,           -- always resolved: authors.json x_handle match is exact, never ambiguous
  created_at            INTEGER,                 -- unix seconds, copied from tweets.db
  segment_id            TEXT,
  source_id             TEXT,
  ingested_at           TEXT
);
CREATE INDEX IF NOT EXISTS ix_twitter_tweets_author ON wisdom_twitter_tweets(author_id, created_at);
"""

MIGRATIONS: list[tuple[str, str]] = [
    ("sources_001_discord_messages", _SOURCES_001),
    ("sources_002_attributions_checks", _SOURCES_002),
    ("sources_003_twitter_tweets", _SOURCES_003),
]
