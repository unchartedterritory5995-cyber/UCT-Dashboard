# User Data Deletion Manifest — Journal 2.0 / Notebook table family

**Status: FIXED.** Discovered 2026-09-05 during UCT Notebook Primary-Platform Phase One
adversarial research, independently re-verified by directly executing the schema and the
cascade's own discovery query in an isolated sandbox (not just reading it). Fixed on branch
`fix/account-deletion-notebook-purge` via `api/services/journal_two/account_purge.py`, wired
into both account-deletion endpoints in `api/routers/auth.py` ahead of `_cascade_delete_user`.

## The defect

`_cascade_delete_user` (`api/routers/auth.py`) discovers which tables to wipe entirely via
`PRAGMA foreign_key_list` — it deletes rows only from tables that declare an explicit
`FOREIGN KEY ... REFERENCES users(id)`. None of the 60+ `j2_*` tables (Journal 2.0 / Notebook:
notes, trades, positions, verdicts, chat history, broker sync, attachments) declare that
foreign key, despite the function's own docstring previously claiming "journal/j2_*" was
covered. The mechanism therefore never touched any of them. A member who requested account
deletion, processed via either `DELETE /admin/users/{id}` or `POST /admin/delete-user`, kept
every row of their Journal 2.0 / Notebook data indefinitely, orphaned under a `user_id` with
no corresponding `users` row — a live data-lifecycle gap with likely privacy/compliance
relevance, independent of any feature roadmap.

A second, smaller instance of the same shape was found in the same pass: the existing
broker-only purge (`journal_two/broker/service.py::purge_on_account_deletion`) itself only
covers 5 of the 14 `j2_broker_*` tables (`j2_broker_activities`, `j2_broker_accounts`,
`j2_broker_sync_log`, `j2_broker_dup_flags`, `j2_broker_users`) — the other 9
(`j2_broker_equity_snapshots`, `j2_broker_cash_flows`, `j2_broker_opt_holdings_memo`,
`j2_broker_mirror_checks`, `j2_broker_drift_series`, `j2_broker_precise_times`,
`j2_broker_live_checks`, plus the indirectly-owned `j2_broker_member_stale_notify`) were also
never purged. This manifest and the new `account_purge.py` cover all 14.

## Manifest

Ownership was determined by reading the actual schema (`api/services/journal_two/db.py`) and
the code that writes each table — not assumed from the `j2_` prefix. One row, `j2_broker_digest_dedup`,
is correctly **not** purged: it is a single global row (`id='fleet_digest'`) for the owner's
own internal fleet-check digest, not per-user member data.

| Table / store | Owner key | Direct / indirect | Prior behavior | Now | Verification |
|---|---|---|---|---|---|
| `j2_settings` | `user_id` | Direct | Not purged | Purged | Test matrix below |
| `j2_positions` | `user_id` | Direct | Not purged | Purged | " |
| `j2_trades` | `user_id` | Direct | Not purged | Purged | " |
| `j2_day_notes` | `user_id` | Direct | Not purged | Purged | " |
| `j2_accounts` | `user_id` | Direct | Not purged | Purged | " |
| `j2_option_strategies` | `user_id` | Direct | Not purged | Purged | " |
| `j2_option_legs` | `strategy_id` → `j2_option_strategies.user_id` | **Indirect** | Not purged | Purged (join delete) | " |
| `j2_playbook_entries` | `user_id` | Direct | Not purged | Purged | " |
| `j2_coach_outputs` | `user_id` | Direct | Not purged | Purged | " |
| `j2_chat_messages` | `user_id` | Direct | Not purged | Purged | " |
| `j2_onboarding_responses` | `user_id` | Direct | Not purged | Purged | " |
| `j2_verdicts` | `user_id` | Direct | Not purged | Purged | " |
| `j2_trade_reviews` | `user_id` | Direct | Not purged | Purged | " |
| `j2_interventions` | `user_id` | Direct | Not purged | Purged | " |
| `j2_profile_suggestions` | `user_id` | Direct | Not purged | Purged | " |
| `j2_journal_rules` | `user_id` | Direct | Not purged | Purged | " |
| `j2_unified_coach_state` | `user_id` (PK) | Direct | Not purged | Purged | " |
| `j2_weekly_email_log` | `user_id` | Direct | Not purged | Purged | " |
| `j2_notes` | `user_id` | Direct | Not purged | Purged (fires the existing `AFTER DELETE` FTS-mirror trigger per row) | " |
| `j2_notes_fts` / `j2_notes_fts_map` | derived from `j2_notes` | — | N/A (trigger-mirrored) | Cleaned automatically by the existing trigger when `j2_notes` rows are deleted | " |
| `j2_note_folders` | `user_id` | Direct | Not purged | Purged | " |
| `j2_note_embeds` | `user_id` | Direct | Not purged | Purged | " |
| `j2_note_mentions` | `user_id` | Direct | Not purged | Purged | " |
| `j2_capture_inbox` | `user_id` | Direct | Not purged | Purged | " |
| `j2_public_profiles` | `user_id` (PK) | Direct | Not purged | Purged | " |
| `j2_note_shares` | `user_id` | Direct | Not purged | Purged | " |
| `j2_note_connectors` | `user_id` | Direct | Not purged | Purged | " |
| `j2_note_sources` | `user_id` | Direct | Not purged | Purged | " |
| `j2_note_sync_log` | `user_id` | Direct | Not purged | Purged | " |
| `j2_note_remote_index` | `user_id` | Direct | Not purged | Purged | " |
| `j2_obsidian_devices` | `user_id` | Direct | Not purged | Purged | " |
| `j2_obsidian_staging` | `user_id` | Direct | Not purged | Purged | " |
| `j2_obsidian_manifest` | `user_id` | Direct | Not purged | Purged | " |
| `j2_obsidian_connect_epoch` | `user_id` (PK) | Direct | Not purged | Purged | " |
| `j2_trade_attachments` | `user_id` | Direct | Not purged | Purged | " |
| `j2_trade_excursions` | `user_id` | Direct | Not purged | Purged | " |
| `j2_trade_adherence` | `user_id` | Direct | Not purged | Purged | " |
| `j2_broker_users` | `user_id` (PK) | Direct | Purged (existing broker purge) | Purged (redundant-safe overlap) | " |
| `j2_broker_accounts` | `user_id` | Direct | Purged (existing) | Purged (overlap) | " |
| `j2_broker_activities` | `user_id` | Direct | Purged (existing) | Purged (overlap) | " |
| `j2_broker_sync_log` | `user_id` | Direct | Purged (existing) | Purged (overlap) | " |
| `j2_broker_dup_flags` | `user_id` | Direct | Purged (existing) | Purged (overlap) | " |
| `j2_broker_equity_snapshots` | `user_id` | Direct | **Not purged** (missed by existing broker purge) | Purged | " |
| `j2_broker_cash_flows` | `user_id` | Direct | **Not purged** | Purged | " |
| `j2_broker_opt_holdings_memo` | `user_id` | Direct | **Not purged** | Purged | " |
| `j2_broker_mirror_checks` | `user_id` | Direct | **Not purged** | Purged | " |
| `j2_broker_drift_series` | `user_id` | Direct | **Not purged** | Purged | " |
| `j2_broker_precise_times` | `user_id` | Direct | **Not purged** | Purged | " |
| `j2_broker_live_checks` | `user_id` | Direct | **Not purged** | Purged | " |
| `j2_broker_member_stale_notify` | `broker_account_id` → `j2_broker_accounts.user_id` | **Indirect** | **Not purged** | Purged (join delete) | " |
| `j2_broker_digest_dedup` | none (global, `id='fleet_digest'`) | — | N/A | **Correctly not purged** — not member data | Manual schema read |
| On-disk attachments (`attachment_root()/<user_id>/**`, both notes and trade screenshots, plus the legacy root fallback) | top-level directory name = `user_id` | Direct (per-user directory) | Not purged | Purged (`shutil.rmtree`) | Test matrix below |

External-party data: SnapTrade's own revoke is unaffected by this change — it already runs via
the existing broker purge, unchanged.

## Verification method

`tests/test_journal_two_account_purge.py` (added in this fix): builds two synthetic users
(direct `users`-table insert, matching this codebase's own existing test convention for
journal_two — e.g. `test_public_profile.py` — not the full HTTP signup flow), populates one
representative row in every table in this manifest — generated directly off the live schema via
`PRAGMA table_info`, so the test can never silently drift from `account_purge.py`'s own table
list — plus one real note through the actual `notes.create_note()` service call (so the FTS
mirror is genuinely exercised) and one real attachment file on disk under the real
per-user attachment directory. It then calls the actual `admin_delete_user_by_id` endpoint
function (not the purge module in isolation, so a wiring mistake would also be caught) and
asserts:

1. Every table in this manifest has zero rows for the deleted user.
2. The FTS mirror (`j2_notes_fts`) no longer returns the deleted user's note content.
3. The attachment directory for that user no longer exists on disk.
4. A second, untouched synthetic user's rows in every one of the same tables are byte-for-byte
   unchanged (cross-user isolation).
5. Repeating the deletion request against the same (now-nonexistent) user is safe — no
   exception, no partial state change (idempotency).

This is a discriminating rail: run against the pre-fix code, it fails on essentially every
`j2_*` table (proving the defect was real, not a documentation gap), and passes after the fix.
