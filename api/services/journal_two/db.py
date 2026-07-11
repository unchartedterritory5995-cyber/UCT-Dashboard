"""
Journal 2.0 — SQLite schema + migrations.

All tables use the `j2_` prefix. Invoked additively from
api.services.auth_db.init_db() so the existing Journal's tables are
never touched.

Spec §4 (data model), audit §5 (schema commitment).
"""

import json
import os
import sqlite3
import uuid
from pathlib import Path


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

-- Phase G: Compass outputs — log of every AI Coach generation (weekly
-- reviews, future EOD recaps, future pre-trade verdicts, future chat
-- turns, profile updates). Used for memory retrieval, feedback loop,
-- and audit.
CREATE TABLE IF NOT EXISTS j2_coach_outputs (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    account_id  TEXT NOT NULL,
    output_type TEXT NOT NULL
                CHECK(output_type IN ('weekly_review','eod_recap','pre_trade_verdict','chat_turn','profile_update')),
    body        TEXT NOT NULL,
    summary     TEXT,
    metadata    TEXT NOT NULL DEFAULT '{}',
    feedback    TEXT,
    forgotten   INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_j2_coach_outputs_lookup
    ON j2_coach_outputs(user_id, account_id, output_type, created_at DESC);

-- Phase G v3: Compass Chat — persistent message log for the AI Coach
-- conversation surface. Supports multi-turn chat, tool call/result
-- round-trips, compaction summaries, and per-message forgetting.
CREATE TABLE IF NOT EXISTS j2_chat_messages (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL,
    account_id      TEXT NOT NULL,
    role            TEXT NOT NULL CHECK(role IN ('user','assistant','tool','summary')),
    content         TEXT,
    tool_calls      TEXT,
    tool_results    TEXT,
    parent_id       TEXT,
    metadata        TEXT,
    created_at      TEXT NOT NULL,
    forgotten       INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_j2_chat_account
    ON j2_chat_messages(user_id, account_id, created_at);

CREATE INDEX IF NOT EXISTS idx_j2_chat_parent
    ON j2_chat_messages(parent_id);

CREATE TABLE IF NOT EXISTS j2_onboarding_responses (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    account_id  TEXT NOT NULL,
    session_id  TEXT NOT NULL,
    category    TEXT NOT NULL,
    question    TEXT NOT NULL,
    answer      TEXT NOT NULL,
    asked_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_j2_onboarding_session
    ON j2_onboarding_responses(account_id, session_id, asked_at);

CREATE TABLE IF NOT EXISTS j2_verdicts (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL,
    account_id      TEXT NOT NULL,
    symbol          TEXT NOT NULL,
    side            TEXT NOT NULL,
    shares          REAL,
    entry_price     REAL,
    stop_price      REAL,
    target_price    REAL,
    setup           TEXT,
    risk_pct        REAL,
    label           TEXT NOT NULL CHECK(label IN ('GO','HOLD','SKIP','ERROR')),
    paragraph       TEXT NOT NULL,
    factors         TEXT NOT NULL DEFAULT '[]',
    source          TEXT NOT NULL CHECK(source IN ('hard_check','llm')),
    hard_check_failed TEXT,
    created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_j2_verdicts_account
    ON j2_verdicts(user_id, account_id, created_at);

CREATE TABLE IF NOT EXISTS j2_trade_reviews (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    account_id  TEXT NOT NULL,
    trade_id    TEXT NOT NULL,
    body        TEXT NOT NULL,
    summary     TEXT,
    metadata    TEXT NOT NULL DEFAULT '{}',
    feedback    TEXT,
    forgotten   INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    UNIQUE(user_id, trade_id) ON CONFLICT REPLACE
);

CREATE INDEX IF NOT EXISTS idx_j2_trade_reviews_trade
    ON j2_trade_reviews(trade_id);
CREATE INDEX IF NOT EXISTS idx_j2_trade_reviews_account
    ON j2_trade_reviews(user_id, account_id, created_at);

CREATE TABLE IF NOT EXISTS j2_interventions (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    account_id   TEXT NOT NULL,
    rule         TEXT NOT NULL,
    severity     TEXT NOT NULL CHECK(severity IN ('info','warning','danger')),
    message      TEXT NOT NULL,
    factors      TEXT NOT NULL DEFAULT '[]',
    fired_at     TEXT NOT NULL,
    cooldown_until TEXT NOT NULL,
    dismissed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_j2_interventions_active
    ON j2_interventions(user_id, account_id, rule, cooldown_until);

CREATE TABLE IF NOT EXISTS j2_profile_suggestions (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    account_id    TEXT NOT NULL,
    source_type   TEXT NOT NULL CHECK(source_type IN ('weekly_review','eod_recap','trade_review','chat')),
    source_id     TEXT NOT NULL,
    suggestion    TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','resolved','dismissed')),
    created_at    TEXT NOT NULL,
    resolved_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_j2_profile_suggestions_pending
    ON j2_profile_suggestions(user_id, account_id, status, created_at);

-- Unified Coach State: holds user-level coach identity + profile for
-- "All Accounts" mode. Each user has at most one row. Separate from
-- per-account fields in j2_accounts to allow account-agnostic coaching.
CREATE TABLE IF NOT EXISTS j2_unified_coach_state (
    user_id               TEXT PRIMARY KEY,
    trader_profile        TEXT NOT NULL DEFAULT '',
    compass_enabled       INTEGER NOT NULL DEFAULT 1,
    onboarded             INTEGER NOT NULL DEFAULT 0,
    onboarding_mode       INTEGER NOT NULL DEFAULT 0,
    onboarding_session_id TEXT,
    created_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL
);

-- Notebook (replaces Playbook 2026-05-26). Long-form Substack-style
-- notes with TipTap doc body, folders, tags, optional ticker, hero
-- image. Migration of j2_playbook_entries -> j2_notes runs once at
-- startup, gated by .notebook_migration_v1 flag file.
CREATE TABLE IF NOT EXISTS j2_notes (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL,
    account_id      TEXT,
    folder_id       TEXT,
    title           TEXT NOT NULL DEFAULT '',
    subtitle        TEXT,
    body_json       TEXT NOT NULL DEFAULT '{"type":"doc","content":[]}',
    body_plain      TEXT NOT NULL DEFAULT '',
    hero_image_url  TEXT,
    ticker          TEXT,
    tags            TEXT NOT NULL DEFAULT '[]',
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_j2_notes_user_updated
    ON j2_notes(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_j2_notes_user_folder
    ON j2_notes(user_id, folder_id);
CREATE INDEX IF NOT EXISTS idx_j2_notes_user_ticker
    ON j2_notes(user_id, ticker);

CREATE TABLE IF NOT EXISTS j2_note_folders (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    name        TEXT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    UNIQUE(user_id, name)
);
CREATE INDEX IF NOT EXISTS idx_j2_note_folders_user
    ON j2_note_folders(user_id, sort_order);

-- ── Broker Sync (SnapTrade) ─────────────────────────────────────────────────
-- One SnapTrade registration per UCT user (their "broker identity"). The
-- userSecret is encrypted via api.services.crypto_box with a versioned prefix.
CREATE TABLE IF NOT EXISTS j2_broker_users (
    user_id            TEXT PRIMARY KEY,
    snaptrade_user_id  TEXT NOT NULL,
    user_secret_enc    TEXT NOT NULL,
    consent_at         TEXT,
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL
);

-- Each connected brokerage account, mapped 1:1 to a j2_account row.
CREATE TABLE IF NOT EXISTS j2_broker_accounts (
    id                    TEXT PRIMARY KEY,
    user_id               TEXT NOT NULL,
    snaptrade_account_id  TEXT NOT NULL,
    brokerage_name        TEXT,
    account_number_masked TEXT,
    account_type          TEXT,
    currency              TEXT,
    j2_account_id         TEXT NOT NULL,
    sync_enabled          INTEGER NOT NULL DEFAULT 1,
    status                TEXT NOT NULL DEFAULT 'active'
                          CHECK(status IN ('active','broken','disabled')),
    activities_cursor     TEXT,
    last_sync_at          TEXT,
    last_sync_status      TEXT,
    last_error            TEXT,
    created_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL,
    UNIQUE(user_id, snaptrade_account_id)
);
CREATE INDEX IF NOT EXISTS idx_j2_broker_accounts_user
    ON j2_broker_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_j2_broker_accounts_j2acct
    ON j2_broker_accounts(j2_account_id);

-- Daily net-liquidation snapshots (cash + equity MV + option MV) per broker
-- account → the real account equity curve. One row per (account, day); the
-- latest sync of the day wins (upsert). Source-of-truth for the growth chart.
CREATE TABLE IF NOT EXISTS j2_broker_equity_snapshots (
    user_id            TEXT NOT NULL,
    broker_account_id  TEXT NOT NULL,
    snapshot_date      TEXT NOT NULL,          -- YYYY-MM-DD (ET)
    total_equity       REAL,
    cash               REAL,
    market_value       REAL,
    synced_at          TEXT NOT NULL,
    PRIMARY KEY (user_id, broker_account_id, snapshot_date)
);
CREATE INDEX IF NOT EXISTS idx_j2_broker_equity_snap_acct
    ON j2_broker_equity_snapshots(user_id, broker_account_id, snapshot_date);

-- Raw activity ledger: idempotency + reprocessing source-of-record.
-- Every SnapTrade activity lands here once; reconstruct.py reads from it.
CREATE TABLE IF NOT EXISTS j2_broker_activities (
    id                 TEXT PRIMARY KEY,
    user_id            TEXT NOT NULL,
    broker_account_id  TEXT NOT NULL,
    external_id        TEXT NOT NULL,
    activity_type      TEXT NOT NULL,
    symbol             TEXT,
    occurred_at        TEXT,
    raw_json           TEXT NOT NULL,
    processed          INTEGER NOT NULL DEFAULT 0,
    created_at         TEXT NOT NULL,
    UNIQUE(user_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_j2_broker_activities_acct
    ON j2_broker_activities(user_id, broker_account_id, occurred_at);

-- Sync audit log (no secrets).
CREATE TABLE IF NOT EXISTS j2_broker_sync_log (
    id                 TEXT PRIMARY KEY,
    user_id            TEXT NOT NULL,
    broker_account_id  TEXT,
    started_at         TEXT NOT NULL,
    finished_at        TEXT,
    trades_imported    INTEGER NOT NULL DEFAULT 0,
    positions_upserted INTEGER NOT NULL DEFAULT 0,
    options_imported   INTEGER NOT NULL DEFAULT 0,
    dup_candidates     INTEGER NOT NULL DEFAULT 0,
    status             TEXT,
    error              TEXT
);
CREATE INDEX IF NOT EXISTS idx_j2_broker_sync_log_user
    ON j2_broker_sync_log(user_id, started_at DESC);

-- Duplicate-candidate flags (manual row vs broker row likely-same trade).
CREATE TABLE IF NOT EXISTS j2_broker_dup_flags (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL,
    manual_trade_id TEXT NOT NULL,
    broker_trade_id TEXT NOT NULL,
    confidence      REAL NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK(status IN ('pending','merged','dismissed')),
    created_at      TEXT NOT NULL,
    UNIQUE(user_id, manual_trade_id, broker_trade_id)
);
CREATE INDEX IF NOT EXISTS idx_j2_broker_dup_pending
    ON j2_broker_dup_flags(user_id, status);

-- Cash-flow ledger: deposits/withdrawals/dividends/interest/fees imported from
-- the broker. External flows (deposit/withdrawal/transfer) drive deposit-
-- adjusted performance; internal flows (dividend/interest/fee) are income/cost
-- already reflected in equity. Idempotent via stable external_id.
CREATE TABLE IF NOT EXISTS j2_broker_cash_flows (
    id                TEXT PRIMARY KEY,
    user_id           TEXT NOT NULL,
    account_id        TEXT NOT NULL,          -- j2 account
    broker_account_id TEXT NOT NULL,
    external_id       TEXT NOT NULL,
    flow_date         TEXT NOT NULL,          -- YYYY-MM-DD
    flow_type         TEXT NOT NULL,          -- deposit|withdrawal|dividend|interest|fee|transfer|other
    amount            REAL NOT NULL,          -- signed USD: + into account, - out
    is_external       INTEGER NOT NULL DEFAULT 0,
    currency          TEXT,
    source            TEXT NOT NULL DEFAULT 'broker',
    created_at        TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_j2_cash_flows_ext
    ON j2_broker_cash_flows(user_id, external_id);
CREATE INDEX IF NOT EXISTS idx_j2_cash_flows_acct
    ON j2_broker_cash_flows(user_id, account_id, flow_date);
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
    # Phase F — Streak nudges + stale-hold thresholds (nullable; null = use defaults)
    "ALTER TABLE j2_accounts ADD COLUMN loss_streak_threshold INTEGER",
    "ALTER TABLE j2_accounts ADD COLUMN win_streak_threshold INTEGER",
    "ALTER TABLE j2_accounts ADD COLUMN stale_hold_days_threshold INTEGER",
    # Phase G — Compass (Coach Core + Weekly Review)
    "ALTER TABLE j2_accounts ADD COLUMN trader_profile TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE j2_accounts ADD COLUMN compass_enabled INTEGER NOT NULL DEFAULT 1",
    # Compass Chat (Phase G v3) — per-account muted setups + paper-only days.
    # Consumed by mute_setup / schedule_paper_only_day tools, and by the
    # future Pre-Trade Verdict surface.
    "ALTER TABLE j2_accounts ADD COLUMN muted_setups TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE j2_accounts ADD COLUMN paper_only_days TEXT NOT NULL DEFAULT '[]'",
    # Compass Onboarding (Phase G v4) — interview state + session id
    "ALTER TABLE j2_accounts ADD COLUMN onboarded INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE j2_accounts ADD COLUMN onboarding_mode INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE j2_accounts ADD COLUMN onboarding_session_id TEXT",
    # Multi-Account Compass — unified onboarding state on the user-level row
    # (table created fresh with these columns; ALTERs cover DBs that already
    # created j2_unified_coach_state before unified onboarding shipped).
    "ALTER TABLE j2_unified_coach_state ADD COLUMN onboarding_mode INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE j2_unified_coach_state ADD COLUMN onboarding_session_id TEXT",
    # ── Broker Sync (SnapTrade) ─────────────────────────────────────────────
    # Origin tagging + idempotency. NULL source = legacy/manual (back-compat;
    # existing rows render unchanged). external_id keys upserts and lets us
    # re-run reconstruction without dupes. entry_estimated on positions = 1
    # means the entry price came from the broker's average cost basis (seed
    # for a position carried in before activity history starts), not a real
    # fill — surfaced visibly to the user so it isn't trusted blindly.
    "ALTER TABLE j2_trades ADD COLUMN source TEXT",
    "ALTER TABLE j2_trades ADD COLUMN external_id TEXT",
    "ALTER TABLE j2_positions ADD COLUMN source TEXT",
    "ALTER TABLE j2_positions ADD COLUMN external_id TEXT",
    "ALTER TABLE j2_positions ADD COLUMN entry_estimated INTEGER NOT NULL DEFAULT 0",
    # Broker's current per-share mark, refreshed each sync via holdings-as-truth,
    # so open equity rows can show a real price + P&L when the live tick feed is
    # empty (after hours). Manual positions leave this NULL → fall back to live.
    "ALTER TABLE j2_positions ADD COLUMN broker_price REAL",
    "ALTER TABLE j2_option_strategies ADD COLUMN source TEXT",
    "ALTER TABLE j2_option_strategies ADD COLUMN external_id TEXT",
    # Current option market value (broker mark x qty x 100), refreshed each sync
    # via holdings-as-truth, so open option strategies can show Current + P&L
    # like equity positions (no tick-live option quote feed).
    "ALTER TABLE j2_option_strategies ADD COLUMN broker_current_value REAL",
    "ALTER TABLE j2_option_strategies ADD COLUMN broker_mark_synced_at TEXT",
    # Partial unique indexes — SQLite supports WHERE clauses on CREATE INDEX
    # so NULL external_ids (the entire legacy population) don't collide.
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_j2_trades_extid ON j2_trades(user_id, external_id) WHERE external_id IS NOT NULL",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_j2_positions_extid ON j2_positions(user_id, external_id) WHERE external_id IS NOT NULL",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_j2_optstrat_extid ON j2_option_strategies(user_id, external_id) WHERE external_id IS NOT NULL",
    # Real broker balances on the account row. Nulls until first sync; the
    # balance resolver chooses between these and the legacy closed-equity
    # math via balance_source. Manual accounts keep balance_source='manual'
    # → no behavior change for users who never connect a broker.
    "ALTER TABLE j2_accounts ADD COLUMN balance_source TEXT NOT NULL DEFAULT 'manual'",
    "ALTER TABLE j2_accounts ADD COLUMN broker_total_equity REAL",
    "ALTER TABLE j2_accounts ADD COLUMN broker_cash REAL",
    "ALTER TABLE j2_accounts ADD COLUMN broker_buying_power REAL",
    "ALTER TABLE j2_accounts ADD COLUMN broker_market_value REAL",
    "ALTER TABLE j2_accounts ADD COLUMN broker_balance_synced_at TEXT",
    # Broker import "warming" — after connect, the scheduler runs short full
    # re-syncs until SnapTrade's async backfill stabilizes. Nullable; null = not
    # warming. See docs/superpowers/specs/2026-06-22-broker-seamless-onboarding-design.md
    "ALTER TABLE j2_broker_accounts ADD COLUMN warming_until TEXT",
    "ALTER TABLE j2_broker_accounts ADD COLUMN warming_last_activity_count INTEGER",
    "ALTER TABLE j2_broker_accounts ADD COLUMN warming_stable_ticks INTEGER NOT NULL DEFAULT 0",
    # Journal A+ P1a — ET trading-day spine (2026-07-09 spec §3)
    "ALTER TABLE j2_trades ADD COLUMN trading_day_et TEXT",
    "ALTER TABLE j2_trades ADD COLUMN hour_et INTEGER",
    "ALTER TABLE j2_option_strategies ADD COLUMN trading_day_et TEXT",
    "CREATE INDEX IF NOT EXISTS idx_j2_trades_tday ON j2_trades(user_id, trading_day_et)",
    "CREATE INDEX IF NOT EXISTS idx_j2_opts_tday ON j2_option_strategies(user_id, trading_day_et)",
    # Journal A+ P1b — trade screenshots, keyed on the stable trade_ref
    # (ext:<external_id> for broker rows / id:<row id> for manual) so annotations
    # survive the broker purge+reinsert cycle. Files live under _ATTACHMENT_ROOT
    # so the P1a nightly R2 backup already covers them.
    "CREATE TABLE IF NOT EXISTS j2_trade_attachments ("
    "id TEXT PRIMARY KEY, user_id TEXT NOT NULL, trade_ref TEXT NOT NULL, "
    "filename TEXT NOT NULL, label TEXT, created_at TEXT NOT NULL)",
    "CREATE INDEX IF NOT EXISTS idx_j2_trade_att_ref "
    "ON j2_trade_attachments(user_id, trade_ref)",
    # Journal A+ P2 — per-closed-trade excursion metrics (MFE/MAE/exit
    # efficiency), keyed on the same stable trade_ref (ext:<external_id> broker /
    # id:<row id> manual) as attachments so they survive the broker purge+reinsert
    # cycle. Composite PK (user_id, trade_ref) makes INSERT OR REPLACE idempotent.
    # data_quality ∈ 'intraday_1m'|'intraday_5m'|'daily'|'underlying'|'insufficient'.
    "CREATE TABLE IF NOT EXISTS j2_trade_excursions ("
    "user_id TEXT NOT NULL, trade_ref TEXT NOT NULL, symbol TEXT, "
    "mfe_price REAL, mae_price REAL, mfe_r REAL, mae_r REAL, "
    "mfe_ts INTEGER, mae_ts INTEGER, exit_efficiency REAL, missed_r REAL, "
    "bar_resolution TEXT, data_quality TEXT, computed_at TEXT NOT NULL, "
    "PRIMARY KEY (user_id, trade_ref))",
    "CREATE INDEX IF NOT EXISTS idx_j2_excursions_user ON j2_trade_excursions(user_id)",
    # Journal A+ P5-A2 — per-setup rule LABELS (the checklist template each
    # trade of that setup is graded against later). JSON blob parallel to
    # `setups`: {setupName: [{id, label}]}. Defaults to {} for legacy rows.
    "ALTER TABLE j2_accounts ADD COLUMN setup_rules TEXT NOT NULL DEFAULT '{}'",
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

    try:
        run_notebook_migration_v1(conn)
    except Exception as e:  # noqa: BLE001 — never crash startup over this
        print(f"[notebook-migration] aborted: {e}")


def _data_dir() -> Path:
    return Path(os.environ.get("DATA_DIR", "/data"))


def run_notebook_migration_v1(conn: sqlite3.Connection) -> None:
    """One-shot migration: convert every j2_playbook_entries row into
    a j2_notes row. Idempotent via .notebook_migration_v1 flag file.
    Safe to call on every startup.

    The old j2_playbook_entries table is left in place as a backup —
    manual DROP TABLE after ~30 days of green prod."""
    flag = _data_dir() / ".notebook_migration_v1"
    try:
        if flag.exists():
            return
    except Exception:
        # If /data isn't writable, fall through — we still need to try
        # in dev. The flag isn't strictly required for correctness
        # because the inner loop is row-by-row idempotent.
        pass

    # Check the old table actually exists (fresh installs won't have it).
    table_row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' "
        "AND name='j2_playbook_entries'"
    ).fetchone()
    if table_row is None:
        # Nothing to migrate — still touch the flag so we don't keep
        # poking sqlite_master.
        try:
            flag.parent.mkdir(parents=True, exist_ok=True)
            flag.touch()
        except Exception:
            pass
        return

    # Lazy import to avoid cycles (notes imports from this module's caller chain).
    from api.services.journal_two.notes import (
        convert_playbook_to_tiptap, extract_plain_text,
    )

    migrated = 0
    skipped = 0
    errored = 0

    # Use a fresh row factory if not set (defensive).
    prev_row_factory = conn.row_factory
    if prev_row_factory is None:
        conn.row_factory = sqlite3.Row

    try:
        rows = conn.execute(
            "SELECT * FROM j2_playbook_entries ORDER BY created_at ASC"
        ).fetchall()
    finally:
        conn.row_factory = prev_row_factory

    for row in rows:
        try:
            # Normalize row access — works for both sqlite3.Row and tuple.
            def _v(key, default=None):
                try:
                    return row[key]
                except (KeyError, IndexError, TypeError):
                    return default

            user_id = _v("user_id")
            symbol = _v("symbol") or ""
            observed = _v("observed_date") or ""
            setup = _v("setup")
            thesis = _v("thesis") or ""
            status = _v("status")
            levels_raw = _v("levels") or "{}"
            attachments_raw = _v("attachments") or "[]"
            notes_raw = _v("notes") or ""
            created_at = _v("created_at")
            updated_at = _v("updated_at")
            row_id = _v("id")

            entry = {
                "id": row_id,
                "userId": user_id,
                "symbol": symbol,
                "observedDate": observed,
                "setup": setup,
                "thesis": thesis,
                "levels": json.loads(levels_raw) if levels_raw else {},
                "status": status,
                "attachments": json.loads(attachments_raw) if attachments_raw else [],
                "notes": notes_raw,
            }

            title = (
                f"{symbol} {setup} — {observed}".strip() if setup
                else (f"{symbol} — {observed}" if symbol and observed else (symbol or "Note"))
            )

            # Idempotency check: if a note with the same user_id/title/created_at
            # already exists, skip (this handles partial retry of a crashed run).
            exists = conn.execute(
                "SELECT 1 FROM j2_notes WHERE user_id = ? AND title = ? AND created_at = ?",
                (user_id, title, created_at),
            ).fetchone()
            if exists:
                skipped += 1
                continue

            doc = convert_playbook_to_tiptap(entry)
            body_plain = extract_plain_text(doc)

            hero = None
            for att in entry["attachments"]:
                if isinstance(att, dict) and att.get("kind") == "image" and att.get("url"):
                    hero = att["url"]
                    break

            tags = [status] if status else []

            new_id = uuid.uuid4().hex
            conn.execute(
                """
                INSERT INTO j2_notes (
                    id, user_id, account_id, folder_id, title, subtitle,
                    body_json, body_plain, hero_image_url, ticker, tags,
                    created_at, updated_at
                ) VALUES (?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    new_id, user_id, title, setup,
                    json.dumps(doc), body_plain, hero, symbol or None,
                    json.dumps(tags), created_at, updated_at,
                ),
            )
            migrated += 1
        except Exception as e:  # noqa: BLE001 — defensive, never crash startup
            errored += 1
            print(f"[notebook-migration] row failed: {e}")

    conn.commit()
    print(f"[notebook-migration] migrated={migrated} skipped={skipped} errored={errored}")

    if errored == 0:
        try:
            flag.parent.mkdir(parents=True, exist_ok=True)
            flag.touch()
        except Exception:
            pass
