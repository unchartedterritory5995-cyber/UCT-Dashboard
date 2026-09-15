"""core migrations. core_001 is the W1 base contract, read from the repo so the
DDL has exactly one authority: docs/wisdom/contracts/wisdom-db-v0.sql.

Once core_001 has been applied on production that file is FROZEN; every later
change is a new additive core_NNN migration appended here (Wave 1: no drops)."""
from __future__ import annotations

import pathlib

BASE_SCHEMA_FILE = (
    pathlib.Path(__file__).resolve().parents[4] / "docs" / "wisdom" / "contracts" / "wisdom-db-v0.sql"
)

MIGRATIONS: list[tuple[str, str]] = [
    ("core_001_base_v0", BASE_SCHEMA_FILE.read_text(encoding="utf-8")),
    # ── S-B additive migrations ────────────────────────────────────────────────
    # ONE statement per migration. store.init_db records a migration only when its
    # whole script succeeds, so a two-statement script that died after its ALTER
    # would retry forever on "duplicate column". A single statement is atomic.
    #
    # Word-level ASR aliases (W1 §3.5: "Bryan Shannon", "chairs"). They are not
    # tickers, and wisdom_ticker_aliases.ticker is NOT NULL.
    ("core_002_word_aliases",
     "CREATE TABLE IF NOT EXISTS wisdom_word_aliases ("
     " alias TEXT PRIMARY KEY COLLATE NOCASE,"
     " replacement TEXT NOT NULL,"
     " scope TEXT NOT NULL CHECK (scope IN ('asr','slang','speaker')),"
     " context_rule TEXT NOT NULL DEFAULT 'none' CHECK (context_rule IN ('none','ticker','quantity')),"
     " approved INTEGER NOT NULL DEFAULT 0,"
     " evidence_locator TEXT)"),
    # When an alias may fire: 'light' -> LITE only beside a price or a trading cue.
    ("core_003_ticker_alias_context_rule",
     "ALTER TABLE wisdom_ticker_aliases ADD COLUMN context_rule TEXT NOT NULL DEFAULT 'none'"),
    # W1 §0.3: an auto-promoted vocabulary entry ships provisional, under the owner's veto.
    ("core_004_vocab_provisional",
     "ALTER TABLE wisdom_vocab ADD COLUMN provisional INTEGER NOT NULL DEFAULT 0"),
    # One row per (candidate, record) so re-running extraction never double-counts a use,
    # and "independent" is a property of the source, not of the record count (W1 §3.6).
    ("core_005_vocab_candidate_uses",
     "CREATE TABLE IF NOT EXISTS wisdom_vocab_candidate_uses ("
     " raw_name TEXT NOT NULL COLLATE NOCASE,"
     " record_id TEXT NOT NULL,"
     " author_id TEXT,"
     " independence_key TEXT NOT NULL,"
     " locator TEXT,"
     " team_author INTEGER NOT NULL DEFAULT 0,"
     " created_at TEXT NOT NULL,"
     " PRIMARY KEY (raw_name, record_id))"),
    # Which committed seed file (by content hash) wisdom.db was last seeded from.
    ("core_006_seed_state",
     "CREATE TABLE IF NOT EXISTS wisdom_seed_state ("
     " seed_name TEXT PRIMARY KEY,"
     " version TEXT NOT NULL,"
     " content_sha256 TEXT NOT NULL,"
     " counts_json TEXT NOT NULL DEFAULT '{}',"
     " seeded_at TEXT NOT NULL)"),
    # ── Wave 1.5 item 3: the publication floor (owner ruling R10, 2026-09-14) ──
    #
    # ⛔⛔ A COLUMN, NEVER A FIELD. Stability must not enter the model's `fields` dict:
    # writer._canonical_hash hashes `fields | {"record_type": ...}`, so a field would change
    # every record_hash, every record_id, and defeat UNIQUE(segment_id, extractor_version,
    # record_hash) — re-extraction would duplicate the whole corpus. As a column it disturbs
    # nothing, and tests/test_wisdom_item3_floor.py pins record_hash/record_id across the
    # migration to prove it.
    #
    # ⚠️ NULLABLE ON PURPOSE. Every record that exists has no stability measurement yet, and
    # NULL must BLOCK (fail-closed). A NOT NULL DEFAULT 0.0 would be indistinguishable from a
    # measured zero, and a DEFAULT 1.0 would silently publish every unmeasured record — the
    # failure direction that cannot be walked back.
    ("core_007_records_stability",
     "ALTER TABLE wisdom_records ADD COLUMN stability REAL"),
    # How many passes the score was computed over, so "1.0 from one run" and "1.0 from 3/3"
    # are distinguishable. A ratio without its denominator is not a measurement.
    ("core_008_records_stability_runs",
     "ALTER TABLE wisdom_records ADD COLUMN stability_runs INTEGER"),
    # The Brain KB lane reads wisdom_principles DIRECTLY (brainkb.py:83-86), never
    # select_records, so the floor cannot reach it through wisdom_records alone.
    ("core_009_principles_stability",
     "ALTER TABLE wisdom_principles ADD COLUMN stability REAL"),
]
