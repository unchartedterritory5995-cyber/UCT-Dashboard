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
    # Setup playbooks: one row per setup of the team's taxonomy, built from the whole ledger
    # (definition, measured stats, context cuts, teaching record ids, best/worst calls). No image
    # paths and no long quotes: teachings point at wisdom_archive_records by record id.
    ("archive_007_setups",
     "CREATE TABLE IF NOT EXISTS wisdom_archive_setups ("
     " setup_id TEXT PRIMARY KEY,"                        # 'kicker'
     " name TEXT NOT NULL,"
     " family TEXT,"
     " aliases_json TEXT NOT NULL DEFAULT '[]',"
     " used_by_json TEXT NOT NULL DEFAULT '[]',"
     " stats_json TEXT NOT NULL DEFAULT '{}',"           # {"all": {...}, "trades": {...}}
     " context_json TEXT NOT NULL DEFAULT '{}',"
     " teachings_json TEXT NOT NULL DEFAULT '[]',"
     " winners_json TEXT NOT NULL DEFAULT '[]',"
     " failures_json TEXT NOT NULL DEFAULT '[]',"
     " sha TEXT NOT NULL,"
     " imported_at TEXT NOT NULL)"),
    # Chart images (owner decision 4, 2026-10-16): metadata only. The bytes live in private
    # storage (R2, else the volume) -- see archive/images.py. image_id = sha256 of the bytes.
    ("archive_008_images",
     "CREATE TABLE IF NOT EXISTS wisdom_archive_images ("
     " image_id TEXT PRIMARY KEY,"
     " record_id TEXT NOT NULL,"
     " ordinal INTEGER NOT NULL DEFAULT 0,"
     " storage_key TEXT NOT NULL,"
     " bytes INTEGER NOT NULL,"
     " width INTEGER,"
     " height INTEGER,"
     " content_type TEXT NOT NULL,"
     " imported_at TEXT NOT NULL)"),
    ("archive_009_images_record_idx",
     "CREATE INDEX IF NOT EXISTS ix_wisdom_archive_images_record ON wisdom_archive_images(record_id, ordinal)"),
    # Call -> Desk session moment links (archive/call_moments.py): one row per (call, video), the
    # second the ticker was discussed and the match's confidence. Derived, so a full refresh
    # replaces every row; no price, no transcript text. The youtube id and second are what the
    # member surfaces (require_paid only) turn into a "watch at m:ss" link.
    ("archive_010_call_moments",
     "CREATE TABLE IF NOT EXISTS wisdom_archive_call_moments ("
     " call_id TEXT NOT NULL,"
     " video_id INTEGER NOT NULL,"
     " youtube_id TEXT NOT NULL,"
     " t INTEGER NOT NULL,"                               # seconds into the video
     " ticker TEXT NOT NULL,"
     " session_date TEXT NOT NULL,"
     " relation TEXT NOT NULL,"                           # same_day | same_day_after_close | next_session
     " confidence REAL NOT NULL,"
     " computed_at TEXT NOT NULL,"
     " PRIMARY KEY (call_id, video_id))"),
]
