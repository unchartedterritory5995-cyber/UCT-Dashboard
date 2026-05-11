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

-- Phase 2: Accounts (multi-portfolio model). Each user has 1+ accounts.
-- Each j2_position and j2_trade gets stamped with an account_id post-migration.
CREATE TABLE IF NOT EXISTS j2_accounts (
    id                  TEXT PRIMARY KEY,
    user_id             TEXT NOT NULL,
    name                TEXT NOT NULL,
    color               TEXT NOT NULL,
    broker              TEXT,
    starting_balance    REAL NOT NULL,
    -- Per-account settings (moved from j2_settings during migration)
    account_size        REAL NOT NULL,
    default_stop        TEXT NOT NULL DEFAULT '{"mode":"custom"}',
    position_closing    TEXT NOT NULL DEFAULT 'FIFO',
    breakeven_range     TEXT NOT NULL DEFAULT '{"enabled":false,"unit":"$","value":0}',
    setups              TEXT NOT NULL DEFAULT '[]',
    share_journal_data  INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    UNIQUE(user_id, name)
);
CREATE INDEX IF NOT EXISTS idx_j2_accounts_user
    ON j2_accounts(user_id);

-- Phase 5: Options multi-leg support. Separate strategies + legs tables
-- (Pattern C per research). A strategy is a coherent options trade idea
-- (1-4 legs, one underlying). Legs are immutable after creation — close
-- flow updates exit_price only. Rolled strategies chain via
-- parent_strategy_id (v2 feature; FK present now for cheap v2 later).
CREATE TABLE IF NOT EXISTS j2_option_strategies (
    id                  TEXT PRIMARY KEY,
    user_id             TEXT NOT NULL,
    account_id          TEXT,
    underlying          TEXT NOT NULL,
    strategy_type       TEXT NOT NULL,
    direction           TEXT NOT NULL CHECK(direction IN ('bullish','bearish','neutral')),
    net_entry           REAL NOT NULL,
    fees                REAL NOT NULL DEFAULT 0,
    entry_date          TEXT NOT NULL,
    setup               TEXT,
    notes               TEXT,
    context_at_entry    TEXT NOT NULL DEFAULT '{}',
    status              TEXT NOT NULL DEFAULT 'open'
                        CHECK(status IN ('open','closed','expired','assigned','rolled')),
    closed_at           TEXT,
    net_exit            REAL,
    exit_fees           REAL NOT NULL DEFAULT 0,
    pnl_dollar          REAL,
    pnl_percent         REAL,
    r_multiple          REAL,
    result              TEXT,
    linked_playbook_id  TEXT,
    parent_strategy_id  TEXT,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_j2_opt_user_status
    ON j2_option_strategies(user_id, status);
CREATE INDEX IF NOT EXISTS idx_j2_opt_user_account
    ON j2_option_strategies(user_id, account_id);
CREATE INDEX IF NOT EXISTS idx_j2_opt_underlying
    ON j2_option_strategies(user_id, underlying);
CREATE INDEX IF NOT EXISTS idx_j2_opt_playbook
    ON j2_option_strategies(user_id, linked_playbook_id);

CREATE TABLE IF NOT EXISTS j2_option_legs (
    id            TEXT PRIMARY KEY,
    strategy_id   TEXT NOT NULL REFERENCES j2_option_strategies(id) ON DELETE CASCADE,
    leg_index     INTEGER NOT NULL,
    side          TEXT NOT NULL CHECK(side IN ('buy','sell')),
    contract_type TEXT NOT NULL CHECK(contract_type IN ('call','put')),
    strike        REAL NOT NULL,
    expiration    TEXT NOT NULL,
    qty           INTEGER NOT NULL,
    entry_price   REAL NOT NULL,
    exit_price    REAL,
    UNIQUE(strategy_id, leg_index)
);
CREATE INDEX IF NOT EXISTS idx_j2_opt_legs_strategy
    ON j2_option_legs(strategy_id);

-- Phase 5: Playbook / stock observation library. User-saved interesting
-- stock snapshots w/ screenshots, thesis, levels, status. An entry may
-- link to a real Trade (linked_position_id / linked_trade_id) once
-- it's executed so we can track idea → outcome conversion.
CREATE TABLE IF NOT EXISTS j2_playbook_entries (
    id                 TEXT PRIMARY KEY,
    user_id            TEXT NOT NULL,
    symbol             TEXT NOT NULL,
    observed_date      TEXT NOT NULL,
    setup              TEXT,
    thesis             TEXT,
    levels             TEXT NOT NULL DEFAULT '{}',
    status             TEXT NOT NULL DEFAULT 'watching'
                       CHECK(status IN ('watching','triggered','traded','passed','dead')),
    attachments        TEXT NOT NULL DEFAULT '[]',
    notes              TEXT,
    linked_position_id TEXT,
    linked_trade_id    TEXT,
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_j2_playbook_user
    ON j2_playbook_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_j2_playbook_user_symbol
    ON j2_playbook_entries(user_id, symbol);
CREATE INDEX IF NOT EXISTS idx_j2_playbook_user_status
    ON j2_playbook_entries(user_id, status);
"""


_PHASE_2_ALTERS = [
    # Add nullable account_id to positions + trades.
    # Stamped with the user's Default account during lazy migration.
    "ALTER TABLE j2_positions ADD COLUMN account_id TEXT",
    "ALTER TABLE j2_trades ADD COLUMN account_id TEXT",
    "CREATE INDEX IF NOT EXISTS idx_j2_positions_account ON j2_positions(account_id)",
    "CREATE INDEX IF NOT EXISTS idx_j2_trades_account ON j2_trades(account_id)",
    # Phase 4: per-account Goal Progress targets (JSON blob on accounts row).
    # Shape: {"daily":95.24,"weekly":461.89,"monthly":2000,"yearly":24000}.
    "ALTER TABLE j2_accounts ADD COLUMN goals TEXT NOT NULL DEFAULT '{}'",
    # Phase 5: Fees/commissions on trades. Defaults to 0 for legacy rows
    # so existing trades' reported P&L stays the same (gross = net when
    # no fees recorded). New trades can specify real fees.
    "ALTER TABLE j2_trades ADD COLUMN fees REAL NOT NULL DEFAULT 0",
    # Phase 5: three new optional TEXT columns on j2_day_notes for the
    # Daily Notes/Review/Prep flow — pre-market plan, mid-day review,
    # post-market recap. Existing 'notes' column remains as "general
    # reflection" catch-all for backward compat.
    "ALTER TABLE j2_day_notes ADD COLUMN prep_notes TEXT",
    "ALTER TABLE j2_day_notes ADD COLUMN mid_day_notes TEXT",
    "ALTER TABLE j2_day_notes ADD COLUMN recap_notes TEXT",
    # Phase 5: user-level default fee per contract, used to pre-fill
    # options fees at write time (auto: legs_qty × rate × 2 round-trip).
    # Per-account so power users can have different rates for different
    # brokers without retyping.
    "ALTER TABLE j2_accounts ADD COLUMN default_fee_per_contract REAL NOT NULL DEFAULT 0",
    # Per-account trade-type filter: 'shares' | 'options' | 'both'.
    # Hides the inactive surface's tabs/forms in J2.0 (data still queryable).
    "ALTER TABLE j2_accounts ADD COLUMN trading_mode TEXT NOT NULL DEFAULT 'both'",
    # Phase A — Entry Guards (nullable scalars; null = disabled)
    "ALTER TABLE j2_accounts ADD COLUMN default_size_pct REAL",
    "ALTER TABLE j2_accounts ADD COLUMN default_r_multiple_target REAL",
    "ALTER TABLE j2_accounts ADD COLUMN max_risk_per_trade_pct REAL",
    # Phase B — Session Discipline (nullable scalars + JSON list; null/empty = disabled)
    "ALTER TABLE j2_accounts ADD COLUMN daily_loss_limit_pct REAL",
    "ALTER TABLE j2_accounts ADD COLUMN cooling_off_minutes_after_loss INTEGER",
    "ALTER TABLE j2_accounts ADD COLUMN no_trade_windows_et TEXT NOT NULL DEFAULT '[]'",
    # Phase C — Setup-Aware Coaching (A+ whitelist + multiplier; null/empty = disabled)
    "ALTER TABLE j2_accounts ADD COLUMN a_plus_setups TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE j2_accounts ADD COLUMN a_plus_risk_multiplier REAL",
    # Phase D — Regime-Aware Sizing
    "ALTER TABLE j2_accounts ADD COLUMN regime_size_multipliers TEXT NOT NULL DEFAULT '{}'",
    "ALTER TABLE j2_trades ADD COLUMN regime TEXT",
    # Phase E — Mistakes + Emotions taxonomy
    "ALTER TABLE j2_accounts ADD COLUMN mistake_tags TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE j2_accounts ADD COLUMN emotion_tags TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE j2_trades ADD COLUMN mistake_tags TEXT",
    "ALTER TABLE j2_trades ADD COLUMN emotion_tags TEXT",
]


def ensure_schema(conn: sqlite3.Connection) -> None:
    """Create Journal 2.0 tables if missing. Safe to call repeatedly.
    Never modifies the existing Journal tables."""
    conn.executescript(_J2_SCHEMA)

    # Phase 2 ALTER additions: idempotent via try/except since SQLite
    # doesn't have IF NOT EXISTS for ADD COLUMN.
    for stmt in _PHASE_2_ALTERS:
        try:
            conn.execute(stmt)
        except sqlite3.OperationalError as e:
            # Already exists (duplicate column / index) — ignore.
            msg = str(e).lower()
            if "duplicate column" not in msg and "already exists" not in msg:
                raise
    conn.commit()
