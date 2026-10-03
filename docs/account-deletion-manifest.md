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

⛔ **The table below is GENERATED from the purge code and is never hand-typed.** It is
derived by `tools/account_deletion_manifest.py` (an AST read of
`api/services/journal_two/account_purge.py`: `_DIRECT_USER_TABLES`, one
`DELETE ... WHERE user_id = ?` each, plus every literal `_run("<table>", ...)` — a join delete,
or a delete keyed on the member's id through a column not named `user_id`).
Regenerate after any change to the purge:

```sh
python tools/account_deletion_manifest.py --write
python tools/account_deletion_manifest.py --check
```

`tests/test_account_deletion_manifest.py` parses this table, runs the real
`purge_user_data` and reads the tables it reports deleting, and fails BY NAME on any
difference in either direction. ⚰️ It replaced a hand-typed table that was 16 tables short at
the wave-6 close and 20 short by wave 7 (wave 7 lane J, J4).

<!-- BEGIN GENERATED: python tools/account_deletion_manifest.py --write (derived from api/services/journal_two/account_purge.py) -- never hand-edit -->

**84 tables** (81 direct by `user_id`, 1 direct by another member key, 2 indirect).

| Table | Owner key | Ownership | How the purge deletes it |
|---|---|---|---|
| `j2_option_legs` | `strategy_id` → `j2_option_strategies.user_id` | **Indirect** | join delete through `j2_option_strategies`, run before the direct deletes |
| `j2_broker_member_stale_notify` | `broker_account_id` → `j2_broker_accounts.user_id` | **Indirect** | join delete through `j2_broker_accounts`, run before the direct deletes |
| `j2_settings` | `user_id` | Direct | `DELETE FROM j2_settings WHERE user_id = ?` |
| `j2_positions` | `user_id` | Direct | `DELETE FROM j2_positions WHERE user_id = ?` |
| `j2_trades` | `user_id` | Direct | `DELETE FROM j2_trades WHERE user_id = ?` |
| `j2_day_notes` | `user_id` | Direct | `DELETE FROM j2_day_notes WHERE user_id = ?` |
| `j2_accounts` | `user_id` | Direct | `DELETE FROM j2_accounts WHERE user_id = ?` |
| `j2_option_strategies` | `user_id` | Direct | `DELETE FROM j2_option_strategies WHERE user_id = ?` |
| `j2_playbook_entries` | `user_id` | Direct | `DELETE FROM j2_playbook_entries WHERE user_id = ?` |
| `j2_coach_outputs` | `user_id` | Direct | `DELETE FROM j2_coach_outputs WHERE user_id = ?` |
| `j2_chat_messages` | `user_id` | Direct | `DELETE FROM j2_chat_messages WHERE user_id = ?` |
| `j2_onboarding_responses` | `user_id` | Direct | `DELETE FROM j2_onboarding_responses WHERE user_id = ?` |
| `j2_verdicts` | `user_id` | Direct | `DELETE FROM j2_verdicts WHERE user_id = ?` |
| `j2_trade_reviews` | `user_id` | Direct | `DELETE FROM j2_trade_reviews WHERE user_id = ?` |
| `j2_interventions` | `user_id` | Direct | `DELETE FROM j2_interventions WHERE user_id = ?` |
| `j2_profile_suggestions` | `user_id` | Direct | `DELETE FROM j2_profile_suggestions WHERE user_id = ?` |
| `j2_journal_rules` | `user_id` | Direct | `DELETE FROM j2_journal_rules WHERE user_id = ?` |
| `j2_unified_coach_state` | `user_id` | Direct | `DELETE FROM j2_unified_coach_state WHERE user_id = ?` |
| `j2_weekly_email_log` | `user_id` | Direct | `DELETE FROM j2_weekly_email_log WHERE user_id = ?` |
| `j2_notes` | `user_id` | Direct | `DELETE FROM j2_notes WHERE user_id = ?` |
| `j2_note_folders` | `user_id` | Direct | `DELETE FROM j2_note_folders WHERE user_id = ?` |
| `j2_note_embeds` | `user_id` | Direct | `DELETE FROM j2_note_embeds WHERE user_id = ?` |
| `j2_note_mentions` | `user_id` | Direct | `DELETE FROM j2_note_mentions WHERE user_id = ?` |
| `j2_note_favorites` | `user_id` | Direct | `DELETE FROM j2_note_favorites WHERE user_id = ?` |
| `j2_note_recents` | `user_id` | Direct | `DELETE FROM j2_note_recents WHERE user_id = ?` |
| `j2_note_versions` | `user_id` | Direct | `DELETE FROM j2_note_versions WHERE user_id = ?` |
| `j2_note_links` | `user_id` | Direct | `DELETE FROM j2_note_links WHERE user_id = ?` |
| `j2_note_properties` | `user_id` | Direct | `DELETE FROM j2_note_properties WHERE user_id = ?` |
| `j2_note_saved_views` | `user_id` | Direct | `DELETE FROM j2_note_saved_views WHERE user_id = ?` |
| `j2_fact_observations` | `user_id` | Direct | `DELETE FROM j2_fact_observations WHERE user_id = ?` |
| `j2_note_fact_refs` | `user_id` | Direct | `DELETE FROM j2_note_fact_refs WHERE user_id = ?` |
| `j2_thesis_evidence` | `user_id` | Direct | `DELETE FROM j2_thesis_evidence WHERE user_id = ?` |
| `j2_thesis_reviews` | `user_id` | Direct | `DELETE FROM j2_thesis_reviews WHERE user_id = ?` |
| `j2_note_documents` | `user_id` | Direct | `DELETE FROM j2_note_documents WHERE user_id = ?` |
| `j2_note_document_pages` | `user_id` | Direct | `DELETE FROM j2_note_document_pages WHERE user_id = ?` |
| `j2_note_document_ocr_pages` | `user_id` | Direct | `DELETE FROM j2_note_document_ocr_pages WHERE user_id = ?` |
| `j2_note_excerpts` | `user_id` | Direct | `DELETE FROM j2_note_excerpts WHERE user_id = ?` |
| `j2_note_excerpt_refs` | `user_id` | Direct | `DELETE FROM j2_note_excerpt_refs WHERE user_id = ?` |
| `j2_capture_inbox` | `user_id` | Direct | `DELETE FROM j2_capture_inbox WHERE user_id = ?` |
| `j2_capture_tokens` | `user_id` | Direct | `DELETE FROM j2_capture_tokens WHERE user_id = ?` |
| `j2_capture_auth_codes` | `user_id` | Direct | `DELETE FROM j2_capture_auth_codes WHERE user_id = ?` |
| `j2_public_profiles` | `user_id` | Direct | `DELETE FROM j2_public_profiles WHERE user_id = ?` |
| `j2_note_shares` | `user_id` | Direct | `DELETE FROM j2_note_shares WHERE user_id = ?` |
| `j2_note_publications` | `user_id` | Direct | `DELETE FROM j2_note_publications WHERE user_id = ?` |
| `j2_note_connectors` | `user_id` | Direct | `DELETE FROM j2_note_connectors WHERE user_id = ?` |
| `j2_note_sources` | `user_id` | Direct | `DELETE FROM j2_note_sources WHERE user_id = ?` |
| `j2_note_sync_log` | `user_id` | Direct | `DELETE FROM j2_note_sync_log WHERE user_id = ?` |
| `j2_note_remote_index` | `user_id` | Direct | `DELETE FROM j2_note_remote_index WHERE user_id = ?` |
| `j2_obsidian_devices` | `user_id` | Direct | `DELETE FROM j2_obsidian_devices WHERE user_id = ?` |
| `j2_obsidian_staging` | `user_id` | Direct | `DELETE FROM j2_obsidian_staging WHERE user_id = ?` |
| `j2_obsidian_manifest` | `user_id` | Direct | `DELETE FROM j2_obsidian_manifest WHERE user_id = ?` |
| `j2_obsidian_connect_epoch` | `user_id` | Direct | `DELETE FROM j2_obsidian_connect_epoch WHERE user_id = ?` |
| `j2_trade_attachments` | `user_id` | Direct | `DELETE FROM j2_trade_attachments WHERE user_id = ?` |
| `j2_trade_excursions` | `user_id` | Direct | `DELETE FROM j2_trade_excursions WHERE user_id = ?` |
| `j2_trade_adherence` | `user_id` | Direct | `DELETE FROM j2_trade_adherence WHERE user_id = ?` |
| `j2_trade_plan_links` | `user_id` | Direct | `DELETE FROM j2_trade_plan_links WHERE user_id = ?` |
| `j2_broker_users` | `user_id` | Direct | `DELETE FROM j2_broker_users WHERE user_id = ?` |
| `j2_broker_accounts` | `user_id` | Direct | `DELETE FROM j2_broker_accounts WHERE user_id = ?` |
| `j2_broker_equity_snapshots` | `user_id` | Direct | `DELETE FROM j2_broker_equity_snapshots WHERE user_id = ?` |
| `j2_broker_activities` | `user_id` | Direct | `DELETE FROM j2_broker_activities WHERE user_id = ?` |
| `j2_broker_sync_log` | `user_id` | Direct | `DELETE FROM j2_broker_sync_log WHERE user_id = ?` |
| `j2_broker_dup_flags` | `user_id` | Direct | `DELETE FROM j2_broker_dup_flags WHERE user_id = ?` |
| `j2_broker_cash_flows` | `user_id` | Direct | `DELETE FROM j2_broker_cash_flows WHERE user_id = ?` |
| `j2_broker_opt_holdings_memo` | `user_id` | Direct | `DELETE FROM j2_broker_opt_holdings_memo WHERE user_id = ?` |
| `j2_broker_mirror_checks` | `user_id` | Direct | `DELETE FROM j2_broker_mirror_checks WHERE user_id = ?` |
| `j2_broker_drift_series` | `user_id` | Direct | `DELETE FROM j2_broker_drift_series WHERE user_id = ?` |
| `j2_broker_precise_times` | `user_id` | Direct | `DELETE FROM j2_broker_precise_times WHERE user_id = ?` |
| `j2_broker_live_checks` | `user_id` | Direct | `DELETE FROM j2_broker_live_checks WHERE user_id = ?` |
| `j2_note_templates` | `user_id` | Direct | `DELETE FROM j2_note_templates WHERE user_id = ?` |
| `j2_task_reminder_log` | `user_id` | Direct | `DELETE FROM j2_task_reminder_log WHERE user_id = ?` |
| `j2_inbound_addresses` | `user_id` | Direct | `DELETE FROM j2_inbound_addresses WHERE user_id = ?` |
| `j2_inbound_usage` | `user_id` | Direct | `DELETE FROM j2_inbound_usage WHERE user_id = ?` |
| `j2_inbound_drops` | `user_id` | Direct | `DELETE FROM j2_inbound_drops WHERE user_id = ?` |
| `j2_note_embeddings` | `user_id` | Direct | `DELETE FROM j2_note_embeddings WHERE user_id = ?` |
| `j2_ai_change_sets` | `user_id` | Direct | `DELETE FROM j2_ai_change_sets WHERE user_id = ?` |
| `j2_ai_change_items` | `user_id` | Direct | `DELETE FROM j2_ai_change_items WHERE user_id = ?` |
| `j2_template_gallery` | `user_id` | Direct | `DELETE FROM j2_template_gallery WHERE user_id = ?` |
| `j2_template_gallery_reports` | `user_id` | Direct | `DELETE FROM j2_template_gallery_reports WHERE user_id = ?` |
| `j2_template_gallery_uses` | `user_id` | Direct | `DELETE FROM j2_template_gallery_uses WHERE user_id = ?` |
| `j2_chart_blocks` | `user_id` | Direct | `DELETE FROM j2_chart_blocks WHERE user_id = ?` |
| `j2_chart_fingerprints` | `user_id` | Direct | `DELETE FROM j2_chart_fingerprints WHERE user_id = ?` |
| `j2_entry_context` | `user_id` | Direct | `DELETE FROM j2_entry_context WHERE user_id = ?` |
| `j2_passed_setups` | `user_id` | Direct | `DELETE FROM j2_passed_setups WHERE user_id = ?` |
| `daily_usage_counters` | `subject` (the member's id) | Direct | `DELETE FROM daily_usage_counters WHERE subject = ?` |

<!-- END GENERATED -->

### Removed without a table DELETE

- The three full-text mirrors, each emptied by an `AFTER DELETE` trigger on a table the purge
  deletes: `j2_notes_fts` / `j2_notes_fts_map` (on `j2_notes`), `j2_note_document_pages_fts` /
  `_map` (on `j2_note_document_pages`), `j2_note_excerpts_fts` / `_map` (on `j2_note_excerpts`).
  All three carry a `user_id` column; so do the two wave-10 indexes, `j2_note_task_digest` (the
  task index) and `j2_note_tag_index` (the tag index), each emptied the same way by its own
  `AFTER DELETE` trigger on `j2_notes`; the rail reads the triggers from the schema and fails by
  name on any `user_id` table `ensure_schema` creates that is neither purged nor trigger-emptied.
- On-disk attachments — `attachment_root()/<user_id>/**` (notebook images and files AND trade
  screenshots, which nest under the same per-user directory), plus the legacy root fallback:
  one `shutil.rmtree` per root.
- External-party data — SnapTrade's own revoke is unaffected; it runs via the existing broker
  purge (`journal_two/broker/service.py::purge_on_account_deletion`), which this purge overlaps
  on the 5 broker tables it covers and extends to the other 9.

### Correctly NOT purged

Each is excluded in `account_purge.py`'s own comments; the rail checks that the purge does not
delete them and that the code names them.

| Table | Why it stays |
|---|---|
| `j2_broker_digest_dedup` | one global row (`id='fleet_digest'`) for the owner's own fleet-check digest — not member data |
| `j2_task_reminder_runs` | one row per ET `day` (`ran_at`, `members`, `delivered` counts) — counts only, no `user_id` |
| `account_tombstones` | the record the purge itself WRITES (wave 10, ruling R-9): the deleted member's id and the time, nothing else, so every restore of an older backup deletes them again — purging it would undo the erasure it keeps (see "Backups" below) |

### History

- 2026-09-05: the purge first shipped (`fix/account-deletion-notebook-purge`), covering the
  Journal/Compass/Notebook/connector/broker families; ownership was determined by reading the
  schema (`api/services/journal_two/db.py`) and the code that writes each table.
- Wave O: `j2_thesis_reviews`. Wave 6: `j2_note_templates` (fix round 1, I3 —
  `test_j2_note_templates_is_purged_on_account_deletion`) and `j2_task_reminder_log` (fix
  round 4, R4-4 — `test_j2_task_reminder_log_is_purged_on_account_deletion`).
- Wave 7: `j2_inbound_addresses` (lane G, G3) and `j2_inbound_usage` / `j2_inbound_drops`
  (lane G fix round 1, I-1, `3de679697`); `j2_note_embeddings` (lane H, H3, `90f6f160f`).
- Wave 7 whole-branch fix, ruling D-H10: `daily_usage_counters` (auth.db, ruling D-H5b's
  durable daily caps), keyed by `subject` — the member's id for the per-member counts. The
  shared dollar cap's row (subject `*`) is nobody's and stays; so does every other member's
  row. Rail: `test_daily_usage_counters_member_rows_are_purged_and_the_global_row_is_not`.

## Backups — no restore brings a deleted account back (wave 10, ruling R-9)

The purge above is **immediate** on the live database. The **backups** still hold the
member: `authdb_backup` keeps the newest `RETAIN` (14) auth.db snapshots — taken every 6 h
plus nightly, about 3 days — and `j2_attachments_backup` keeps up to 14 days of attachment
tarballs (never fewer than the newest 3). Rewriting snapshots on every deletion was ruled out
(plan D15); instead:

1. **The deletion writes a TOMBSTONE, as its FIRST write** (`api/services/account_tombstones.py`;
   both admin delete doors record it before the broker purge, through
   `auth._record_deletion_tombstone_or_refuse`, and `purge_user_data` records it before its first
   DELETE when called alone). ⛔ If it cannot be recorded, NOTHING is deleted: the door answers 500
   with a sentence and the account stays. If a delete fails AFTER it, the tombstone stays and a
   restore's replay finishes the intended deletion. ⚰️ It used to be written at the END of
   `purge_user_data`, so a purge that raised skipped it while the account was still deleted
   (wave 10 fix round 1; `tests/test_account_deletion_tombstone_first.py`). It is a row in
   `account_tombstones` (so every LATER snapshot carries it) and
   an object `authdb/tombstones/<user_id>.json` in the backups' own bucket (so a restore of an
   EARLIER snapshot — even after losing the volume — still learns of it). The id and the time,
   nothing else. The off-site write happens only while `AUTHDB_BACKUP_ENABLED=1` (armed on
   `web`); a tombstone written while it could not be sent stays pending in the table and the
   next backup run pushes it (`authdb_backup._flush_pending_tombstones`).
2. **Every restore replays the tombstones.** `tools/authdb_restore_drill.py` reads them (the
   bucket and the snapshot's own table), replays them on its temporary copy
   (`account_tombstones.replay_on_db`: the Journal family's rows, then the `users(id)` cascade)
   and **fails** if any deleted account would still come back. A REAL restore takes its file
   from `--write-restored PATH`, which writes the replayed copy and **refuses** unless the
   off-site tombstones were read. A restored attachment tree has the tombstoned members'
   directories removed with `account_tombstones.replay_on_attachment_tree` before it is put in
   place.
3. **Snapshots expire** by `RETAIN` (auth.db) and `J2_ATTACHMENT_BACKUP_RETAIN_DAYS` (14,
   attachments).

⚠️ Stated, not hidden: (a) a volume lost between a deletion whose off-site write failed and the
next successful backup loses that tombstone with the volume; (b) the Privacy page's "up to 7
days" sentence names the ACCOUNT DATABASE copies — attachment tarballs are kept up to 14 days
(decided 2026-09-26: the Privacy page and the 14-day setting both stay as they are);
(c) tombstones are never pruned — a member id is the least data that can honour an erasure
against a copy still held; (d) **one known exception to "snapshots expire": `authdb/archive/`.**
`tools/archive_authdb_backup.py` is a one-shot, owner-run tool (2026-07-17, `05b890ee3`, no
programmatic caller) that keeps the newest pre-pattern-purge backup as
`authdb/archive/pre_pattern_purge_<ts>.db.gz`. `authdb_backup._prune` lists only
`authdb/backup/`, so an archive is **never pruned** — and the owner decided on 2026-09-27 to
KEEP it (recorded "DECIDED 2026-09-27 KEEP" in the Notebook program's OPEN-ITEMS.md; corrected
here by wave 10 follow-up F3, fix round 1). ⛔ **CLOSED, wave 10 lane AD:** the lever was never
the KEEP decision, it was the missing restore path — `authdb_restore_drill.py --archive` now
drills the archive lineage exactly like a regular restore, with ONE difference: it lifts the
`MAX_AGE_HOURS` freshness rule (an archive object is old by design — that is the entire point
of keeping it past `authdb_backup._prune`'s window). Every other check, above all R-9's
tombstone replay, is the **same code** a regular restore uses — `tombstone_check()` →
`account_tombstones.replay_on_db()` / `.replay_on_attachment_tree()` — never a second copy of
the replay logic, so an archive restore fails closed on the identical rule: no off-site
tombstones read, no PASS, `--write-restored` writes nothing.

```sh
python tools/authdb_restore_drill.py --archive --list             # what is under authdb/archive/
python tools/authdb_restore_drill.py --archive --report out.md    # read-only, a temp dir, never C:\data
python tools/authdb_restore_drill.py --archive --write-restored PATH   # the real restore
```

Wave 10 lane 10C report, item 7 (found the gap); lane AD (built the path). Rails:
`tests/test_account_tombstones.py` (the resurrected-user rail drills a **regular** snapshot
taken BEFORE a deletion and asserts the member is gone from the restored copy) and
`tests/test_authdb_archive_restore.py` (the same rail for the **archive** lineage: seed a
member, take an archive snapshot, delete the account, `--archive --write-restored`, assert the
member's rows are gone; a control that replays an empty id set proves the member would
otherwise come back; the freshness exemption is proved scoped to `--archive` only — the
identical file drilled as a regular backup still fails on age; mutation-proved fail-closed two
ways — the replay call skipped, and the tombstone read erroring — each still refuses rather
than a silent PASS).

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
