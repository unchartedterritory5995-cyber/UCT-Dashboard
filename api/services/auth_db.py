"""
Auth database — completely separate from existing databases.
Uses /data/auth.db on Railway (persistent volume) or local ./data/auth.db.
"""

import os
import sqlite3

_DB_PATH = os.environ.get("AUTH_DB_PATH", "/data/auth.db")

# Fallback for local dev (Railway volume won't exist)
if not os.path.exists(os.path.dirname(_DB_PATH)):
    _DB_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "data", "auth.db")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id              TEXT PRIMARY KEY,
    email           TEXT UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,
    display_name    TEXT,
    role            TEXT DEFAULT 'member',
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS subscriptions (
    id                      TEXT PRIMARY KEY,
    user_id                 TEXT NOT NULL REFERENCES users(id),
    stripe_customer_id      TEXT UNIQUE,
    stripe_subscription_id  TEXT UNIQUE,
    plan                    TEXT DEFAULT 'free',
    status                  TEXT DEFAULT 'active',
    current_period_end      TIMESTAMP,
    created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
    token       TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id),
    expires_at  TIMESTAMP NOT NULL,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS journal_entries (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id),
    sym             TEXT NOT NULL,
    direction       TEXT DEFAULT 'long',
    setup           TEXT DEFAULT '',
    entry_price     REAL,
    exit_price      REAL,
    stop_price      REAL,
    target_price    REAL,
    size_pct        REAL,
    status          TEXT DEFAULT 'open',
    entry_date      TEXT,
    exit_date       TEXT,
    pnl_pct         REAL,
    pnl_dollar      REAL,
    notes           TEXT DEFAULT '',
    rating          INTEGER,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS watchlists (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id),
    name            TEXT NOT NULL,
    description     TEXT DEFAULT '',
    is_public       INTEGER DEFAULT 0,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS watchlist_items (
    id              TEXT PRIMARY KEY,
    watchlist_id    TEXT NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
    sym             TEXT NOT NULL,
    notes           TEXT DEFAULT '',
    added_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_cust ON subscriptions(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_journal_user ON journal_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_journal_status ON journal_entries(status);
CREATE INDEX IF NOT EXISTS idx_watchlists_user ON watchlists(user_id);
CREATE INDEX IF NOT EXISTS idx_watchlists_public ON watchlists(is_public);
CREATE INDEX IF NOT EXISTS idx_watchlist_items_list ON watchlist_items(watchlist_id);
"""


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(_DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    conn = get_connection()
    try:
        conn.executescript(_SCHEMA)
        conn.commit()
        print(f"[auth] Database ready at {_DB_PATH}")
    finally:
        conn.close()
