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

-- Journal A+ P6-5: "Make this a rule" — a persisted, evidence-linked personal
-- rule store. A rule is a PERSISTENT reminder (no per-day `checked` column),
-- surfaced for DISPLAY only. It MUST NOT auto-arm any intervention or mutate a
-- discipline guardrail — there are deliberately NO auto-arm columns here. Shape
-- mirrors j2_profile_suggestions' provenance precedent (source_type/source_id).
CREATE TABLE IF NOT EXISTS j2_journal_rules (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    account_id    TEXT,
    label         TEXT NOT NULL,
    evidence      TEXT,
    source_type   TEXT,
    source_id     TEXT,
    status        TEXT NOT NULL DEFAULT 'active',
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_j2_journal_rules_user_account_status
    ON j2_journal_rules(user_id, account_id, status);

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
    -- Notebook card thumbnail cache (see the matching ALTER below): the ALTER
    -- alone covered existing DBs but a FRESH schema (every test fixture, any
    -- new install) never gained the column and the notes INSERT names it —
    -- 7 import-suite reds (inherited; a new column goes in BOTH places).
    first_image_url TEXT,
    ticker          TEXT,
    tags            TEXT NOT NULL DEFAULT '[]',
    import_source   TEXT,
    import_key      TEXT,
    import_hash     TEXT,
    imported_at     TEXT,
    -- audit B5: 1 while this note's body still carries an unresolved
    -- import-time placeholder (import-ref://<media> or import-link://
    -- <note>) that the client's post-confirm media-upload + link-rewrite
    -- phase has not yet resolved. import_confirm sets it on every
    -- create/update; update_note clears (or re-sets) it when the client
    -- reports how that phase went. See import_confirm's docstring — a note
    -- stuck at 1 is NOT let the confirm fingerprint mark it "skipped", so a
    -- failed media upload gets retried on the member's next import attempt
    -- instead of being silently and permanently missing forever.
    import_media_pending INTEGER,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_j2_notes_user_updated
    ON j2_notes(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_j2_notes_user_folder
    ON j2_notes(user_id, folder_id);
CREATE INDEX IF NOT EXISTS idx_j2_notes_user_ticker
    ON j2_notes(user_id, ticker);
-- Wave 4 Slice 1 (Search Evolution I): backs the new dateFrom/dateTo filter
-- (created_at range) — additive, idempotent, zero data change. Removes an
-- O(n log n) temp-B-tree sort that scales with one member's TOTAL note
-- count (an import-heavy member can arrive with thousands on day one),
-- not with the filtered result size. Validated via
-- tools/wave4_date_range_index_benchmark.py: negligible write overhead
-- (indistinguishable from measurement noise), ~1.2MB at 50k platform-wide
-- notes. Rollback: DROP INDEX IF EXISTS idx_j2_notes_user_created.
CREATE INDEX IF NOT EXISTS idx_j2_notes_user_created
    ON j2_notes(user_id, created_at);

-- ── Notebook search index ───────────────────────────────────────────────────
-- Standalone (NOT external-content) FTS5 mirror of the searchable columns.
-- Standalone deliberately: an external-content table keys on rowid, and
-- j2_notes has a TEXT PRIMARY KEY, so its rowid is not stable across a
-- VACUUM -- which would silently desync the index. Storing note_id as an
-- UNINDEXED column costs duplicated text and buys an index that cannot drift.
-- Mirrors the house pattern in transcript_index.py / education_search.py.
--
-- ⛔ body_plain in j2_notes stays authoritative. This table is DERIVED and
-- fully rebuildable from it (run_notebook_migration_v4). Never write here
-- except through the triggers below.
CREATE VIRTUAL TABLE IF NOT EXISTS j2_notes_fts USING fts5(
    note_id UNINDEXED,
    user_id UNINDEXED,
    title,
    body_plain,
    tokenize = 'porter unicode61'
);

-- O(1) note_id -> j2_notes_fts rowid lookup (perf fix, 2026-09). An ordinary
-- table, not virtual, so unlike j2_notes_fts's UNINDEXED note_id column it
-- CAN carry a real PRIMARY KEY index. Without this, `DELETE FROM
-- j2_notes_fts WHERE note_id = ?` has no index to use and SQLite falls back
-- to scanning every row's stored content -- measured 7.9x tax at 5,000
-- notes, 32.0x at 20,000, linear and unbounded (a control with the FTS
-- triggers removed: 2.41ms -> 2.04ms flat; as shipped: 19.09ms -> 65.33ms).
-- j2_notes_fts is one GLOBAL table shared by every user's notes, so this tax
-- was paid by EVERY member's Save, scaling with the WHOLE table.
--
-- Deliberately NOT "key j2_notes_fts's rowid to j2_notes.rowid" (the other
-- candidate fix): j2_notes has a TEXT primary key, so ITS rowid is implicit,
-- and SQLite's own docs say VACUUM may renumber implicit rowids -- silently
-- desyncing that scheme with no way to detect it after the fact. fts_rowid
-- here is instead whatever rowid FTS5 itself assigned at insert time
-- (captured via last_insert_rowid() in the same trigger that inserted it,
-- never copied or guessed from j2_notes) -- FTS5's own shadow storage
-- declares real INTEGER PRIMARY KEYs internally, so it is not subject to
-- that renumbering, and this mapping never needs to reference j2_notes'
-- rowid at all. Also deliberately NOT `contentless_delete=1` (needs SQLite
-- 3.43+ -- see run_notebook_migration_v5's docstring for the version check):
-- a contentless FTS5 table returns NULL for every column, UNINDEXED ones
-- included, on a MATCH read (verified empirically) -- note_id, the one
-- thing every search caller actually needs back, would become unreadable.
CREATE TABLE IF NOT EXISTS j2_notes_fts_map (
    note_id    TEXT PRIMARY KEY,
    fts_rowid  INTEGER NOT NULL
);

-- Triggers, not per-writer calls: j2_notes has 11 production write statements
-- across notes.py, note_connectors/engine.py and db.py. Wiring each writer is
-- how an index goes stale on the one path someone forgets -- and the paths
-- that would be forgotten are the importer and the sync engine, i.e. exactly
-- the notes a migrating member most needs to find.
CREATE TRIGGER IF NOT EXISTS j2_notes_fts_ai AFTER INSERT ON j2_notes BEGIN
    INSERT INTO j2_notes_fts(note_id, user_id, title, body_plain)
    VALUES (new.id, new.user_id, new.title, new.body_plain);
    INSERT INTO j2_notes_fts_map(note_id, fts_rowid)
    VALUES (new.id, last_insert_rowid());
END;

CREATE TRIGGER IF NOT EXISTS j2_notes_fts_ad AFTER DELETE ON j2_notes BEGIN
    DELETE FROM j2_notes_fts
    WHERE rowid = (SELECT fts_rowid FROM j2_notes_fts_map WHERE note_id = old.id);
    DELETE FROM j2_notes_fts_map WHERE note_id = old.id;
END;

-- UPDATE OF (not a bare UPDATE): the sync engine's timestamp-neutral
-- tags/import_hash writes must NOT re-index. A nightly full pass touches
-- those columns on every synced note.
CREATE TRIGGER IF NOT EXISTS j2_notes_fts_au
AFTER UPDATE OF title, body_plain ON j2_notes BEGIN
    DELETE FROM j2_notes_fts
    WHERE rowid = (SELECT fts_rowid FROM j2_notes_fts_map WHERE note_id = old.id);
    INSERT INTO j2_notes_fts(note_id, user_id, title, body_plain)
    VALUES (new.id, new.user_id, new.title, new.body_plain);
    INSERT OR REPLACE INTO j2_notes_fts_map(note_id, fts_rowid)
    VALUES (new.id, last_insert_rowid());
END;

-- idx_j2_notes_user_import is deliberately NOT created here. Creating it in
-- the initial executescript would run BEFORE run_notebook_migration_v2 adds
-- the import_key column on a pre-existing (v1-shaped) database, raising
-- "no such column: import_key" on every current user's DB. It is created
-- (as a partial UNIQUE index) in ensure_schema() AFTER both notebook
-- migrations run, and inside run_notebook_migration_v2 itself.

CREATE TABLE IF NOT EXISTS j2_note_folders (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    name        TEXT NOT NULL,
    parent_id   TEXT NOT NULL DEFAULT '',
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    UNIQUE(user_id, parent_id, name)
);
CREATE INDEX IF NOT EXISTS idx_j2_note_folders_user
    ON j2_note_folders(user_id, sort_order);

-- ── Wave B (High-Frequency Notebook UX) — Favorites + Recents ──────────────
-- Both intentionally minimal: no note content duplicated, composite PK makes
-- both idempotent (re-favoriting / re-opening is a no-op write), and both are
-- populated-conditional in the UI (row absent from the sidebar until >=1
-- exists). Trash-awareness lives in the READ query (join j2_notes, exclude
-- deleted_at IS NOT NULL) -- the rows themselves are NOT deleted when a note
-- is trashed, so Restore silently un-hides them again with no extra state to
-- reconcile. Cascade-cleaned on hard delete via trigger (not per-writer call)
-- -- same rationale as the FTS triggers above: j2_notes has multiple hard-
-- delete call sites (purge sweep, account deletion, import dedup) and a
-- trigger cannot be forgotten on a new one.
CREATE TABLE IF NOT EXISTS j2_note_favorites (
    user_id     TEXT NOT NULL,
    note_id     TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    PRIMARY KEY (user_id, note_id)
);
CREATE INDEX IF NOT EXISTS idx_j2_note_favorites_user
    ON j2_note_favorites(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS j2_note_recents (
    user_id     TEXT NOT NULL,
    note_id     TEXT NOT NULL,
    opened_at   TEXT NOT NULL,
    PRIMARY KEY (user_id, note_id)
);
CREATE INDEX IF NOT EXISTS idx_j2_note_recents_user
    ON j2_note_recents(user_id, opened_at DESC);

CREATE TRIGGER IF NOT EXISTS j2_notes_favorites_ad AFTER DELETE ON j2_notes BEGIN
    DELETE FROM j2_note_favorites WHERE note_id = old.id;
END;
CREATE TRIGGER IF NOT EXISTS j2_notes_recents_ad AFTER DELETE ON j2_notes BEGIN
    DELETE FROM j2_note_recents WHERE note_id = old.id;
END;

-- ── Note Connectors ─────────────────────────────────────────────────────────
-- Account-connected background sync of external note libraries (Roam/Craft/
-- Notion/Dropbox) into the Notebook. Spec: docs/superpowers/specs/
-- 2026-08-11-note-connectors-design.md §5. These are brand-new tables — safe
-- as CREATE TABLE IF NOT EXISTS here (no ALTERs; nothing below references
-- column/table state that only a migration creates). run_notebook_migration_v3
-- (.notebook_migration_v3 flag) re-creates them for DBs whose _J2_SCHEMA
-- predates this section; idx_j2_note_sources_user is created in
-- ensure_schema() AFTER that migration call, mirroring how
-- idx_j2_notes_user_import is handled above.
CREATE TABLE IF NOT EXISTS j2_note_connectors (
    user_id       TEXT NOT NULL,
    provider      TEXT NOT NULL,
    token_enc     TEXT NOT NULL,
    account_label TEXT,
    status        TEXT NOT NULL DEFAULT 'active',
    consent_at    TEXT,
    created_at    TEXT,
    updated_at    TEXT,
    PRIMARY KEY(user_id, provider)
);

CREATE TABLE IF NOT EXISTS j2_note_sources (
    id                TEXT PRIMARY KEY,
    user_id           TEXT NOT NULL,
    provider          TEXT NOT NULL,
    remote_id         TEXT NOT NULL,
    display_name      TEXT,
    dest_folder_id    TEXT,
    cursor            TEXT,
    sync_enabled      INTEGER NOT NULL DEFAULT 1,
    status            TEXT NOT NULL DEFAULT 'active',
    last_sync_at      TEXT,
    last_sync_status  TEXT,
    last_sync_error   TEXT,
    warming_until     TEXT,
    created_at        TEXT NOT NULL,
    UNIQUE(user_id, provider, remote_id)
);
-- idx_j2_note_sources_user is deliberately NOT created here — see the
-- comment above and ensure_schema() below.

CREATE TABLE IF NOT EXISTS j2_note_sync_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id       TEXT NOT NULL,
    user_id         TEXT NOT NULL,
    started_at      TEXT,
    finished_at     TEXT,
    status          TEXT,
    error           TEXT,
    notes_created   INTEGER,
    notes_updated   INTEGER,
    notes_skipped   INTEGER,
    media_uploaded  INTEGER,
    conflicts       INTEGER,
    source_deleted  INTEGER
);

CREATE TABLE IF NOT EXISTS j2_note_remote_index (
    user_id           TEXT NOT NULL,
    source_id         TEXT NOT NULL,
    remote_id         TEXT NOT NULL,
    import_key        TEXT NOT NULL,
    remote_updated_at TEXT,
    seen_at           TEXT NOT NULL,
    miss_streak       INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(user_id, source_id, remote_id)
);

-- ── Obsidian ingest (Wave 3a) ───────────────────────────────────────────────
-- A PUSH transport that reuses the PULL engine. The plugin writes staging
-- rows; providers/obsidian.py reads them and satisfies the ordinary
-- NoteProvider contract, so the engine's convert/upsert/conflict/media path
-- and its delete detection are INHERITED, never re-implemented.
CREATE TABLE IF NOT EXISTS j2_obsidian_devices (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    vault_id     TEXT NOT NULL,
    token_enc    TEXT NOT NULL,
    label        TEXT,
    last_seen_at TEXT,
    created_at   TEXT NOT NULL,
    UNIQUE(user_id, vault_id)
);
CREATE INDEX IF NOT EXISTS idx_j2_obsidian_devices_user
    ON j2_obsidian_devices(user_id);

-- One row per vault file currently pushed. `content_hash` lets a re-push of
-- an unchanged file be a no-op without re-converting it.
CREATE TABLE IF NOT EXISTS j2_obsidian_staging (
    user_id      TEXT NOT NULL,
    vault_id     TEXT NOT NULL,
    vault_path   TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    body_md      TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    received_at  TEXT NOT NULL,
    PRIMARY KEY (user_id, vault_id, vault_path)
);

-- The vault's COMPLETE file list at the last full push. This is what feeds
-- the engine's existing optional `list_present_refs` hook, so a file deleted
-- in the vault is detected by the SAME machinery that detects a deleted
-- Notion page. Nothing bespoke.
CREATE TABLE IF NOT EXISTS j2_obsidian_manifest (
    user_id     TEXT NOT NULL,
    vault_id    TEXT NOT NULL,
    vault_path  TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    PRIMARY KEY (user_id, vault_id, vault_path)
);

-- 2026-09-02 adversarial audit, "single-process assumptions" #1:
-- obsidian_link.py's connect-code epoch (closes I6 -- a pre-disconnect
-- code redeeming into a full reconnection) used to live in a bare
-- process-local dict. A restart (this repo redeploys constantly) reset
-- every user's epoch back to 0, silently reopening I6 for the remainder
-- of any outstanding code's 15-minute TTL, and a second worker would
-- disagree with the first about whose epoch is current. One row per user
-- who has ever disconnected Obsidian; a missing row means epoch 0 (never
-- disconnected), read live on every mint/verify -- see obsidian_link.py's
-- `_current_epoch` / `invalidate_outstanding_codes`.
CREATE TABLE IF NOT EXISTS j2_obsidian_connect_epoch (
    user_id TEXT PRIMARY KEY,
    epoch   INTEGER NOT NULL DEFAULT 0
);

-- ── Notebook widget-embed sidecar (Journal Widgets) ─────────────────────────
-- One row per widgetEmbed node in a note's body_json, kept in sync on every
-- note write by notes._sync_note_embeds (create/update/import/delete). This is
-- the indexed answer to "every entry where I traded AMD" / "every entry with a
-- breadth widget" — queryable WITHOUT walking document blobs, and the basis
-- for derived auto-tags. The doc's attrs stay the single authority; these rows
-- are a rebuildable projection of them (never edited directly).
CREATE TABLE IF NOT EXISTS j2_note_embeds (
    note_id        TEXT NOT NULL,
    user_id        TEXT NOT NULL,
    position       INTEGER NOT NULL,          -- document order of the embed
    widget_id      TEXT NOT NULL,
    symbol         TEXT,
    timeframe      TEXT,
    trade_ref      TEXT,
    trade_ref_type TEXT,                      -- 'equity_trade' | 'option_strategy' | NULL (legacy/untyped, Wave 1 rows predate this column)
    mode           TEXT,                      -- 'snapshot' | 'live'
    captured_at    TEXT,
    PRIMARY KEY (note_id, position)
);
CREATE INDEX IF NOT EXISTS idx_j2_note_embeds_user_sym
    ON j2_note_embeds(user_id, symbol);
CREATE INDEX IF NOT EXISTS idx_j2_note_embeds_user_widget
    ON j2_note_embeds(user_id, widget_id);
-- Wave 3's idx_j2_note_embeds_user_traderef (user_id, trade_ref, trade_ref_type)
-- is created further down, alongside the ALTER that adds trade_ref_type to
-- this table on an existing (pre-Wave-3) production DB -- it cannot be created
-- here, since CREATE TABLE IF NOT EXISTS above no-ops on an already-existing
-- table and the column wouldn't exist yet on this path.

-- ── Notebook prose-mention sidecar (P0-3, Wave 1 Slice 2) ───────────────────
-- One row per (note, symbol) CASHTAG mention in a note's plain-text body —
-- kept in sync on every note write by notes._sync_note_mentions
-- (create/update/append), mirroring j2_note_embeds' own "rebuildable
-- projection, never edited directly" contract exactly.
--
-- Cashtag-tier ONLY (buzz_extract.extract()'s "cashtag" tier, never
-- alias/exact/contextual): a member typing `$NVDA` is an explicit, unambiguous
-- signal fit for silent automatic persistence. The OTHER three tiers are
-- recall-biased free-word matching (real symbols like RS/EMA/GAP collide with
-- ordinary vocabulary) — correct for a human-reviewed one-time import offer
-- (enrichment.scan_notes_for_tickers, unchanged by this table), wrong for an
-- automatic pass with no review step: a wrong auto-committed association is a
-- real, if small, annoyance the member never asked for.
--
-- PK (note_id, symbol): a note mentioning the same ticker three times is one
-- row, not three — the reverse-index question is "does this note mention it,"
-- never "how many times."
CREATE TABLE IF NOT EXISTS j2_note_mentions (
    note_id     TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    symbol      TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    PRIMARY KEY (note_id, symbol)
);
CREATE INDEX IF NOT EXISTS idx_j2_note_mentions_user_sym
    ON j2_note_mentions(user_id, symbol);

-- Capture inbox: hotkey captures during the session land here and get placed
-- into notes while writing after the close. A row is one staged widgetEmbed
-- (params + search line + optional archived image); placing it into a note
-- consumes the row. A TABLE, not a preference — prefs have no delete route
-- and no size cap (see user_definitions.py's note on that hazard).
CREATE TABLE IF NOT EXISTS j2_capture_inbox (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    widget_id    TEXT NOT NULL,
    params_json  TEXT NOT NULL DEFAULT '{}',
    search_text  TEXT,
    fallback_url TEXT,
    -- Capture-time chart drawings (chart-parity round): without them the
    -- tray's place() re-seeded from the LIVE store at placement time — an
    -- embed labeled "captured Monday" carried Tuesday's drawings.
    annotations_json TEXT,
    captured_at  TEXT NOT NULL,
    created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_j2_capture_inbox_user
    ON j2_capture_inbox(user_id, created_at DESC);

-- Public share links for notebook notes (post-v1; screener-share idiom: the
-- token IS the credential). One active token per note; revocation keeps the
-- row so a revoked link stays dead instead of being re-mintable by accident.
-- Public track-record share (2026-08-22): one row per user; the token IS
-- the credential (same posture as note/screener shares). Revoke = row
-- delete; rotate = new token. Payload assembly lives in public_profile.py.
CREATE TABLE IF NOT EXISTS j2_public_profiles (
    user_id     TEXT PRIMARY KEY,
    token       TEXT NOT NULL UNIQUE,
    created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS j2_note_shares (
    token       TEXT PRIMARY KEY,
    note_id     TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    revoked_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_j2_note_shares_note
    ON j2_note_shares(note_id, user_id);

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

-- Durable once-per-stale-episode dedup for the MEMBER "connection went stale"
-- email (fleet monitor). Keyed on the broker account; notified_marker = the
-- last_sync_at we last emailed for, which advances on the next successful sync,
-- so an hourly re-sweep of the same episode never re-emails a customer.
CREATE TABLE IF NOT EXISTS j2_broker_member_stale_notify (
    broker_account_id TEXT PRIMARY KEY,
    notified_marker   TEXT NOT NULL
);

-- Durable once-per-ET-day dedup for the OWNER fleet-check Discord digest.
-- Was in-process, so every redeploy re-armed it and a persistent problem
-- re-pinged after each deploy (2026-07-23: the same 12-issue digest landed
-- again in the evening). Single row, id='fleet_digest'.
CREATE TABLE IF NOT EXISTS j2_broker_digest_dedup (
    id           TEXT PRIMARY KEY,
    fingerprint  TEXT NOT NULL,
    et_day       TEXT NOT NULL
);

-- Settlement pin for option holdings (broker/option_reconstruct.py): while a
-- sale's activity is pending delivery (ledger > held), SnapTrade's fleet can
-- serve DIFFERENT held counts sync to sync (measured 8/21: BA 3 and 5 all
-- day). The pin remembers the MINIMUM held seen per contract — the most
-- settled server's answer, i.e. what the broker's own app shows — and resets
-- the moment the ledger changes (a real fill arrives via activities or the
-- Recent Orders rail), so genuine trades still apply instantly.
CREATE TABLE IF NOT EXISTS j2_broker_opt_holdings_memo (
    user_id            TEXT NOT NULL,
    broker_account_id  TEXT NOT NULL,
    contract_key       TEXT NOT NULL,
    min_held           REAL NOT NULL,
    ledger_total       REAL NOT NULL,
    updated_at         TEXT NOT NULL,
    PRIMARY KEY (user_id, broker_account_id, contract_key)
);

-- Mirror-drift sentinel verdicts (broker/mirror_check.py): after every sync,
-- the journal's own tables are compared against the broker payload that sync
-- just used. ONE row per account = the latest verdict; consecutive_drifts
-- distinguishes settlement-window transients from persistent divergence.
CREATE TABLE IF NOT EXISTS j2_broker_mirror_checks (
    user_id            TEXT NOT NULL,
    broker_account_id  TEXT NOT NULL,
    checked_at         TEXT NOT NULL,
    ok                 INTEGER NOT NULL,
    drift_dollar       REAL,
    drift_pct          REAL,
    consecutive_drifts INTEGER NOT NULL DEFAULT 0,
    detail_json        TEXT,
    PRIMARY KEY (user_id, broker_account_id)
);

-- Append-only history of composed-vs-reported drift.
--
-- j2_broker_mirror_checks keeps ONE row per account and pages on a threshold,
-- which finds breakage and is blind to BIAS: the 2026-08-29 $19.96 gap sat
-- under every tolerance, every day, for weeks, and was found only because the
-- owner looked at two screens side by side. A series makes a persistent offset
-- read as the flat band it is. Never upserted — the point is the shape.
CREATE TABLE IF NOT EXISTS j2_broker_drift_series (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id            TEXT NOT NULL,
    broker_account_id  TEXT NOT NULL,
    checked_at         TEXT NOT NULL,
    drift_dollar       REAL,
    drift_pct          REAL,
    ok                 INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_drift_series_acct
    ON j2_broker_drift_series (broker_account_id, checked_at);

-- Precise execution times for date-only brokers (Schwab stamps every
-- activity at midnight): the Recent Orders rail SAW the true execution
-- time in its provisional row; when the midnight-stamped real activity
-- arrives and the provisional is pruned, the precise timestamp is kept
-- here, keyed by the REAL side's match key, and reconstruction re-applies
-- it — real trade times + hour-of-day analytics for members whose broker
-- never sends a clock.
CREATE TABLE IF NOT EXISTS j2_broker_precise_times (
    user_id            TEXT NOT NULL,
    broker_account_id  TEXT NOT NULL,
    match_key          TEXT NOT NULL,
    precise_ts         TEXT NOT NULL,
    PRIMARY KEY (user_id, broker_account_id, match_key)
);

-- Live-composition sentinel (between-sync conservation law): one row per
-- broker account, latest verdict + the component snapshot that produced it
-- (the flight recorder — the 2026-08-26 display could not be reconstructed
-- after the fact because nothing recorded what the composed number was made
-- of).
CREATE TABLE IF NOT EXISTS j2_broker_live_checks (
    user_id            TEXT NOT NULL,
    broker_account_id  TEXT NOT NULL,
    checked_at         TEXT NOT NULL,
    verdict            TEXT NOT NULL,   -- ok | book_lag | structural | skipped
    residual_dollar    REAL,
    consecutive_fails  INTEGER NOT NULL DEFAULT 0,
    components_json    TEXT,
    PRIMARY KEY (user_id, broker_account_id)
);
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
    # The broker's PRIOR-session mark + the sessions each mark belongs to.
    # A closed-session "Today" must be measured broker-mark to broker-mark;
    # the live feed's prev_close is a second vendor's prior close and adds
    # its disagreement at both ends. See balances._roll_broker_marks.
    "ALTER TABLE j2_positions ADD COLUMN broker_price_session TEXT",
    "ALTER TABLE j2_positions ADD COLUMN broker_price_prev REAL",
    "ALTER TABLE j2_positions ADD COLUMN broker_price_prev_session TEXT",
    "ALTER TABLE j2_option_strategies ADD COLUMN source TEXT",
    "ALTER TABLE j2_option_strategies ADD COLUMN external_id TEXT",
    # Current option market value (broker mark x qty x 100), refreshed each sync
    # via holdings-as-truth, so open option strategies can show Current + P&L
    # like equity positions (no tick-live option quote feed).
    "ALTER TABLE j2_option_strategies ADD COLUMN broker_current_value REAL",
    # The broker's PRIOR-session option mark. Stored as EVIDENCE, not yet
    # consumed: on 2026-08-29 our feed said the SNAP LEAP fell 675->665 while
    # the broker's marks said it rose 655->665, and one Saturday cannot decide
    # a $20 swing. The current mark's session is DERIVED from
    # broker_mark_synced_at — no second time authority. See
    # option_reconstruct._roll_option_marks.
    "ALTER TABLE j2_option_strategies ADD COLUMN broker_current_value_prev REAL",
    "ALTER TABLE j2_option_strategies ADD COLUMN broker_current_value_prev_session TEXT",
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
    # Which SnapTrade account this j2_account was created for. Survives a
    # disconnect (the j2_broker_accounts mapping does not), so reconnecting the
    # same brokerage account re-attaches here instead of minting a duplicate
    # "Robinhood ••2364 (2)" and splitting the member's trade history.
    "ALTER TABLE j2_accounts ADD COLUMN snaptrade_account_ref TEXT",
    "CREATE INDEX IF NOT EXISTS idx_j2_accounts_snap_ref "
    "ON j2_accounts(user_id, snaptrade_account_ref)",
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
    # True R (2026-08-21) — stop-free R vs the risk actually taken (MAE).
    # Derivable from stored mae_price + the trade row, so old rows backfill
    # via pure SQL (excursions_store.backfill_true_r) with no bars refetch.
    "ALTER TABLE j2_trade_excursions ADD COLUMN true_r REAL",
    # Journal A+ P5-A2 — per-setup rule LABELS (the checklist template each
    # trade of that setup is graded against later). JSON blob parallel to
    # `setups`: {setupName: [{id, label}]}. Defaults to {} for legacy rows.
    "ALTER TABLE j2_accounts ADD COLUMN setup_rules TEXT NOT NULL DEFAULT '{}'",
    # Journal A+ P5-A3 — per-closed-trade rule ADHERENCE (which of a setup's
    # rules the trader followed on a given trade), keyed on the same stable
    # trade_ref (ext:<external_id> broker / id:<row id> manual) as attachments
    # and excursions so a record survives the broker purge+reinsert cycle.
    # Composite PK (user_id, trade_ref) makes INSERT OR REPLACE idempotent.
    # checked_rule_ids is a JSON array of the rule ids the trader followed;
    # adherence_pct = len(checked)/total_rules (0.0 when total_rules == 0).
    "CREATE TABLE IF NOT EXISTS j2_trade_adherence ("
    "user_id TEXT NOT NULL, trade_ref TEXT NOT NULL, setup TEXT, "
    "checked_rule_ids TEXT NOT NULL DEFAULT '[]', total_rules INTEGER, "
    "adherence_pct REAL, updated_at TEXT NOT NULL, "
    "PRIMARY KEY (user_id, trade_ref))",
    "CREATE INDEX IF NOT EXISTS idx_j2_adherence_user ON j2_trade_adherence(user_id)",
    # Broker data freshness (2026-07-16) — SnapTrade refreshes holdings ~nightly;
    # we track the broker-reported holdings snapshot time so the UI can show an
    # honest "positions as of" stamp, plus the authorization id + last manual
    # refresh stamp so we can request a budgeted on-demand refresh for stale
    # intraday holdings.
    "ALTER TABLE j2_broker_accounts ADD COLUMN holdings_synced_at TEXT",
    "ALTER TABLE j2_broker_accounts ADD COLUMN brokerage_authorization_id TEXT",
    "ALTER TABLE j2_broker_accounts ADD COLUMN last_manual_refresh_at TEXT",
    # SnapTrade sync_status.transactions (2026-07-17) — deterministic backfill
    # completeness: initial_sync_completed replaces the stable-ticks warming
    # heuristic; last_successful_sync (a DATE: synced-through day) +
    # first_transaction_date power honest history-range display.
    "ALTER TABLE j2_broker_accounts ADD COLUMN tx_initial_sync_completed INTEGER",
    "ALTER TABLE j2_broker_accounts ADD COLUMN tx_last_successful_sync TEXT",
    "ALTER TABLE j2_broker_accounts ADD COLUMN first_transaction_date TEXT",
    # Paper-trading flag from the SnapTrade account object — paper accounts
    # must be visually segregated so simulated results never read as real.
    "ALTER TABLE j2_broker_accounts ADD COLUMN is_paper INTEGER",
    # FIX-C — analytics exclusion. A trade the reconstruction cannot vouch for
    # (today: a phantom SHORT whose opening BUY predates the broker's history
    # window) is FLAGGED, never deleted: it stays visible + editable in the trade
    # list and export, and only STAT AGGREGATES skip it. 0/NULL = counted,
    # 1 = excluded. Nullable-with-default so every read uses the NULL-tolerant
    # predicate (filters.ANALYTICS_INCLUDED_SQL) and a legacy row can never be
    # silently dropped.
    "ALTER TABLE j2_trades ADD COLUMN analytics_excluded INTEGER DEFAULT 0",
    # Why it was flagged: 'phantom_short' (auto) | 'manual' (user opt-out).
    "ALTER TABLE j2_trades ADD COLUMN analytics_excluded_reason TEXT",
    "CREATE INDEX IF NOT EXISTS idx_j2_trades_user_excl "
    "ON j2_trades(user_id, analytics_excluded)",
    # Notebook card thumbnail: the src of the FIRST inline image in a note's
    # body, cached so the (body_json-less) list projection can render a small
    # preview glyph without shipping the whole document. Populated on every body
    # save + lazily backfilled when a note is opened. NULL = no image (or not yet
    # computed for a legacy note that hasn't been opened/saved since this shipped).
    "ALTER TABLE j2_notes ADD COLUMN first_image_url TEXT",
    # audit B5: see the column's comment on the fresh CREATE TABLE above.
    # A DB that ran ensure_schema() before this shipped never gained the
    # column any other way — there is no versioned migration for it because
    # a bare idempotent ALTER (this list's own pattern) is a genuine fit for
    # one nullable column with no data to backfill.
    "ALTER TABLE j2_notes ADD COLUMN import_media_pending INTEGER",
    # Wave 0 (Notebook Primary-Platform, trust foundation): soft-delete
    # marker. NULL = active (every existing row, every existing query path,
    # unchanged). Set = in the trash — excluded from list/search/count by
    # default (_notes_filter_sql), restorable, hard-purged by a scheduled
    # sweep past the retention window. Deliberately ONE column, not a
    # separate trash table: every existing note-scoped join (embeds, the
    # FTS mirror, the account-deletion purge) keeps working unchanged, and
    # `account_purge.py`'s `DELETE FROM j2_notes WHERE user_id = ?` already
    # covers a soft-deleted row unconditionally — confirmed, not assumed,
    # before this column was added.
    "ALTER TABLE j2_notes ADD COLUMN deleted_at TEXT",
    "CREATE INDEX IF NOT EXISTS idx_j2_notes_user_deleted ON j2_notes(user_id, deleted_at)",
    # Wave 1 (P1-1): a capture routed to the inbox must not silently drop the
    # member-typed comment or a trade link — the SAME two fields the "current
    # note"/"new entry" destinations already carry via the full widgetEmbed
    # attrs bag. Without these columns, a comment only survived for 2 of the
    # 4 destinations.
    "ALTER TABLE j2_capture_inbox ADD COLUMN caption TEXT",
    "ALTER TABLE j2_capture_inbox ADD COLUMN trade_ref TEXT",
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

    try:
        run_notebook_migration_v2(conn)
    except Exception as e:  # noqa: BLE001 — never crash startup over this
        print(f"[notebook-migration-v2] aborted: {e}")

    # Partial UNIQUE index on (user_id, import_key) — created here, AFTER both
    # notebook migrations, so it can never reference import_key before that
    # column exists (the Critical-1 bug: the old copy of this statement lived
    # in _J2_SCHEMA's executescript, which ran first). DROP-then-CREATE
    # (rather than a bare CREATE UNIQUE INDEX IF NOT EXISTS) so a dev DB still
    # carrying the old NON-unique index (from before this fix, or from a
    # `run_notebook_migration_v2` that already ran once under the old code)
    # upgrades to the unique partial form cleanly. Guarded on the column
    # actually existing + wrapped so a prior migration failure can never take
    # startup down over an index.
    try:
        ncols = {r[1] for r in conn.execute("PRAGMA table_info(j2_notes)")}
        if "import_key" in ncols:
            conn.execute("DROP INDEX IF EXISTS idx_j2_notes_user_import")
            conn.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_j2_notes_user_import "
                "ON j2_notes(user_id, import_key) WHERE import_key IS NOT NULL"
            )
            conn.commit()
    except Exception as e:  # noqa: BLE001 — never crash startup over this
        print(f"[notebook-migration-v2] index creation aborted: {e}")

    try:
        run_notebook_migration_v3(conn)
    except Exception as e:  # noqa: BLE001 — never crash startup over this
        print(f"[notebook-migration-v3] aborted: {e}")

    try:
        run_notebook_migration_v4(conn)
    except Exception as e:  # noqa: BLE001 — never crash startup over this
        print(f"[notebook-migration-v4] aborted: {e}")

    # Order-independent (2026-09-02 fix): both v4 and v5 resync
    # j2_notes_fts_map via the shared `_resync_fts_map` full-rebuild, so
    # running v5 before/after/without v4 (e.g. only one of their flags was
    # ever lost) always converges correctly. See run_notebook_migration_v5's
    # and _resync_fts_map's docstrings.
    try:
        run_notebook_migration_v5(conn)
    except Exception as e:  # noqa: BLE001 — never crash startup over this
        print(f"[notebook-migration-v5] aborted: {e}")

    try:
        run_notebook_migration_v6(conn)
    except Exception as e:  # noqa: BLE001 — never crash startup over this
        print(f"[notebook-migration-v6] aborted: {e}")

    # Note Connectors additive columns (Task 8): `miss_streak` on
    # j2_note_remote_index (2-strikes delete-detection counter) and
    # `conflicts` on j2_note_sync_log. run_notebook_migration_v3 above is
    # flag-gated (returns instantly once `.notebook_migration_v3` exists) AND
    # its CREATE TABLE IF NOT EXISTS statements no-op on a table that already
    # exists — so ANY DB that ran ensure_schema() under a _J2_SCHEMA snapshot
    # from before these two columns existed never gains them without a
    # dedicated ALTER. Mirrors the _PHASE_2_ALTERS idiom exactly (idempotent
    # via try/except, since SQLite has no ADD COLUMN IF NOT EXISTS). Placed
    # HERE, after the v3 call, so it never runs before the tables exist on a
    # DB whose _J2_SCHEMA predates the Note Connectors tables entirely.
    for stmt in (
        "ALTER TABLE j2_note_remote_index ADD COLUMN miss_streak INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE j2_note_sync_log ADD COLUMN conflicts INTEGER",
        # Deletion lifecycle: how many notes this pass SEVERED from
        # their remote (tagged `source-deleted`). Without it the
        # connectors card can render created/updated/conflicts but is
        # structurally blind to deletions -- the one lifecycle outcome
        # a member is most likely to want explained.
        "ALTER TABLE j2_note_sync_log ADD COLUMN source_deleted INTEGER",
        # Chart-parity round: capture-time drawings ride the inbox row.
        "ALTER TABLE j2_capture_inbox ADD COLUMN annotations_json TEXT",
        # Wave 3 (Thesis-Trade Link): j2_trades.id and j2_option_strategies.id
        # are independent uuid4 namespaces, so a bare trade_ref cannot safely
        # identify its target table alone. Existing Wave-1 rows predate this
        # column and stay NULL (legacy/untyped) -- see note_trade_links.py's
        # resolver for how those are handled (never guessed).
        "ALTER TABLE j2_note_embeds ADD COLUMN trade_ref_type TEXT",
        "ALTER TABLE j2_capture_inbox ADD COLUMN trade_ref_type TEXT",
    ):
        try:
            conn.execute(stmt)
        except sqlite3.OperationalError as e:
            msg = str(e).lower()
            if "duplicate column" not in msg and "already exists" not in msg:
                raise
    conn.commit()

    # Index on j2_note_sources — created here, AFTER migration v3, so it can
    # never run before the table exists on a DB whose _J2_SCHEMA predates the
    # Note Connectors tables (mirrors idx_j2_notes_user_import above).
    try:
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_j2_note_sources_user "
            "ON j2_note_sources(user_id, provider)"
        )
        conn.commit()
    except Exception as e:  # noqa: BLE001 — never crash startup over this
        print(f"[notebook-migration-v3] index creation aborted: {e}")

    # Wave 3 (Thesis-Trade Link): index on j2_note_embeds' new trade_ref_type
    # column, created here (AFTER the ALTER above that adds it) so it never
    # runs before the column exists on a pre-Wave-3 production DB. The
    # reverse lookup (a trade/strategy's linked notes) is ALWAYS
    # user_id + trade_ref + trade_ref_type together -- see note_trade_links.py.
    try:
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_j2_note_embeds_user_traderef "
            "ON j2_note_embeds(user_id, trade_ref, trade_ref_type)"
        )
        conn.commit()
    except Exception as e:  # noqa: BLE001 — never crash startup over this
        print(f"[notebook-migration] trade_ref_type index creation aborted: {e}")


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


def run_notebook_migration_v2(conn: sqlite3.Connection) -> None:
    """Folder tree (parent_id) + import provenance columns on j2_notes.
    Idempotent via .notebook_migration_v2 flag file AND column probes + v1 leftover
    probe, so a fresh DB created after this ships is also handled. Every step is
    individually idempotent and resumable (never relies on transactional DDL).
    parent_id uses '' as the root sentinel (NULLs are distinct in SQLite UNIQUE
    constraints, which would allow duplicate root names)."""
    flag = _data_dir() / ".notebook_migration_v2"
    if flag.exists():
        return

    # Probe sqlite_master for leftover v1 table (crash recovery). If a process dies
    # between RENAME and CREATE TABLE, the next boot must detect and resume.
    v1_exists = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='j2_note_folders_v1'"
    ).fetchone() is not None

    # Rebuild j2_note_folders if either:
    # - Current table exists and is missing parent_id, OR
    # - v1 is stranded (crashed between RENAME and CREATE new table)
    fcols = {r[1] for r in conn.execute("PRAGMA table_info(j2_note_folders)")}
    needs_rebuild = (fcols and "parent_id" not in fcols) or v1_exists

    if needs_rebuild:
        # Only rename if v1 doesn't exist yet (first boot of the rebuild).
        if not v1_exists and "parent_id" not in fcols:
            conn.execute("ALTER TABLE j2_note_folders RENAME TO j2_note_folders_v1")

        # Create new shape (idempotent: IF NOT EXISTS so re-runs are safe).
        conn.execute(
            """CREATE TABLE IF NOT EXISTS j2_note_folders (
                id          TEXT PRIMARY KEY,
                user_id     TEXT NOT NULL,
                name        TEXT NOT NULL,
                parent_id   TEXT NOT NULL DEFAULT '',
                sort_order  INTEGER NOT NULL DEFAULT 0,
                created_at  TEXT NOT NULL,
                UNIQUE(user_id, parent_id, name))"""
        )

        # Re-insert from v1 (INSERT OR IGNORE so re-runs skip already-copied rows).
        # This is safe even if INSERT...SELECT was interrupted partway.
        conn.execute(
            "INSERT OR IGNORE INTO j2_note_folders (id, user_id, name, parent_id, sort_order, created_at) "
            "SELECT id, user_id, name, '', sort_order, created_at FROM j2_note_folders_v1"
        )

        # Drop the old table (safe to re-run: DROP TABLE IF NOT EXISTS, though
        # this one succeeds only if v1 exists, so it's idempotent by construction).
        conn.execute("DROP TABLE IF EXISTS j2_note_folders_v1")

        # Recreate the index (IF NOT EXISTS, idempotent).
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_j2_note_folders_user "
            "ON j2_note_folders(user_id, sort_order)"
        )

    # Add import columns to j2_notes (each individually idempotent via ALTER IF NOT EXISTS pattern).
    ncols = {r[1] for r in conn.execute("PRAGMA table_info(j2_notes)")}
    for col in ("import_source", "import_key", "import_hash", "imported_at"):
        if ncols and col not in ncols:
            conn.execute(f"ALTER TABLE j2_notes ADD COLUMN {col} TEXT")

    # Recreate the index as a PARTIAL UNIQUE index — DROP-then-CREATE (not
    # just IF NOT EXISTS) so a dev DB carrying the old non-unique version of
    # this index upgrades cleanly. WHERE import_key IS NOT NULL because most
    # notes are never imported (mirrors the other partial-unique indexes in
    # this file, e.g. idx_j2_trades_extid).
    conn.execute("DROP INDEX IF EXISTS idx_j2_notes_user_import")
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_j2_notes_user_import "
        "ON j2_notes(user_id, import_key) WHERE import_key IS NOT NULL"
    )

    conn.commit()
    try:
        flag.parent.mkdir(parents=True, exist_ok=True)
        flag.touch()
    except Exception:
        pass


# Same DDL as the CREATE TABLE IF NOT EXISTS statements in _J2_SCHEMA (kept as
# literal text, not shared/interpolated, so this migration reads standalone
# like v1/v2 do). Table-probed + IF NOT EXISTS makes re-running this against a
# DB that already has these tables (i.e. every DB created under the current
# _J2_SCHEMA) a pure no-op.
_NOTE_CONNECTOR_TABLE_DDL = {
    "j2_note_connectors": """
        CREATE TABLE IF NOT EXISTS j2_note_connectors (
            user_id       TEXT NOT NULL,
            provider      TEXT NOT NULL,
            token_enc     TEXT NOT NULL,
            account_label TEXT,
            status        TEXT NOT NULL DEFAULT 'active',
            consent_at    TEXT,
            created_at    TEXT,
            updated_at    TEXT,
            PRIMARY KEY(user_id, provider)
        )
    """,
    "j2_note_sources": """
        CREATE TABLE IF NOT EXISTS j2_note_sources (
            id                TEXT PRIMARY KEY,
            user_id           TEXT NOT NULL,
            provider          TEXT NOT NULL,
            remote_id         TEXT NOT NULL,
            display_name      TEXT,
            dest_folder_id    TEXT,
            cursor            TEXT,
            sync_enabled      INTEGER NOT NULL DEFAULT 1,
            status            TEXT NOT NULL DEFAULT 'active',
            last_sync_at      TEXT,
            last_sync_status  TEXT,
            last_sync_error   TEXT,
            warming_until     TEXT,
            created_at        TEXT NOT NULL,
            UNIQUE(user_id, provider, remote_id)
        )
    """,
    "j2_note_sync_log": """
        CREATE TABLE IF NOT EXISTS j2_note_sync_log (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            source_id       TEXT NOT NULL,
            user_id         TEXT NOT NULL,
            started_at      TEXT,
            finished_at     TEXT,
            status          TEXT,
            error           TEXT,
            notes_created   INTEGER,
            notes_updated   INTEGER,
            notes_skipped   INTEGER,
            media_uploaded  INTEGER,
            conflicts       INTEGER,
            source_deleted  INTEGER
        )
    """,
    "j2_note_remote_index": """
        CREATE TABLE IF NOT EXISTS j2_note_remote_index (
            user_id           TEXT NOT NULL,
            source_id         TEXT NOT NULL,
            remote_id         TEXT NOT NULL,
            import_key        TEXT NOT NULL,
            remote_updated_at TEXT,
            seen_at           TEXT NOT NULL,
            miss_streak       INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY(user_id, source_id, remote_id)
        )
    """,
}


def run_notebook_migration_v3(conn: sqlite3.Connection) -> None:
    """Creates the four Note Connectors tables (j2_note_connectors /
    j2_note_sources / j2_note_sync_log / j2_note_remote_index) for
    pre-existing DBs that ran ensure_schema() under an older _J2_SCHEMA that
    didn't yet define them. Idempotent via .notebook_migration_v3 flag file
    AND table probes + CREATE TABLE IF NOT EXISTS, so re-running this (or
    running it against a DB that already has the tables from the current
    _J2_SCHEMA) is always a no-op. Safe to call on every startup.

    No ALTERs — these are brand-new tables, so unlike v1/v2 there is no
    existing-column state to probe; the table-existence probe below is
    belt-and-suspenders redundancy with the CREATE TABLE IF NOT EXISTS
    statements already in _J2_SCHEMA.

    Spec: docs/superpowers/specs/2026-08-11-note-connectors-design.md §5."""
    flag = _data_dir() / ".notebook_migration_v3"
    if flag.exists():
        return

    existing = {
        r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name IN "
            "('j2_note_connectors','j2_note_sources','j2_note_sync_log',"
            "'j2_note_remote_index')"
        )
    }
    for table, ddl in _NOTE_CONNECTOR_TABLE_DDL.items():
        if table not in existing:
            conn.execute(ddl)

    conn.commit()
    try:
        flag.parent.mkdir(parents=True, exist_ok=True)
        flag.touch()
    except Exception:
        pass


def _resync_fts_map(conn: sqlite3.Connection) -> None:
    """Rebuilds j2_notes_fts_map from j2_notes_fts's CURRENT rowids -- a full
    DELETE+INSERT, never a partial patch. `INSERT OR IGNORE` looks idempotent
    but is NOT safe here: after j2_notes_fts's rowids get reassigned (which
    only `run_notebook_migration_v4`'s raw-DML rebuild does, since it bypasses
    every trigger), an existing map row for a note_id that survived the
    rebuild is left pointing at its OLD (now wrong) rowid forever -- `OR
    IGNORE` skips writing the corrected value because a row for that note_id
    already exists. Reproduced (2026-09-02 review round): after one note
    delete + a lone rerun of v4, 5 of 10 notes' map rows silently pointed at
    a DIFFERENT note's fts row, and one was a dangling pointer to a rowid
    that no longer existed -- a member's search could return someone else's
    note, or a deleted note could stay searchable forever. A full rebuild
    has no such history to get stuck on: it always describes "the map
    matches whatever j2_notes_fts holds right now," which is correct by
    construction regardless of what ran before it, in what order, or how
    many times.

    Cheap regardless of table size -- reads rowids j2_notes_fts already
    assigned, never re-tokenizes or rewrites FTS content.

    THE INVARIANT THIS ENFORCES: whatever rebuilds j2_notes_fts must also
    rebuild j2_notes_fts_map, in the same transaction, every time. Called
    from BOTH run_notebook_migration_v4 (right after ITS OWN j2_notes_fts
    rebuild, before that function's commit -- so losing only v4's flag and
    forcing a solo rerun can never desync the map, since v4 now carries its
    own fix-up) and run_notebook_migration_v5 (as its entire map-side job,
    now that map *creation* lives in _J2_SCHEMA itself -- so losing only
    v5's flag, or losing both, converges just as correctly). Neither
    migration is the sole owner of map correctness; this function is the
    one owner both call into, in whatever order their flags happen to have
    been lost."""
    conn.execute("DELETE FROM j2_notes_fts_map")
    conn.execute(
        "INSERT INTO j2_notes_fts_map(note_id, fts_rowid) "
        "SELECT note_id, rowid FROM j2_notes_fts"
    )


def run_notebook_migration_v4(conn: sqlite3.Connection) -> None:
    """Backfills j2_notes_fts for DBs whose notes predate the search index.

    Idempotent by CONSTRUCTION, not just by flag: it deletes the whole index
    and rebuilds it from j2_notes, so a half-finished previous run, a manual
    re-run, or a restored backup all converge on the same correct state. The
    flag file only makes the common case cheap.

    The index is DERIVED -- j2_notes.body_plain is authoritative -- so a full
    rebuild is always safe and never loses data.

    Also resyncs j2_notes_fts_map (`_resync_fts_map`, same transaction,
    before commit) -- this rebuild is raw DML directly on j2_notes_fts, which
    fires no trigger defined ON j2_notes, so nothing else keeps the map in
    step with the rowids this just reassigned. See `_resync_fts_map`'s
    docstring for the desync this closes (reproduced 2026-09-02: losing only
    this migration's flag and forcing a solo rerun left 5 of 10 map rows
    pointing at the WRONG note's fts row).

    Spec: docs/superpowers/specs/2026-09-01-notebook-migration-program-design.md §4.1
    """
    flag = _data_dir() / ".notebook_migration_v4"
    if flag.exists():
        return

    has_fts = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='j2_notes_fts'"
    ).fetchone()
    if not has_fts:
        return  # _J2_SCHEMA has not run yet; nothing to backfill into.

    conn.execute("DELETE FROM j2_notes_fts")
    conn.execute(
        "INSERT INTO j2_notes_fts(note_id, user_id, title, body_plain) "
        "SELECT id, user_id, title, body_plain FROM j2_notes"
    )
    # Same transaction as the rebuild above -- see _resync_fts_map's
    # docstring for why this can never be a separate, flag-gated step.
    _resync_fts_map(conn)
    conn.commit()

    note_count = conn.execute("SELECT COUNT(*) FROM j2_notes").fetchone()[0]
    if note_count == 0:
        # Nothing existed to backfill yet -- this DB has no legacy notes
        # (e.g. ensure_schema() runs this on every fresh install before any
        # note is ever created). Don't mark done: a flag written against zero
        # rows would let a not-yet-arrived batch of legacy notes (a restored
        # backup, a delayed import) slip past the backfill forever. Deferring
        # costs nothing -- the next boot's DELETE+INSERT is equally free
        # against an empty table.
        return

    try:
        flag.parent.mkdir(parents=True, exist_ok=True)
        tmp = flag.with_suffix(".tmp")
        tmp.write_bytes(b"1")
        os.replace(tmp, flag)
    except Exception:
        # Matches v1/v2/v3's defensive flag-write: unlike theirs, this one
        # was missing the mkdir (DATA_DIR not yet created on a very first
        # boot) -- so a write failure here fell through uncaught into
        # ensure_schema's outer try/except, which prints and moves on
        # WITHOUT the flag ever landing. Since the DELETE+INSERT rebuild
        # above already committed, the *data* is fine either way -- but a
        # never-persisted flag means the NEXT boot sees no flag, redoes the
        # full rebuild (measured 11.5s at 20,000 notes, synchronous, before
        # the pod serves), and repeats that on every boot forever. Catching
        # here (rather than relying on the outer catch) makes that a no-op
        # miss instead of a silent permanent cost.
        pass


# Literal DDL, duplicated (not shared/interpolated) with the matching block
# in _J2_SCHEMA -- same convention as _NOTE_CONNECTOR_TABLE_DDL above, so
# this migration reads standalone.
_J2_NOTES_FTS_MAP_DDL = """
CREATE TABLE IF NOT EXISTS j2_notes_fts_map (
    note_id    TEXT PRIMARY KEY,
    fts_rowid  INTEGER NOT NULL
)
"""

_J2_NOTES_FTS_TRIGGERS_DDL = """
CREATE TRIGGER j2_notes_fts_ai AFTER INSERT ON j2_notes BEGIN
    INSERT INTO j2_notes_fts(note_id, user_id, title, body_plain)
    VALUES (new.id, new.user_id, new.title, new.body_plain);
    INSERT INTO j2_notes_fts_map(note_id, fts_rowid)
    VALUES (new.id, last_insert_rowid());
END;

CREATE TRIGGER j2_notes_fts_ad AFTER DELETE ON j2_notes BEGIN
    DELETE FROM j2_notes_fts
    WHERE rowid = (SELECT fts_rowid FROM j2_notes_fts_map WHERE note_id = old.id);
    DELETE FROM j2_notes_fts_map WHERE note_id = old.id;
END;

CREATE TRIGGER j2_notes_fts_au
AFTER UPDATE OF title, body_plain ON j2_notes BEGIN
    DELETE FROM j2_notes_fts
    WHERE rowid = (SELECT fts_rowid FROM j2_notes_fts_map WHERE note_id = old.id);
    INSERT INTO j2_notes_fts(note_id, user_id, title, body_plain)
    VALUES (new.id, new.user_id, new.title, new.body_plain);
    INSERT OR REPLACE INTO j2_notes_fts_map(note_id, fts_rowid)
    VALUES (new.id, last_insert_rowid());
END;
"""


def run_notebook_migration_v5(conn: sqlite3.Connection) -> None:
    """Closes the j2_notes_fts_au/ad scale trap: DELETE FROM j2_notes_fts
    WHERE note_id = ? has no index to use (note_id is UNINDEXED on a virtual
    table, and CREATE INDEX cannot target a virtual table at all), so it
    scanned every row's stored content on every Save. Measured (control with
    triggers removed vs. the shipped triggers, median of 5, 4KB bodies):

        notes in j2_notes_fts   no triggers   as shipped   tax
        5,000                   2.41ms        19.09ms      7.9x
        20,000                  2.04ms        65.33ms      32.0x

    j2_notes_fts is one GLOBAL table shared by every user's notes (it lives
    in auth.db), so the tax scaled with the WHOLE table's size, not the
    saving user's own note count -- one member's Save paid for every
    member's notes.

    Fix: j2_notes_fts_map (an ORDINARY table, so it can carry a real
    PRIMARY KEY index) tracks note_id -> the rowid FTS5 itself assigned at
    insert time, letting the AU/AD triggers delete by `rowid = ?` (an
    indexed point lookup) instead of `note_id = ?` (an unindexed scan).
    _J2_SCHEMA ships this shape for every fresh install; this migration
    upgrades a pre-existing DB still running the old (scan-based) trigger
    bodies -- CREATE TRIGGER IF NOT EXISTS in an executescript is a NO-OP
    against a trigger name that already exists, so simply re-running
    _J2_SCHEMA can never replace them (same reason
    idx_j2_notes_user_import above is DROP-then-CREATE rather than bare
    IF NOT EXISTS).

    SQLite version note on the rejected `contentless_delete=1` alternative:
    that option needs SQLite 3.43+ (this project's dev runtime measured
    3.50.4, comfortably above it; a live SSH probe of the Railway pod's
    actual bundled SQLite was attempted and blocked by this session's tool
    policy, so that number is UNCONFIRMED -- see the c3 report). It turned
    out not to matter regardless: a contentless FTS5 table returns NULL for
    every column on a MATCH read, UNINDEXED ones included (verified
    empirically), which would make note_id -- the one thing every search
    caller needs back -- permanently unreadable. Version support was moot
    once the mechanism itself couldn't serve this table's actual read shape.

    Idempotent via the .notebook_migration_v5 flag AND by construction: the
    map resync is a full DELETE+INSERT (`_resync_fts_map` -- see its
    docstring), and the trigger swap is DROP-then-CREATE, so re-running this
    (including against a DB that already has the current _J2_SCHEMA's fixed
    triggers, or one where run_notebook_migration_v4 just rebuilt
    j2_notes_fts out from under an already-completed v5) is always a no-op
    OR a self-heal, never a source of drift.

    Order-INDEPENDENT by design (2026-09-02 review round fixed this):
    safe to run before, after, or interleaved with a v4 rerun, and safe if
    ONLY this migration's flag is ever lost while v4's stays put. Both
    migrations call the same `_resync_fts_map` -- a full rebuild of the map
    from whatever j2_notes_fts currently holds -- so whichever one runs
    last always leaves a correct pairing, and running the "wrong" one alone
    is never a way to end up worse off than before. (The prior version of
    this migration used `INSERT OR IGNORE` for its own backfill and
    required running immediately after v4 on the same boot; both of those
    constraints are gone now that map correctness has one owner instead of
    two migrations coordinating by ordering.)

    Spec: docs/superpowers/sdd/2026-09-01-notebook-migration-wave0-scale/c3-report.md
    """
    flag = _data_dir() / ".notebook_migration_v5"
    if flag.exists():
        return

    conn.execute(_J2_NOTES_FTS_MAP_DDL)

    has_fts = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='j2_notes_fts'"
    ).fetchone()
    if not has_fts:
        # _J2_SCHEMA has not run yet; nothing to backfill or repoint. Mirrors
        # v4's own early-return, but does NOT touch the flag here either --
        # same reasoning as v4's note_count==0 guard below: a DB that hasn't
        # created j2_notes_fts yet should get a real pass once it has one,
        # not a flag written against nothing.
        return

    # Full rebuild of the map from j2_notes_fts's CURRENT rowids -- see
    # _resync_fts_map's docstring for why a partial patch (INSERT OR IGNORE)
    # is unsafe here.
    _resync_fts_map(conn)

    # Repoint the triggers: DROP + CREATE (not IF NOT EXISTS) so a DB
    # carrying the OLD (scan-based) trigger bodies is upgraded -- the same
    # DROP-then-CREATE idiom idx_j2_notes_user_import uses above, for the
    # identical "IF NOT EXISTS no-ops against an existing name" reason.
    conn.execute("DROP TRIGGER IF EXISTS j2_notes_fts_ai")
    conn.execute("DROP TRIGGER IF EXISTS j2_notes_fts_ad")
    conn.execute("DROP TRIGGER IF EXISTS j2_notes_fts_au")
    conn.executescript(_J2_NOTES_FTS_TRIGGERS_DDL)

    conn.commit()
    try:
        flag.parent.mkdir(parents=True, exist_ok=True)
        flag.touch()
    except Exception:
        pass


# Literal DDL, duplicated (not shared/interpolated) with the matching block in
# _J2_SCHEMA -- same convention as _NOTE_CONNECTOR_TABLE_DDL above, so this
# migration reads standalone.
_OBSIDIAN_TABLE_DDL = {
    "j2_obsidian_devices": """
        CREATE TABLE IF NOT EXISTS j2_obsidian_devices (
            id           TEXT PRIMARY KEY,
            user_id      TEXT NOT NULL,
            vault_id     TEXT NOT NULL,
            token_enc    TEXT NOT NULL,
            label        TEXT,
            last_seen_at TEXT,
            created_at   TEXT NOT NULL,
            UNIQUE(user_id, vault_id)
        )
    """,
    "j2_obsidian_staging": """
        CREATE TABLE IF NOT EXISTS j2_obsidian_staging (
            user_id      TEXT NOT NULL,
            vault_id     TEXT NOT NULL,
            vault_path   TEXT NOT NULL,
            content_hash TEXT NOT NULL,
            body_md      TEXT NOT NULL,
            updated_at   TEXT NOT NULL,
            received_at  TEXT NOT NULL,
            PRIMARY KEY (user_id, vault_id, vault_path)
        )
    """,
    "j2_obsidian_manifest": """
        CREATE TABLE IF NOT EXISTS j2_obsidian_manifest (
            user_id     TEXT NOT NULL,
            vault_id    TEXT NOT NULL,
            vault_path  TEXT NOT NULL,
            recorded_at TEXT NOT NULL,
            PRIMARY KEY (user_id, vault_id, vault_path)
        )
    """,
}


def run_notebook_migration_v6(conn: sqlite3.Connection) -> None:
    """Creates the three Obsidian ingest tables (j2_obsidian_devices /
    j2_obsidian_staging / j2_obsidian_manifest) for pre-existing DBs that ran
    ensure_schema() under an older _J2_SCHEMA that didn't yet define them.
    Idempotent via .notebook_migration_v6 flag file AND table probes + CREATE
    TABLE IF NOT EXISTS, so re-running this (or running it against a DB that
    already has the tables from the current _J2_SCHEMA) is always a no-op.
    Safe to call on every startup.

    No ALTERs -- these are brand-new tables, so like run_notebook_migration_v3
    there is no existing-column state to probe; the table-existence probe
    below is belt-and-suspenders redundancy with the CREATE TABLE IF NOT
    EXISTS statements already in _J2_SCHEMA. Follows v3's shape exactly.

    `j2_obsidian_staging` is the seam that lets a PUSH transport (the
    Obsidian plugin) reuse the PULL-shaped sync engine: the plugin writes
    here, a later task's provider reads here and satisfies the ordinary
    NoteProvider contract, so the engine's convert/upsert/conflict/media path
    never learns there was a difference. `j2_obsidian_manifest` holds the
    vault's complete file list, feeding the engine's existing optional
    `list_present_refs` hook so a vault deletion is detected by the same
    machinery that detects a deleted Notion page.

    Spec: .superpowers/sdd/2026-09-02-obsidian-ingest-server/task-1-brief.md
    """
    flag = _data_dir() / ".notebook_migration_v6"
    if flag.exists():
        return

    existing = {
        r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name IN "
            "('j2_obsidian_devices','j2_obsidian_staging','j2_obsidian_manifest')"
        )
    }
    for table, ddl in _OBSIDIAN_TABLE_DDL.items():
        if table not in existing:
            conn.execute(ddl)

    conn.commit()
    try:
        flag.parent.mkdir(parents=True, exist_ok=True)
        tmp = flag.with_suffix(".tmp")
        tmp.write_bytes(b"1")
        os.replace(tmp, flag)
    except Exception:
        # Encoding-safe flag write (tmp -> os.replace), with the mkdir an
        # earlier migration in this repo omitted (see run_notebook_migration_v4's
        # docstring): without it, a flag-write failure here falls through
        # uncaught into ensure_schema's outer try/except (which prints and
        # moves on) WITHOUT the flag ever landing -- and since the table
        # creation above already committed, the data is fine, but the NEXT
        # boot sees no flag and repeats the (here, cheap) table-existence
        # probe on every boot forever. Caught here so a write failure is a
        # no-op miss, not a silent permanent cost.
        pass
