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

CREATE TABLE IF NOT EXISTS email_verifications (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id),
    token       TEXT UNIQUE NOT NULL,
    expires_at  TIMESTAMP NOT NULL,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS password_resets (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id),
    token       TEXT UNIQUE NOT NULL,
    expires_at  TIMESTAMP NOT NULL,
    used        INTEGER DEFAULT 0,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_email_verifications_token ON email_verifications(token);
CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(token);

CREATE TABLE IF NOT EXISTS activity_log (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id),
    action      TEXT NOT NULL,
    details     TEXT DEFAULT '',
    ip_address  TEXT DEFAULT '',
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_action ON activity_log(action);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at);
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

        # Migration: add email_verified column if missing
        cols = [row[1] for row in conn.execute("PRAGMA table_info(users)").fetchall()]
        if "email_verified" not in cols:
            conn.execute("ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0")
            conn.commit()
            print("[auth] Migrated: added email_verified column to users")

        # Migration: add last_login_at column if missing
        if "last_login_at" not in cols:
            conn.execute("ALTER TABLE users ADD COLUMN last_login_at TIMESTAMP")
            conn.commit()
            print("[auth] Migrated: added last_login_at column to users")

        print(f"[auth] Database ready at {_DB_PATH}")
    finally:
        conn.close()
