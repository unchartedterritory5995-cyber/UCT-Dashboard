"""
Journal 2.0 — SQLite schema + migrations.

All tables use the `j2_` prefix. Invoked additively from
api.services.auth_db.init_db() so the existing Journal's tables are
never touched.

Spec §4 (data model), audit §5 (schema commitment).
"""

import sqlite3


_J2_SCHEMA = """
CREATE TABLE IF NOT EXISTS j2_settings (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL UNIQUE,
    data         TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS j2_positions (
    id                  TEXT PRIMARY KEY,
    user_id             TEXT NOT NULL,
    symbol              TEXT NOT NULL,
    side                TEXT NOT NULL CHECK(side IN ('Long','Short')),
    entry_date          TEXT NOT NULL,
    shares              REAL NOT NULL,
    original_shares     REAL NOT NULL,
    entry_price         REAL NOT NULL,
    stop_price          REAL NOT NULL,
    breakeven_stop      REAL,
    raise_to_breakeven  INTEGER NOT NULL DEFAULT 0,
    setup               TEXT,
    notes               TEXT,
    context_at_entry    TEXT NOT NULL,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    closed_at           TEXT
);

CREATE INDEX IF NOT EXISTS idx_j2_positions_user
    ON j2_positions(user_id);
CREATE INDEX IF NOT EXISTS idx_j2_positions_user_open
    ON j2_positions(user_id, closed_at);
CREATE INDEX IF NOT EXISTS idx_j2_positions_user_symbol
    ON j2_positions(user_id, symbol);

CREATE TABLE IF NOT EXISTS j2_trades (
    id                  TEXT PRIMARY KEY,
    user_id             TEXT NOT NULL,
    position_id         TEXT NOT NULL,
    symbol              TEXT NOT NULL,
    side                TEXT NOT NULL CHECK(side IN ('Long','Short')),
    shares              REAL NOT NULL,
    entry_price         REAL NOT NULL,
    entry_date          TEXT NOT NULL,
    exit_price          REAL NOT NULL,
    exit_date           TEXT NOT NULL,
    original_stop       REAL NOT NULL,
    setup               TEXT,
    notes               TEXT,
    pnl_dollar          REAL NOT NULL,
    pnl_percent         REAL NOT NULL,
    r_multiple          REAL,
    hold_days           INTEGER NOT NULL,
    result              TEXT NOT NULL CHECK(result IN ('Win','Loss','BE')),
    context_at_entry    TEXT NOT NULL,
    created_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_j2_trades_user
    ON j2_trades(user_id);
CREATE INDEX IF NOT EXISTS idx_j2_trades_user_entry
    ON j2_trades(user_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_j2_trades_user_exit
    ON j2_trades(user_id, exit_date);
CREATE INDEX IF NOT EXISTS idx_j2_trades_user_result
    ON j2_trades(user_id, result);
CREATE INDEX IF NOT EXISTS idx_j2_trades_position
    ON j2_trades(position_id);

CREATE TABLE IF NOT EXISTS j2_day_notes (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    date        TEXT NOT NULL,
    notes       TEXT,
    attachments TEXT NOT NULL DEFAULT '[]',
    rules       TEXT NOT NULL DEFAULT '[]',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    UNIQUE(user_id, date)
);
CREATE INDEX IF NOT EXISTS idx_j2_day_notes_user_date
    ON j2_day_notes(user_id, date);
"""


def ensure_schema(conn: sqlite3.Connection) -> None:
    """Create Journal 2.0 tables if missing. Safe to call repeatedly.
    Never modifies the existing Journal tables."""
    conn.executescript(_J2_SCHEMA)
    conn.commit()
