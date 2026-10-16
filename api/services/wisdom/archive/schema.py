"""archive migrations — additive only, ONE statement per migration (see
core/schema.py: store.init_db records a migration only when its whole script
succeeds, so a single statement is atomic and safely retried).

⛔ These are NEW tables. They are not wisdom_records / wisdom_segments and no
member-facing reader (publish/retrieval, dossier, askai, modelbook) selects
from them. ⛔ No share counts or position sizes are stored here (W1 §0.4d): the
batch validator refuses any field not named in the columns below.
"""
from __future__ import annotations

MIGRATIONS: list[tuple[str, str]] = [
    ("archive_001_records",
     "CREATE TABLE IF NOT EXISTS wisdom_archive_records ("
     " record_id TEXT PRIMARY KEY,"                       # 't1234'
     " author_id TEXT NOT NULL,"
     " stated_date TEXT NOT NULL,"
     " record_type TEXT NOT NULL CHECK (record_type IN ('CALL','RESULT','LESSON','MACRO')),"
     " tickers TEXT NOT NULL DEFAULT '',"                 # comma list, upper-case
     " note TEXT NOT NULL DEFAULT '',"
     " quote TEXT NOT NULL DEFAULT '',"
     " image_count INTEGER NOT NULL DEFAULT 0,"
     " sha TEXT NOT NULL,"
     " imported_at TEXT NOT NULL)"),
    ("archive_002_calls",
     "CREATE TABLE IF NOT EXISTS wisdom_archive_calls ("
     " call_id TEXT PRIMARY KEY,"                         # 't1234#0'
     " record_id TEXT NOT NULL,"
     " author_id TEXT NOT NULL,"
     " ticker TEXT NOT NULL,"
     " direction TEXT,"
     " setup TEXT,"
     " action TEXT,"
     " posted TEXT,"
     " entry REAL,"
     " stop REAL,"
     " target REAL,"
     " conf TEXT,"
     " reported TEXT,"
     " outcome_json TEXT NOT NULL DEFAULT '{}',"
     " methodology TEXT,"
     " sha TEXT NOT NULL,"
     " imported_at TEXT NOT NULL)"),
    ("archive_003_calls_ticker_idx",
     "CREATE INDEX IF NOT EXISTS ix_wisdom_archive_calls_ticker ON wisdom_archive_calls(ticker, posted)"),
    ("archive_004_calls_setup_idx",
     "CREATE INDEX IF NOT EXISTS ix_wisdom_archive_calls_setup ON wisdom_archive_calls(setup)"),
    ("archive_005_calls_record_idx",
     "CREATE INDEX IF NOT EXISTS ix_wisdom_archive_calls_record ON wisdom_archive_calls(record_id)"),
    # Own migration so a Python build without FTS5 fails only this one (logged,
    # retried next boot) and leaves the tables above in place. rowid = the
    # wisdom_archive_records rowid, kept stable by an ON CONFLICT upsert.
    ("archive_006_fts",
     "CREATE VIRTUAL TABLE IF NOT EXISTS wisdom_archive_fts USING fts5("
     " record_id UNINDEXED,"
     " author_id UNINDEXED,"
     " record_type UNINDEXED,"
     " stated_date UNINDEXED,"
     " tickers,"
     " note,"
     " quote,"
     " tokenize = 'porter unicode61')"),
]
