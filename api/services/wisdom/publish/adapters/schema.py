"""Tables owned by the dark publish adapters (stream S-F, docs/wisdom/CONTRACTS.md §3 "publish" row).

⛔ THE REGISTRY DOES NOT READ THIS FILE. `registry.schema_migrations()` reads
`api.services.wisdom.publish.schema.MIGRATIONS`, which stream S-F1 owns. That
list must end with `+ adapters_schema.MIGRATIONS` or none of these tables exist
in production. Names start with ``publish_`` so the registry's prefix check
admits them. `tests/test_wisdom_publish_adapters_store.py` fails by name once
S-F1's code is in the tree and the append is missing.

Additive DDL only (W1 §11.5). The FTS table has its own migration: a Python
build without FTS5 fails that one migration (logged, retried next boot) and
leaves every other table in place.

Tables beyond the §3 list, each needing a contract row from the integrator:
  * wisdom_d20_scoring_runs — the silent-scoring ledger the D20 14-day gate reads.
    A day with zero crosses writes no cross row, so without a run ledger "scored
    silently for two weeks" could not be told apart from "never ran".
  * wisdom_retrieval_docs — the incremental-refresh ledger for the FTS index
    (doc hash + FTS rowid, so a changed document is replaced by rowid, not a scan).
"""
from __future__ import annotations

_CORE_TABLES = """
CREATE TABLE IF NOT EXISTS wisdom_drafts (
  draft_id               TEXT PRIMARY KEY,                -- sha24('draft'|kind|subject_ref)
  kind                   TEXT NOT NULL,                   -- pv_exemplar | modelbook_example | modelbook_playbook | desk_title_style | voice_principle_sourcing
  subject_ref            TEXT NOT NULL,
  title                  TEXT NOT NULL,
  payload_json           TEXT NOT NULL DEFAULT '{}',
  citations_json         TEXT NOT NULL DEFAULT '[]',     -- interim S8 locators wisdom:<source_id>#<segment_id>@<t_or_section>
  status                 TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','rejected','published','superseded')),
  provisional            INTEGER NOT NULL DEFAULT 1,
  generator_version      TEXT NOT NULL,
  content_sha256         TEXT NOT NULL,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL,
  decided_at             TEXT,
  decided_by             TEXT,
  published_ref          TEXT,
  note                   TEXT
);
CREATE INDEX IF NOT EXISTS ix_drafts_kind ON wisdom_drafts(kind, status);

CREATE TABLE IF NOT EXISTS wisdom_kb_rows (
  source_ref             TEXT PRIMARY KEY,                -- wisdom:<kind>:<key>
  kind                   TEXT NOT NULL CHECK (kind IN ('principle','lesson')),
  subject_key            TEXT NOT NULL,
  category               TEXT NOT NULL,
  title                  TEXT NOT NULL,
  content                TEXT NOT NULL,
  tags                   TEXT NOT NULL DEFAULT '',
  trader                 TEXT NOT NULL,
  knowledge_epoch        TEXT NOT NULL,
  priority               INTEGER NOT NULL DEFAULT 3,
  regime_context         TEXT NOT NULL DEFAULT '',
  provisional            INTEGER NOT NULL DEFAULT 1,
  content_sha256         TEXT NOT NULL,
  state                  TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','superseded')),
  built_at               TEXT NOT NULL,
  superseded_at          TEXT
);

CREATE TABLE IF NOT EXISTS wisdom_level_crosses (
  record_id              TEXT NOT NULL,
  level_kind             TEXT NOT NULL,                   -- entry_zone_lo | entry_zone_hi | stop | target | level:<type>
  level_price            REAL NOT NULL,
  session_date           TEXT NOT NULL,
  ticker                 TEXT NOT NULL,
  cross_direction        TEXT NOT NULL CHECK (cross_direction IN ('up','down')),
  prev_close             REAL,
  bar_high               REAL,
  bar_low                REAL,
  model_version          TEXT NOT NULL,
  scored_at              TEXT NOT NULL,
  delivered              INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (record_id, level_kind, level_price, session_date)
);

CREATE TABLE IF NOT EXISTS wisdom_lookalike_scores (
  session_date           TEXT NOT NULL,
  ticker                 TEXT NOT NULL,
  model_version          TEXT NOT NULL,
  score                  REAL NOT NULL,
  rank                   INTEGER NOT NULL,
  provider               TEXT NOT NULL,
  features_json          TEXT NOT NULL,
  nearest_record_ids_json TEXT NOT NULL DEFAULT '[]',
  matched_record_id      TEXT,
  matched_session        TEXT,
  scored_at              TEXT NOT NULL,
  delivered              INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (session_date, ticker, model_version)
);

CREATE TABLE IF NOT EXISTS wisdom_d20_scoring_runs (
  scorer                 TEXT NOT NULL CHECK (scorer IN ('level_alerts','lookalike')),
  session_date           TEXT NOT NULL,
  scored_at              TEXT NOT NULL,
  n_scored               INTEGER NOT NULL,
  n_written              INTEGER NOT NULL,
  note                   TEXT,
  PRIMARY KEY (scorer, session_date)
);

CREATE TABLE IF NOT EXISTS wisdom_retrieval_docs (
  doc_id                 TEXT PRIMARY KEY,                -- seg:<segment_id> | pr:<principle_key>
  doc_sha256             TEXT NOT NULL,
  fts_rowid              INTEGER,
  indexed_at             TEXT NOT NULL
);
"""

_FTS = """
CREATE VIRTUAL TABLE IF NOT EXISTS wisdom_segments_fts USING fts5(
  doc_id UNINDEXED,
  doc_kind UNINDEXED,
  source_id UNINDEXED,
  segment_id UNINDEXED,
  author_id UNINDEXED,
  is_guest UNINDEXED,
  stated_at UNINDEXED,
  status UNINDEXED,
  locator UNINDEXED,
  tickers,
  text,
  tokenize = 'porter unicode61'
);
"""

MIGRATIONS: list[tuple[str, str]] = [
    ("publish_adapters_001_drafts_kb_d20_docs", _CORE_TABLES),
    ("publish_adapters_002_segments_fts", _FTS),
]
