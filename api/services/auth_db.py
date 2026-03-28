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

CREATE TABLE IF NOT EXISTS mrr_snapshots (
    id              TEXT PRIMARY KEY,
    date            TEXT UNIQUE NOT NULL,
    total_users     INTEGER,
    pro_subscribers INTEGER,
    comped_count    INTEGER,
    mrr             INTEGER,
    churn_count     INTEGER,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_notes (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id),
    note        TEXT NOT NULL,
    admin_email TEXT NOT NULL,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_admin_notes_user ON admin_notes(user_id);

CREATE TABLE IF NOT EXISTS page_views (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    page        TEXT NOT NULL,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_page_views_user ON page_views(user_id);
CREATE INDEX IF NOT EXISTS idx_page_views_page ON page_views(page);
CREATE INDEX IF NOT EXISTS idx_page_views_created ON page_views(created_at);

CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    email TEXT,
    page TEXT,
    message TEXT NOT NULL,
    rating INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at);

CREATE TABLE IF NOT EXISTS user_tags (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    tag TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_user_tags_user ON user_tags(user_id);
CREATE INDEX IF NOT EXISTS idx_user_tags_tag ON user_tags(tag);

CREATE TABLE IF NOT EXISTS referrals (
    id                TEXT PRIMARY KEY,
    referrer_user_id  TEXT NOT NULL REFERENCES users(id),
    referred_user_id  TEXT REFERENCES users(id),
    referral_code     TEXT UNIQUE NOT NULL,
    status            TEXT DEFAULT 'pending',
    created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_referrals_code ON referrals(referral_code);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_user_id);

CREATE TABLE IF NOT EXISTS support_tickets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    subject TEXT NOT NULL,
    category TEXT DEFAULT 'general',
    status TEXT DEFAULT 'open',
    priority TEXT DEFAULT 'normal',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ticket_messages (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    sender_id TEXT NOT NULL,
    sender_role TEXT DEFAULT 'user',
    message TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tickets_user ON support_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket ON ticket_messages(ticket_id);

CREATE TABLE IF NOT EXISTS user_preferences (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    pref_key    TEXT NOT NULL,
    pref_value  TEXT,
    UNIQUE(user_id, pref_key)
);
CREATE INDEX IF NOT EXISTS idx_user_preferences_user ON user_preferences(user_id);
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

        # Migration: add referral_code column if missing
        if "referral_code" not in cols:
            conn.execute("ALTER TABLE users ADD COLUMN referral_code TEXT")
            conn.commit()
            print("[auth] Migrated: added referral_code column to users")

        # Migration: add full_name column if missing
        if "full_name" not in cols:
            conn.execute("ALTER TABLE users ADD COLUMN full_name TEXT")
            conn.commit()
            print("[auth] Migrated: added full_name column to users")

        # Journal v2 migration
        _migrate_journal_v2(conn)

        print(f"[auth] Database ready at {_DB_PATH}")
    finally:
        conn.close()


def _migrate_journal_v2(conn):
    """Add Trade Journal v2 columns and tables."""
    new_cols = [
        ("journal_entries", "account", "TEXT DEFAULT 'default'"),
        ("journal_entries", "asset_class", "TEXT DEFAULT 'equity'"),
        ("journal_entries", "strategy", "TEXT DEFAULT ''"),
        ("journal_entries", "playbook_id", "TEXT"),
        ("journal_entries", "tags", "TEXT DEFAULT ''"),
        ("journal_entries", "mistake_tags", "TEXT DEFAULT ''"),
        ("journal_entries", "emotion_tags", "TEXT DEFAULT ''"),
        ("journal_entries", "entry_time", "TEXT"),
        ("journal_entries", "exit_time", "TEXT"),
        ("journal_entries", "fees", "REAL DEFAULT 0"),
        ("journal_entries", "shares", "REAL"),
        ("journal_entries", "risk_dollars", "REAL"),
        ("journal_entries", "planned_r", "REAL"),
        ("journal_entries", "realized_r", "REAL"),
        ("journal_entries", "thesis", "TEXT DEFAULT ''"),
        ("journal_entries", "market_context", "TEXT DEFAULT ''"),
        ("journal_entries", "confidence", "INTEGER"),
        ("journal_entries", "process_score", "INTEGER"),
        ("journal_entries", "outcome_score", "INTEGER"),
        ("journal_entries", "ps_setup", "INTEGER"),
        ("journal_entries", "ps_entry", "INTEGER"),
        ("journal_entries", "ps_exit", "INTEGER"),
        ("journal_entries", "ps_sizing", "INTEGER"),
        ("journal_entries", "ps_stop", "INTEGER"),
        ("journal_entries", "lesson", "TEXT DEFAULT ''"),
        ("journal_entries", "follow_up", "TEXT DEFAULT ''"),
        ("journal_entries", "review_status", "TEXT DEFAULT 'draft'"),
        ("journal_entries", "review_date", "TEXT"),
        ("journal_entries", "session", "TEXT DEFAULT ''"),
        ("journal_entries", "day_of_week", "TEXT"),
        ("journal_entries", "holding_minutes", "INTEGER"),
    ]
    for table, col, typedef in new_cols:
        try:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {typedef}")
        except Exception:
            pass  # column already exists

    # Trade executions (scale-in/out)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS trade_executions (
            id          TEXT PRIMARY KEY,
            user_id     TEXT NOT NULL REFERENCES users(id),
            trade_id    TEXT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
            exec_type   TEXT NOT NULL,
            exec_date   TEXT NOT NULL,
            exec_time   TEXT,
            price       REAL NOT NULL,
            shares      REAL NOT NULL,
            fees        REAL DEFAULT 0,
            notes       TEXT DEFAULT '',
            sort_order  INTEGER DEFAULT 0,
            created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_executions_trade ON trade_executions(trade_id)")

    # Screenshots
    conn.execute("""
        CREATE TABLE IF NOT EXISTS journal_screenshots (
            id          TEXT PRIMARY KEY,
            user_id     TEXT NOT NULL REFERENCES users(id),
            trade_id    TEXT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
            slot        TEXT NOT NULL,
            filename    TEXT NOT NULL,
            label       TEXT DEFAULT '',
            sort_order  INTEGER DEFAULT 0,
            created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_screenshots_trade ON journal_screenshots(trade_id)")

    # Daily journals
    conn.execute("""
        CREATE TABLE IF NOT EXISTS daily_journals (
            id              TEXT PRIMARY KEY,
            user_id         TEXT NOT NULL REFERENCES users(id),
            date            TEXT NOT NULL,
            premarket_thesis TEXT DEFAULT '',
            focus_list      TEXT DEFAULT '',
            a_plus_setups   TEXT DEFAULT '',
            risk_plan       TEXT DEFAULT '',
            market_regime   TEXT DEFAULT '',
            emotional_state TEXT DEFAULT '',
            midday_notes    TEXT DEFAULT '',
            eod_recap       TEXT DEFAULT '',
            did_well        TEXT DEFAULT '',
            did_poorly      TEXT DEFAULT '',
            learned         TEXT DEFAULT '',
            tomorrow_focus  TEXT DEFAULT '',
            energy_rating   INTEGER,
            discipline_score INTEGER,
            review_complete INTEGER DEFAULT 0,
            created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, date)
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_daily_journals_user_date ON daily_journals(user_id, date)")

    # Weekly reviews
    conn.execute("""
        CREATE TABLE IF NOT EXISTS weekly_reviews (
            id              TEXT PRIMARY KEY,
            user_id         TEXT NOT NULL REFERENCES users(id),
            week_start      TEXT NOT NULL,
            best_trade_id   TEXT,
            worst_trade_id  TEXT,
            top_setup       TEXT DEFAULT '',
            worst_mistake   TEXT DEFAULT '',
            wins            INTEGER DEFAULT 0,
            losses          INTEGER DEFAULT 0,
            net_pnl_pct     REAL,
            avg_process_score REAL,
            reflection      TEXT DEFAULT '',
            key_lessons     TEXT DEFAULT '',
            next_week_focus TEXT DEFAULT '',
            rules_to_add    TEXT DEFAULT '',
            review_complete INTEGER DEFAULT 0,
            created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, week_start)
        )
    """)

    # Playbooks
    conn.execute("""
        CREATE TABLE IF NOT EXISTS playbooks (
            id              TEXT PRIMARY KEY,
            user_id         TEXT NOT NULL REFERENCES users(id),
            name            TEXT NOT NULL,
            description     TEXT DEFAULT '',
            market_condition TEXT DEFAULT '',
            trigger_criteria TEXT DEFAULT '',
            invalidations   TEXT DEFAULT '',
            entry_model     TEXT DEFAULT '',
            exit_model      TEXT DEFAULT '',
            sizing_rules    TEXT DEFAULT '',
            common_mistakes TEXT DEFAULT '',
            best_practices  TEXT DEFAULT '',
            ideal_time      TEXT DEFAULT '',
            ideal_volatility TEXT DEFAULT '',
            is_active       INTEGER DEFAULT 1,
            trade_count     INTEGER DEFAULT 0,
            win_rate        REAL,
            avg_r           REAL,
            created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_playbooks_user ON playbooks(user_id)")

    # Resources
    conn.execute("""
        CREATE TABLE IF NOT EXISTS journal_resources (
            id          TEXT PRIMARY KEY,
            user_id     TEXT NOT NULL REFERENCES users(id),
            category    TEXT NOT NULL,
            title       TEXT NOT NULL,
            content     TEXT DEFAULT '',
            sort_order  INTEGER DEFAULT 0,
            is_pinned   INTEGER DEFAULT 0,
            created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_resources_user ON journal_resources(user_id)")

    # Import sessions (CSV import tracking)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS import_sessions (
            id              TEXT PRIMARY KEY,
            user_id         TEXT NOT NULL,
            filename        TEXT,
            format          TEXT,
            imported_count  INTEGER,
            duplicate_count INTEGER,
            error_count     INTEGER,
            created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_import_sessions_user ON import_sessions(user_id)")

    # AI summary column on journal_entries
    try:
        conn.execute("ALTER TABLE journal_entries ADD COLUMN ai_summary TEXT")
    except Exception:
        pass  # column already exists

    conn.commit()
