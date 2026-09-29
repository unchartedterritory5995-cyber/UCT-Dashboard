# auth.db restore drill - PASS

- run at: 2026-09-28T18:30:44+00:00
- source: `authdb/backup/20260928T163111Z.db.gz` (104,192,034 bytes compressed)
- snapshot taken: 2026-09-28T16:31:11+00:00
- integrity_check: ok
- required tables missing: none
- newest note edit in the backup: 2026-09-28T16:15:22.290539+00:00

## Deleted accounts (R-9 tombstones, replayed on the restored copy)

- off-site tombstones read: **True** (0)
- tombstones in the snapshot's own table: 0
- deleted accounts present in the snapshot before replay: **0**
- of those, deleted BEFORE this snapshot was taken (an unfinished deletion): **0**
- replayed: 0 · still present after replay: **0**

## Attachments: PASS

- source: `j2_attachment_backups/j2-attachments-2026-09-28.tar.gz`
- files in the manifest: 337
- sampled: 25 (seeded by the tarball name, so a re-run draws the same files)
- mismatched: 0 · missing: 0
- deleted accounts with a directory in this tarball: 0 (a restore removes them: `account_tombstones.replay_on_attachment_tree`)
- freshness: 11.8 h old -- limit 96 h = 2 x the backup job's longest scheduled gap (48 h; {'day_of_week': 'mon-sat', 'hour': 2, 'minute': 45} America/New_York)
- 25 of 337 files sampled, every sha256 matches

## Row counts

| table | rows |
|---|---|
| account_tombstones | 0 |
| activity_log | 6,660 |
| admin_notes | 0 |
| admin_todos | 0 |
| audit_runs | 24,475 |
| awareness_regime_snapshots | 3,084 |
| bar_provenance | 3,254,146 |
| calendar_seen | 16 |
| daily_journals | 24 |
| daily_usage_counters | 2 |
| deletion_requests | 1 |
| email_verifications | 2 |
| engine_cost_log | 4,784 |
| engine_decisions | 2,487 |
| engine_membership_events | 1,601 |
| engine_memberships | 868 |
| engine_runs | 67 |
| faq_votes | 0 |
| feedback | 2 |
| hub_planned_trades | 0 |
| import_sessions | 0 |
| indicator_alert_fires | 0 |
| indicator_alert_rev | 0 |
| indicator_alerts | 0 |
| j2_accounts | 38 |
| j2_broker_accounts | 6 |
| j2_broker_activities | 13,022 |
| j2_broker_cash_flows | 538 |
| j2_broker_digest_dedup | 13 |
| j2_broker_drift_series | 1,655 |
| j2_broker_dup_flags | 0 |
| j2_broker_equity_snapshots | 1,764 |
| j2_broker_live_checks | 13 |
| j2_broker_member_stale_notify | 0 |
| j2_broker_mirror_checks | 13 |
| j2_broker_opt_holdings_memo | 48 |
| j2_broker_precise_times | 34 |
| j2_broker_sync_log | 4,846 |
| j2_broker_users | 8 |
| j2_capture_auth_codes | 0 |
| j2_capture_inbox | 7 |
| j2_capture_tokens | 2 |
| j2_chat_messages | 7,161 |
| j2_coach_outputs | 815 |
| j2_day_notes | 5 |
| j2_fact_observations | 1 |
| j2_inbound_addresses | 1 |
| j2_inbound_drops | 0 |
| j2_inbound_seen | 2 |
| j2_inbound_usage | 1 |
| j2_interventions | 1 |
| j2_journal_rules | 0 |
| j2_note_connectors | 2 |
| j2_note_document_ocr_pages | 43 |
| j2_note_document_pages | 163 |
| j2_note_document_pages_fts | 163 |
| j2_note_document_pages_fts_config | 1 |
| j2_note_document_pages_fts_content | 163 |
| j2_note_document_pages_fts_data | 30 |
| j2_note_document_pages_fts_docsize | 163 |
| j2_note_document_pages_fts_idx | 28 |
| j2_note_document_pages_fts_map | 163 |
| j2_note_documents | 105 |
| j2_note_embeds | 108 |
| j2_note_excerpt_refs | 1 |
| j2_note_excerpts | 1 |
| j2_note_excerpts_fts | 1 |
| j2_note_excerpts_fts_config | 1 |
| j2_note_excerpts_fts_content | 1 |
| j2_note_excerpts_fts_data | 3 |
| j2_note_excerpts_fts_docsize | 1 |
| j2_note_excerpts_fts_idx | 1 |
| j2_note_excerpts_fts_map | 1 |
| j2_note_fact_refs | 1 |
| j2_note_favorites | 1 |
| j2_note_folders | 4 |
| j2_note_links | 0 |
| j2_note_mentions | 34 |
| j2_note_properties | 1 |
| j2_note_publications | 0 |
| j2_note_recents | 765 |
| j2_note_remote_index | 718 |
| j2_note_saved_views | 8 |
| j2_note_shares | 4 |
| j2_note_sources | 2 |
| j2_note_sync_log | 1,124 |
| j2_note_tag_index | 89 |
| j2_note_task_digest | 2 |
| j2_note_templates | 1 |
| j2_note_versions | 739 |
| j2_notes | 1,584 |
| j2_notes_fts | 1,584 |
| j2_notes_fts_config | 1 |
| j2_notes_fts_content | 1,584 |
| j2_notes_fts_data | 198 |
| j2_notes_fts_docsize | 1,584 |
| j2_notes_fts_idx | 194 |
| j2_notes_fts_map | 1,584 |
| j2_obsidian_connect_epoch | 1 |
| j2_obsidian_devices | 1 |
| j2_obsidian_manifest | 708 |
| j2_obsidian_staging | 708 |
| j2_onboarding_responses | 18 |
| j2_option_legs | 6,134 |
| j2_option_strategies | 6,132 |
| j2_playbook_entries | 0 |
| j2_positions | 18 |
| j2_profile_suggestions | 0 |
| j2_public_profiles | 0 |
| j2_schema_builds | 3 |
| j2_settings | 16 |
| j2_task_reminder_log | 0 |
| j2_task_reminder_runs | 3 |
| j2_thesis_evidence | 0 |
| j2_thesis_reviews | 1 |
| j2_trade_adherence | 0 |
| j2_trade_attachments | 0 |
| j2_trade_excursions | 12,054 |
| j2_trade_reviews | 0 |
| j2_trades | 5,978 |
| j2_unified_coach_state | 24 |
| j2_verdicts | 0 |
| j2_weekly_email_log | 313 |
| journal_entries | 3 |
| journal_resources | 0 |
| journal_screenshots | 0 |
| landing_events | 727 |
| llm_route_cost_log | 4,326 |
| mrr_snapshots | 186 |
| notebook_slo_events | 219 |
| notebook_slo_state | 1 |
| page_views | 10,640 |
| password_resets | 24 |
| playbooks | 2 |
| quarantined_bars | 523,785 |
| referrals | 13 |
| screener_saved_screens | 1 |
| sessions | 119 |
| sqlite_sequence | 25 |
| subscriptions | 25 |
| support_tickets | 17 |
| theme_memberships | 2,029 |
| theme_sectors | 12 |
| themes | 112 |
| ticker_tags | 2 |
| ticket_attachments | 2 |
| ticket_messages | 51 |
| tracings_documents | 0 |
| trade_executions | 1 |
| trading_accounts | 0 |
| upb_charts | 1 |
| upb_entries | 4 |
| upb_note_links | 0 |
| upb_sections | 4 |
| user_alerts | 1,026 |
| user_backup_codes | 0 |
| user_preferences | 195 |
| user_tags | 41 |
| user_totp | 1 |
| user_voice_facts | 5 |
| users | 30 |
| voice_documents | 0 |
| voice_embeddings | 67 |
| voice_feedback | 6 |
| voice_hallucinations | 7 |
| voice_proactive_insights | 6,617 |
| voice_prompt_variants | 163 |
| voice_scratchpad | 0 |
| voice_session_summaries | 38 |
| voice_sessions | 207 |
| voice_settings | 20 |
| voice_tool_calls | 31 |
| voice_transcripts | 1,032 |
| voice_usage_monthly | 22 |
| waitlist | 47 |
| watchlist_alerts | 30 |
| watchlist_items | 4,751 |
| watchlists | 73 |
| weekly_reviews | 0 |

## After a real restore

Delete these files from DATA_DIR before the next boot, so the idempotent search-text backfills re-derive the restored rows (they otherwise keep the old text for good). Leave every other migration flag alone: those are one-shot and would re-run.

- `.notebook_migration_v7` and `.notebook_migration_v7.progress`
- `.upb_body_plain_v1` and `.upb_body_plain_v1.progress`
