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
    is_flagged_list INTEGER DEFAULT 0,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS watchlist_items (
    id              TEXT PRIMARY KEY,
    watchlist_id    TEXT NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
    sym             TEXT NOT NULL,
    notes           TEXT DEFAULT '',
    sort_order      INTEGER DEFAULT 0,
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

CREATE TABLE IF NOT EXISTS admin_todos (
    id             TEXT PRIMARY KEY,
    task           TEXT NOT NULL,
    done           INTEGER NOT NULL DEFAULT 0,
    created_by     TEXT NOT NULL,           -- admin email who added it
    completed_by   TEXT,                    -- admin email who crossed it off
    completed_at   TIMESTAMP,
    sort_order     INTEGER NOT NULL DEFAULT 0,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_admin_todos_done ON admin_todos(done, sort_order);

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

CREATE TABLE IF NOT EXISTS voice_settings (
    user_id                       TEXT PRIMARY KEY REFERENCES users(id),
    enabled                       INTEGER NOT NULL DEFAULT 1,
    voice                         TEXT NOT NULL DEFAULT 'verse',
    speed                         REAL NOT NULL DEFAULT 1.0,
    retention_days                INTEGER NOT NULL DEFAULT 30,
    created_at                    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at                    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS voice_usage_monthly (
    user_id              TEXT NOT NULL REFERENCES users(id),
    year_month           TEXT NOT NULL,
    mode_a_seconds       INTEGER NOT NULL DEFAULT 0,
    mode_b_calls         INTEGER NOT NULL DEFAULT 0,
    mode_c_seconds       INTEGER NOT NULL DEFAULT 0,
    mode_d_seconds       INTEGER NOT NULL DEFAULT 0,
    estimated_cost_usd   REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, year_month)
);

CREATE TABLE IF NOT EXISTS voice_sessions (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id            TEXT NOT NULL REFERENCES users(id),
    mode               TEXT NOT NULL,
    source             TEXT,
    started_at         TIMESTAMP NOT NULL,
    ended_at           TIMESTAMP,
    duration_seconds   INTEGER,
    status             TEXT NOT NULL,
    page_context       TEXT,
    estimated_cost_usd REAL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_voice_sessions_user ON voice_sessions(user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS voice_transcripts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id   INTEGER NOT NULL REFERENCES voice_sessions(id) ON DELETE CASCADE,
    role         TEXT NOT NULL,
    text         TEXT NOT NULL,
    timestamp    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_voice_transcripts_session ON voice_transcripts(session_id, timestamp);

CREATE TABLE IF NOT EXISTS user_voice_facts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT NOT NULL REFERENCES users(id),
    category    TEXT NOT NULL DEFAULT 'general',
    text        TEXT NOT NULL,
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_voice_facts_user ON user_voice_facts(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS voice_session_summaries (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id      INTEGER NOT NULL REFERENCES voice_sessions(id) ON DELETE CASCADE,
    user_id         TEXT NOT NULL REFERENCES users(id),
    summary_text    TEXT NOT NULL,
    key_topics_json TEXT,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_voice_summaries_user ON voice_session_summaries(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS voice_feedback (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         TEXT NOT NULL REFERENCES users(id),
    session_id      INTEGER REFERENCES voice_sessions(id) ON DELETE SET NULL,
    rating          TEXT NOT NULL CHECK (rating IN ('up', 'down')),
    turn_text       TEXT,
    correction_text TEXT,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_voice_feedback_user ON voice_feedback(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_voice_feedback_correction ON voice_feedback(user_id, correction_text)
    WHERE correction_text IS NOT NULL;

CREATE TABLE IF NOT EXISTS voice_tool_calls (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      TEXT NOT NULL REFERENCES users(id),
    session_id   INTEGER REFERENCES voice_sessions(id) ON DELETE SET NULL,
    tool_name    TEXT NOT NULL,
    args_json    TEXT,
    result_json  TEXT,
    ok           INTEGER NOT NULL,
    error        TEXT,
    latency_ms   INTEGER,
    created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_voice_tool_calls_user ON voice_tool_calls(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_voice_tool_calls_failures ON voice_tool_calls(user_id, ok, created_at DESC)
    WHERE ok = 0;

CREATE TABLE IF NOT EXISTS voice_embeddings (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      TEXT NOT NULL REFERENCES users(id),
    kind         TEXT NOT NULL,
    source_id    INTEGER,
    text         TEXT NOT NULL,
    embedding    BLOB NOT NULL,
    model        TEXT NOT NULL,
    created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_voice_embeddings_user_kind ON voice_embeddings(user_id, kind);
CREATE INDEX IF NOT EXISTS idx_voice_embeddings_source ON voice_embeddings(kind, source_id);

CREATE TABLE IF NOT EXISTS voice_scratchpad (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id   INTEGER REFERENCES voice_sessions(id) ON DELETE CASCADE,
    user_id      TEXT NOT NULL REFERENCES users(id),
    key          TEXT NOT NULL,
    value        TEXT NOT NULL,
    created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(session_id, key)
);

CREATE INDEX IF NOT EXISTS idx_voice_scratchpad_session ON voice_scratchpad(session_id);

CREATE TABLE IF NOT EXISTS voice_proactive_insights (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       TEXT NOT NULL REFERENCES users(id),
    kind          TEXT NOT NULL,
    symbol        TEXT,
    headline      TEXT NOT NULL,
    body          TEXT,
    importance    INTEGER NOT NULL DEFAULT 5,
    delivered_at  TIMESTAMP,
    dismissed_at  TIMESTAMP,
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_voice_proactive_user_undelivered ON voice_proactive_insights(user_id, delivered_at);
CREATE INDEX IF NOT EXISTS idx_voice_proactive_user_recent ON voice_proactive_insights(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS voice_documents (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT NOT NULL REFERENCES users(id),
    title       TEXT NOT NULL,
    source_type TEXT NOT NULL,
    char_count  INTEGER NOT NULL DEFAULT 0,
    chunk_count INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_voice_documents_user ON voice_documents(user_id, created_at DESC);

-- Per-session prompt variant tracking. We pick a system_prompt variant
-- at mint time and write it here so feedback aggregations can attribute
-- thumbs back to the right variant.
CREATE TABLE IF NOT EXISTS voice_prompt_variants (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  INTEGER NOT NULL REFERENCES voice_sessions(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL REFERENCES users(id),
    variant_id  TEXT NOT NULL,
    agent_ctx   TEXT,
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(session_id)
);

CREATE INDEX IF NOT EXISTS idx_voice_prompt_variants_user ON voice_prompt_variants(user_id, variant_id, created_at DESC);

-- Landing page conversion analytics. Anonymous; visitor_id is a
-- localStorage-stable UUID that lets us session-scope without auth.
CREATE TABLE IF NOT EXISTS landing_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    visitor_id  TEXT NOT NULL,
    event       TEXT NOT NULL,
    props       TEXT,                -- JSON blob
    referrer    TEXT,
    path        TEXT,
    user_agent  TEXT,
    ip_prefix   TEXT,                -- /24 prefix only (privacy)
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_landing_events_visitor ON landing_events(visitor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_landing_events_event   ON landing_events(event, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_landing_events_day     ON landing_events(date(created_at));

-- Was-this-helpful votes on Support FAQ items. One vote per (user, article).
CREATE TABLE IF NOT EXISTS faq_votes (
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    faq_id      TEXT NOT NULL,
    helpful     INTEGER NOT NULL,     -- 1 = up, 0 = down
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, faq_id)
);
CREATE INDEX IF NOT EXISTS idx_faq_votes_article ON faq_votes(faq_id);
"""


def get_connection() -> sqlite3.Connection:
    # timeout=3 (was 10): auth.db is on the UNIVERSAL request path — every
    # validate_session read opens a connection on an anyio worker. Under write
    # contention a 10s in-driver wait × concurrent requests compounds into the
    # threadpool-starvation class behind the 2026-07-01 524 outage (bars.db
    # runs 2s on web for the same reason). WAL keeps reads lock-free; 3s is
    # generous headroom for the (throttled) session writes.
    conn = sqlite3.connect(_DB_PATH, timeout=3)
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

        # Migration: add is_flagged_list column to watchlists if missing
        wl_cols = [row[1] for row in conn.execute("PRAGMA table_info(watchlists)").fetchall()]
        if "is_flagged_list" not in wl_cols:
            conn.execute("ALTER TABLE watchlists ADD COLUMN is_flagged_list INTEGER DEFAULT 0")
            conn.commit()
            print("[auth] Migrated: added is_flagged_list column to watchlists")

        # Ticker tags table (color tags per user per ticker)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS ticker_tags (
                id          TEXT PRIMARY KEY,
                user_id     TEXT NOT NULL REFERENCES users(id),
                sym         TEXT NOT NULL,
                color       TEXT NOT NULL,
                created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, sym)
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_ticker_tags_user ON ticker_tags(user_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_ticker_tags_sym ON ticker_tags(sym)")
        conn.commit()

        # Watchlist alerts table (per-symbol price alerts)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS watchlist_alerts (
                id              TEXT PRIMARY KEY,
                user_id         TEXT NOT NULL REFERENCES users(id),
                sym             TEXT NOT NULL,
                target_price    REAL NOT NULL,
                direction       TEXT NOT NULL,
                is_active       INTEGER DEFAULT 1,
                triggered_at    TIMESTAMP,
                created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_wl_alerts_user ON watchlist_alerts(user_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_wl_alerts_active ON watchlist_alerts(is_active)")
        conn.commit()

        # Migration: add sort_order column to watchlist_items if missing
        wi_cols = [row[1] for row in conn.execute("PRAGMA table_info(watchlist_items)").fetchall()]
        if "sort_order" not in wi_cols:
            conn.execute("ALTER TABLE watchlist_items ADD COLUMN sort_order INTEGER DEFAULT 0")
            conn.commit()
            print("[auth] Migrated: added sort_order column to watchlist_items")

        # Trading accounts table
        conn.execute("""
            CREATE TABLE IF NOT EXISTS trading_accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                name TEXT NOT NULL,
                broker TEXT,
                account_number TEXT,
                balance REAL NOT NULL DEFAULT 50000,
                initial_balance REAL NOT NULL DEFAULT 50000,
                max_risk_pct REAL DEFAULT 1.0,
                max_position_pct REAL DEFAULT 10.0,
                is_default INTEGER DEFAULT 0,
                is_active INTEGER DEFAULT 1,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_trading_accounts_user ON trading_accounts(user_id)")
        conn.commit()

        # Journal v2 migration
        _migrate_journal_v2(conn)

        # ─── Pattern Recognition (Phase 0) ────────────────────────────────
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS pattern_detections (
              id            TEXT PRIMARY KEY,
              sym           TEXT NOT NULL,
              tf            TEXT NOT NULL,
              pattern_id    TEXT NOT NULL,
              category      TEXT NOT NULL,
              direction     TEXT NOT NULL,
              start_t       INTEGER NOT NULL,
              end_t         INTEGER NOT NULL,
              confidence    REAL NOT NULL,
              quality_json  TEXT NOT NULL,
              geometry_json TEXT NOT NULL,
              levels_json   TEXT NOT NULL,
              context_json  TEXT NOT NULL,
              narrative_json TEXT NOT NULL,
              status        TEXT NOT NULL,
              detected_at   INTEGER NOT NULL,
              last_seen_at  INTEGER NOT NULL,
              hash_key      TEXT NOT NULL UNIQUE
            );

            CREATE INDEX IF NOT EXISTS idx_pd_sym_tf   ON pattern_detections(sym, tf);
            CREATE INDEX IF NOT EXISTS idx_pd_pattern  ON pattern_detections(pattern_id);
            CREATE INDEX IF NOT EXISTS idx_pd_status   ON pattern_detections(status);

            CREATE TABLE IF NOT EXISTS pattern_outcomes (
              detection_id  TEXT PRIMARY KEY REFERENCES pattern_detections(id),
              entry_hit     INTEGER NOT NULL DEFAULT 0,
              entry_hit_t   INTEGER,
              stop_hit      INTEGER NOT NULL DEFAULT 0,
              stop_hit_t    INTEGER,
              target_hit    INTEGER NOT NULL DEFAULT 0,
              target_hit_t  INTEGER,
              mfe_pct       REAL,
              mae_pct       REAL,
              bars_to_resolve INTEGER,
              resolved_at   INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS pattern_stats (
              pattern_id    TEXT NOT NULL,
              tf            TEXT NOT NULL,
              regime_bucket TEXT NOT NULL,
              n_total       INTEGER NOT NULL DEFAULT 0,
              n_resolved    INTEGER NOT NULL DEFAULT 0,
              n_entry_hit   INTEGER NOT NULL DEFAULT 0,
              n_target_hit  INTEGER NOT NULL DEFAULT 0,
              n_stop_hit    INTEGER NOT NULL DEFAULT 0,
              avg_mfe_pct   REAL,
              avg_mae_pct   REAL,
              median_bars   INTEGER,
              hit_rate      REAL,
              expectancy_R  REAL,
              last_updated  INTEGER NOT NULL,
              PRIMARY KEY (pattern_id, tf, regime_bucket)
            );

            CREATE TABLE IF NOT EXISTS pattern_feedback (
              id            INTEGER PRIMARY KEY AUTOINCREMENT,
              detection_id  TEXT NOT NULL REFERENCES pattern_detections(id),
              user_id       TEXT NOT NULL,
              rating        TEXT NOT NULL,
              note          TEXT,
              created_at    INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_pf_detection ON pattern_feedback(detection_id);
        """)
        conn.commit()
        print("[patterns] Schema initialized (4 tables)")

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
        ("voice_usage_monthly", "mode_d_seconds", "INTEGER NOT NULL DEFAULT 0"),
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

    # Journal 2.0 tables (j2_* — additive, isolated from the existing Journal).
    # See api/services/journal_two/db.py and docs/journal-2.0-integration-audit.md.
    from api.services.journal_two.db import ensure_schema as _ensure_j2_schema
    _ensure_j2_schema(conn)

    conn.commit()
