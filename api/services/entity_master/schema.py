"""Entity Master SQLite schema — canonical instrument identity store.

One new database, `<DATA_DIR>/entity_master.db`, WAL mode — following the
bars.db/cot.db/catalysts.db per-domain-database convention already
established in this codebase (never a table added to auth.db). The
`_migrations` table + one-(name, sql)-tuple-list-applied-once pattern is
copied directly from `api/services/bars_sqlite.py` (lines 171-193, read in
full before this module was written), per
docs/terminal-research/07-technical-architecture/specs/entity-master-spec.md
§2.1 and §4.2, which this file's DDL transcribes verbatim except for one
corrected comment (see CHECKPOINT-1 NOTE below).

CHECKPOINT-1 NOTE (2026-09-02): the spec's own §20 flagged the `entities
.entity_type` value set ('equity'|'etf'|'index'|'future_positioning') as an
UNCONFIRMED guess — it explicitly says `api/ticker_types.py` was not read in
full before that guess was written. Per this implementation's Condition 1,
`ticker_types.normalize_type()` was read in full before this schema was
written. Its real output space is `STOCK|ETF|INDEX|OTHER` (uppercase, four
buckets, no `future_positioning` value — that bucket has nothing to do with
equities/ETF classification; it reads as a placeholder for OI-05's still-open
asset-class-scope question). This is a value-set/casing mismatch in a
non-enforced free-text column's documentation comment, not a structural
contradiction of the schema (no CHECK constraint depends on it, no primitive
signature assumes a specific value set) — so per the "evidence wins, record
the deviation" instruction this did not trigger a Condition-1 STOP. The
comment below is corrected to match verified reality; the column itself
(TEXT NOT NULL, no CHECK) is unchanged from the spec.
"""
import os
import sqlite3
import time

DB_PATH = os.path.join(os.environ.get("DATA_DIR", "/data"), "entity_master.db")

# Verbatim from entity-master-spec.md §4.2, except the `entity_type` comment
# (see CHECKPOINT-1 NOTE above).
_SCHEMA = """
CREATE TABLE IF NOT EXISTS entities (
    entity_id       TEXT PRIMARY KEY,          -- ent_<ULID>
    entity_type     TEXT NOT NULL,              -- seed-time values: 'equity' | 'etf' | 'index'
                                                  -- (mapped from ticker_types.normalize_type()'s
                                                  -- STOCK|ETF|INDEX|OTHER — OTHER is not assigned
                                                  -- an entity at seed time). 'future_positioning'
                                                  -- reserved per OI-05 (asset-class scope, open),
                                                  -- unused until that asset class is authorized.
    lifecycle_state TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'delisted' | 'renamed_successor_exists'
    lifecycle_since TEXT,                       -- ISO date the state last changed; NULL while active-since-creation
    created_at      TEXT NOT NULL,              -- ISO 8601 UTC
    updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entity_aliases (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id       TEXT NOT NULL REFERENCES entities(entity_id),
    alias           TEXT NOT NULL,              -- the ticker string, always upper-cased
    valid_from      TEXT NOT NULL,               -- ISO date
    valid_to        TEXT,                        -- ISO date, NULL = open-ended (currently valid)
    source          TEXT NOT NULL,               -- 'seed:cap_universe' | 'seed:massive_reference'
                                                   -- | 'seed:delisted_registry' | 'event:<event_id>'
    created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alias_lookup ON entity_aliases(alias, valid_from, valid_to);
CREATE INDEX IF NOT EXISTS idx_alias_entity ON entity_aliases(entity_id);

CREATE TABLE IF NOT EXISTS entity_vendor_symbols (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id       TEXT NOT NULL REFERENCES entities(entity_id),
    vendor          TEXT NOT NULL,               -- 'massive' | 'fmp' | ... (D1's adapter registry keys)
    vendor_symbol   TEXT NOT NULL,
    valid_from      TEXT NOT NULL,
    valid_to        TEXT,
    source          TEXT NOT NULL,               -- 'derived:dot_notation' | 'event:<event_id>' | 'seed:...'
    created_at      TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_symbol_lookup
    ON entity_vendor_symbols(entity_id, vendor, valid_from);

CREATE TABLE IF NOT EXISTS entity_figi (
    entity_id        TEXT PRIMARY KEY REFERENCES entities(entity_id),
    composite_figi   TEXT,
    share_class_figi TEXT,
    source           TEXT NOT NULL,              -- 'massive_reference' | 'openfigi'
    updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_figi_composite ON entity_figi(composite_figi);

CREATE TABLE IF NOT EXISTS entity_relations (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id           TEXT NOT NULL REFERENCES entities(entity_id),
    related_entity_id   TEXT NOT NULL REFERENCES entities(entity_id),
    kind                TEXT NOT NULL,           -- 'successor' | 'predecessor' | 'share_class'
    valid_from          TEXT NOT NULL,
    source              TEXT NOT NULL,
    created_at          TEXT NOT NULL,
    CHECK (kind IN ('successor', 'predecessor', 'share_class')),
    CHECK (entity_id != related_entity_id)
);
CREATE INDEX IF NOT EXISTS idx_relation_entity ON entity_relations(entity_id, kind);

CREATE TABLE IF NOT EXISTS entity_events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    dedup_key       TEXT NOT NULL UNIQUE,        -- caller-supplied idempotency key (AC-5)
    entity_id       TEXT REFERENCES entities(entity_id),  -- NULL for a 'new_entity' event pre-assignment
    event_type      TEXT NOT NULL,               -- 'new_entity' | 'alias_added' | 'alias_retired'
                                                   -- | 'delisted' | 'renamed' | 'relation_added'
    payload_json    TEXT NOT NULL,               -- typed per event_type, see spec §4.3
    source           TEXT NOT NULL,              -- 'd5' | 'reconciliation' | 'admin_manual'
    applied_at      TEXT NOT NULL,
    rejected_reason TEXT                          -- non-NULL when the write was refused (spec §8.4 / PRD §13.1)
);
CREATE INDEX IF NOT EXISTS idx_events_entity ON entity_events(entity_id);

CREATE TABLE IF NOT EXISTS _migrations (
    name        TEXT PRIMARY KEY,
    applied_at  INTEGER
);
"""

# One (name, sql) tuple per future schema change, applied exactly once,
# mirroring bars_sqlite.py's `_migrations` list (lines 183-190). Empty at
# this schema's introduction — nothing to migrate yet.
_MIGRATIONS: list[tuple[str, str]] = []


def connect(db_path: str | None = None) -> sqlite3.Connection:
    """Open a WAL-mode connection. Does not create tables — call init_db()."""
    path = db_path or DB_PATH
    os.makedirs(os.path.dirname(path), exist_ok=True)
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def init_db(conn: sqlite3.Connection | None = None, db_path: str | None = None) -> sqlite3.Connection:
    """Create every table/index if absent, then apply any un-applied migration
    exactly once. Idempotent and safe to call on every process boot (matches
    bars_sqlite.py's init_db() contract) — re-running against an
    already-initialized database is a no-op beyond the migration-ledger check.

    Never touches any existing store (bars.db, auth.db, cot.db, ...): this
    function only ever opens/creates `entity_master.db`.
    """
    c = conn if conn is not None else connect(db_path)
    c.executescript(_SCHEMA)
    for name, sql in _MIGRATIONS:
        already = c.execute("SELECT 1 FROM _migrations WHERE name=?", (name,)).fetchone()
        if not already:
            try:
                c.execute(sql)
                c.execute(
                    "INSERT INTO _migrations(name, applied_at) VALUES (?, ?)",
                    (name, int(time.time())),
                )
            except Exception:
                pass
    c.commit()
    return c


TABLES = (
    "entities",
    "entity_aliases",
    "entity_vendor_symbols",
    "entity_figi",
    "entity_relations",
    "entity_events",
    "_migrations",
)
