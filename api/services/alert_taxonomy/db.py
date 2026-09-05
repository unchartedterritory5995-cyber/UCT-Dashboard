"""alert_taxonomy.db — the shared schema for S7's alert taxonomy.

One new database, `<DATA_DIR>/alert_taxonomy.db`, WAL mode -- the same
per-domain-database convention entity_master.db/bars.db/cot.db/catalysts.db
already follow (SPEC-S7 §9: "matching the pattern every other alert-adjacent
store already uses... none of which live in auth.db" -- product-architecture
.md's own reasoning: auth.db is ~110 tables on one write lock with no
migration framework, TD-13, and is not where a new alert store belongs).
The `_migrations` table + one-(name, sql)-tuple-applied-once pattern is
copied directly from `api/services/entity_master/schema.py` (itself copied
from `bars_sqlite.py`), read in full before this module was written.

SCOPE (authorized first slice only): three of SPEC-S7 §9's four named
tables. `alert_routing_prefs` (per-user, per-trigger-type channel-override
preferences, SPEC §5.5) is DEFERRED -- nothing in this slice reads or
writes a routing preference; `deliver_alert_payload`'s existing, unmodified
multi-channel behavior is used as-is (see delivery.py). Building an empty,
unused table for a feature no code in this slice exercises is exactly the
"speculative column/table" the authorization forbids. Add it when routing
customization is actually implemented, not before.

FRESHNESS COLUMN -- CORRECTED, DELIBERATE DEVIATION FROM THE LITERAL SPEC-S7
DDL: SPEC-S7 §5.3's own `alert_fires` DDL comments `freshness_class` as
"real-time | delayed-15 | end-of-day | historical (data-architecture.md
§12.1's 4-class model)" -- the readiness review confirmed this is stale.
D1's REAL, live `FreshnessClass` (api/services/provider_errors.py) is
Literal["real_time","delayed_15","end_of_day","historical","stale"] -- five
values. This module's `freshness_class` column carries D1's SOURCE-side
freshness verbatim (the same SOURCE_STALE concept freshnessContract.js
guards) -- it is NOT the same concept as S8/S11's session-derived
SESSION_STALE, which is never persisted (it is recomputed at *render* time
from `as_of`, exactly like ProvenanceDemo.jsx/EstimatesTab.jsx already do
via sessionStale.js) -- see KNOWN_D1_FRESHNESS_VALUES below and the
document_arrival module's own honest-NULL freshness note.

EXTRA COLUMN BEYOND THE LITERAL alert_fires DDL -- RECORDED DISCREPANCY:
SPEC-S7's `alert_fires.triggering_value` is `REAL` -- correct for a
price-level or indicator-condition fire, but document-arrival's "value" is
a filing (form type, accession number, url, filed date), not a number. Per
the owner's "if actual code contradicts a material assumption, evidence
wins -- record the discrepancy rather than silently forcing the
implementation" instruction: rather than mangling a non-numeric fact into
`triggering_value REAL` or silently dropping it, one additive column is
added -- `detail TEXT` (nullable JSON) -- for type-specific structured
context beyond the generic columns. Every other column in the DDL below is
otherwise SPEC-S7 §5.3's exact, literal design.
"""
from __future__ import annotations

import os
import sqlite3
import time

DB_PATH = os.path.join(os.environ.get("DATA_DIR", "/data"), "alert_taxonomy.db")

# D1's real, current FreshnessClass enum (api/services/provider_errors.py) --
# the ONE place this module asserts what a valid freshness_class value is.
# NULL/None (D1's own "not established" state) is always valid and is NOT
# in this tuple -- see document_arrival.py for why a document-arrival fire's
# freshness_class is honestly None, not a guessed tier.
KNOWN_D1_FRESHNESS_VALUES = (
    "real_time", "delayed_15", "end_of_day", "historical", "stale",
)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS alert_trigger_registry (
    type_id         TEXT PRIMARY KEY,          -- e.g. 'document-arrival'
    params_schema   TEXT NOT NULL,              -- JSON: {field: type-description}
    module          TEXT NOT NULL,              -- the module that owns evaluation, for debugging
    registered_at   REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS alert_predicates (
    id              TEXT PRIMARY KEY,           -- predicate_id
    type_id         TEXT NOT NULL REFERENCES alert_trigger_registry(type_id),
    user_id         TEXT NOT NULL,
    entity_scope    TEXT NOT NULL,              -- JSON {kind, id, asOf} -- SPEC-S7 §5.2's shape,
                                                  -- typed identically whether "id" holds a raw
                                                  -- ticker or a resolved S3 entity_id (no reshape
                                                  -- needed when a predicate migrates between them)
    params          TEXT NOT NULL,              -- JSON, validated against the type's params_schema
                                                  -- at registration time (SPEC §5.2)
    channels        TEXT,                       -- JSON list, NULL = inherit the type's default
                                                  -- (routing-preference lookup deferred, see module
                                                  -- docstring -- NULL is the only value used today)
    created_at      REAL NOT NULL,
    updated_at      REAL NOT NULL,
    suspended_at    REAL,                        -- non-NULL = suspended, never deleted (PRD §8)
    last_seen_state TEXT                         -- JSON, type-specific watermark (e.g.
                                                  -- document-arrival's last-seen accession number);
                                                  -- NULL until the first evaluation cycle
);
CREATE INDEX IF NOT EXISTS idx_alert_predicates_type ON alert_predicates(type_id, suspended_at);
CREATE INDEX IF NOT EXISTS idx_alert_predicates_user ON alert_predicates(user_id);
-- Stage 3 duplicate-predicate guard: at most one ACTIVE predicate per
-- (user, trigger type, canonical entity). Partial (suspended_at IS NULL) so a
-- suspended row never blocks a fresh registration -- predicates.register_predicate
-- reactivates a suspended equivalent instead of relying on this index for that
-- case. Scoped to document-arrival's params today (form_type/keyword are not
-- part of the key -- no member UI exposes them yet); widen the key only when a
-- trigger type's params genuinely need to coexist as distinct active predicates.
CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_predicates_active_dedup
    ON alert_predicates(user_id, type_id, json_extract(entity_scope, '$.id'))
    WHERE suspended_at IS NULL;

CREATE TABLE IF NOT EXISTS alert_fires (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    predicate_id        TEXT NOT NULL,
    trigger_type        TEXT NOT NULL,
    user_id             TEXT,                    -- NULL = broadcast-shaped fire (unused this slice
                                                  -- -- document-arrival fires are always private)
    entity_ref          TEXT,                     -- the resolved scope (symbol string, or a
                                                  -- resolved S3 entity_id where available)
    fire_key            TEXT NOT NULL,            -- re-arm key, per type (SPEC §5.3.1)
    triggering_value    REAL,                     -- numeric-condition types only; NULL otherwise
    detail              TEXT,                     -- JSON, type-specific structured context --
                                                  -- see module docstring's "recorded discrepancy"
    source_data_class   TEXT,                     -- e.g. "sec_filing", "quote", "indicator"
    freshness_class     TEXT,                     -- D1's real 5-value enum, or NULL (honest
                                                  -- "not established" -- see module docstring)
    as_of               REAL NOT NULL,            -- the VALUE's timestamp
    fired_at            REAL NOT NULL,            -- the EVALUATION's timestamp (distinct)
    delivered_at        REAL,
    delivery_attempts   INTEGER NOT NULL DEFAULT 0,
    delivery_failed_at  REAL,
    delivery_channels   TEXT,                     -- JSON: {"in_app":"ok","email":"failed",...} --
                                                  -- same vocabulary as watchlist_alert_service's
                                                  -- CHANNEL_OK/FAILED/SKIPPED
    channels_failed     INTEGER NOT NULL DEFAULT 0,
    UNIQUE(predicate_id, fire_key)
);
CREATE INDEX IF NOT EXISTS idx_alert_fires_user ON alert_fires(user_id, fired_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_fires_predicate ON alert_fires(predicate_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_alert_fires_type_cycle ON alert_fires(trigger_type, fired_at DESC);

CREATE TABLE IF NOT EXISTS _migrations (
    name        TEXT PRIMARY KEY,
    applied_at  INTEGER
);
"""

_MIGRATIONS: list[tuple[str, str]] = [
    # S7 durable in-app notification bridge (owner authorization): a fire is
    # ALWAYS single-owner (never broadcast -- document_arrival's own router
    # docstring), so one nullable column is the read-state design, not a
    # separate per-user table -- there is only ever one relevant reader. This
    # table already accepts post-fire mutation for delivery bookkeeping
    # (delivered_at/delivery_attempts/delivery_channels), so read_at extends
    # an existing pattern rather than breaking a true immutability guarantee.
    ("add_alert_fires_read_at", "ALTER TABLE alert_fires ADD COLUMN read_at REAL"),
]


def connect(db_path: str | None = None) -> sqlite3.Connection:
    """Open a WAL-mode connection. Does not create tables -- call init_db()."""
    path = db_path or DB_PATH
    os.makedirs(os.path.dirname(path), exist_ok=True)
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.row_factory = sqlite3.Row
    return conn


def init_db(conn: sqlite3.Connection | None = None, db_path: str | None = None) -> sqlite3.Connection:
    """Create every table/index if absent, then apply any un-applied migration
    exactly once. Idempotent and safe to call on every process boot. Never
    touches any existing store -- this function only ever opens/creates
    `alert_taxonomy.db`."""
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


TABLES = ("alert_trigger_registry", "alert_predicates", "alert_fires")
