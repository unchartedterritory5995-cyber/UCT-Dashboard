---
id: D-04
title: Database & Infrastructure Archaeology (dashboard)
role: Existing Database & Infrastructure Archaeologist
wave: 1
group: D
category: internal-system
scope: uct-dashboard worktree (api/, railway.json, nixpacks.toml, Procfile, runtime.txt, .github/, docs/runbooks/, docs/operations/, scripts/, tools/)
confidence: 🟢 high on code/config facts; 🟡 medium on production-behaviour claims (no Railway link, no logs)
evidence_ceiling: The Railway CLI is installed (v4.35.0) but this worktree is NOT LINKED, so no `railway status`, no service list, no `railway variables --json`. Every production-runtime statement below is a CLAIM derived from code/config, never CONFIRMED from a running pod. No logs, no health probe, no volume listing.
sources: railway.json, nixpacks.toml, Procfile, runtime.txt, requirements.txt, conftest.py, api/main.py, api/worker_main.py, api/flow_worker_main.py, api/bars_api_main.py, api/services/*, api/routers/*, docs/runbooks/postgres-migration-trigger.md, docs/runbooks/rest-backfill-arming.md, docs/runbooks/cutover-watch.md, .github/workflows/optionsflow-guard.yml, run-local.ps1, CLAUDE.md
uct_relevance: high
status: draft
date: 2026-09-02
---

# D-04 — Existing Database & Infrastructure Archaeology

**Vocabulary note.** TERMINAL-CURRENT is the surface at route `/calendar` (display-named
"UCT Terminal" since 2026-09-01). TERMINAL-NEXT is the product this program designs.
Nothing in this report is about the `/calendar` surface itself — it is about the
substrate any TERMINAL-NEXT workload would have to live on.

---

## 0. METHOD — how the inventory below was derived

**OBSERVATION.** The datastore inventory was *derived*, not typed. Three mechanical
passes, each cross-checking the others:

1. **The repo's own AST census.** `conftest.py` (repo root) already walks `api/**` with
   `ast` and produces `SHARED_DATA_LITERALS` / `SHARED_DATA_ENV_PINS` /
   `UNPINNABLE_SHARED_LITERALS`. Importing it in a throwaway subprocess printed the
   authoritative pairing of every `/data…` literal to the env var that overrides it.
   This is the repo's own answer to "what does this code write on the volume", and it
   is recomputed every test session, so it cannot go stale.
2. **A `CREATE TABLE` / `PRAGMA` / `CREATE INDEX` sweep** over every `.py` under `api/`,
   grouped by owning file (script written to scratch, not committed).
3. **A `DATA_DIR`-join sweep** for the stores that never spell a `/data/...` literal and
   are therefore *invisible to pass 1* (e.g. `bars.db`, `patterns.db`, `brain_index.db`).

**EVIDENCE.** `conftest.py:212 shared_data_root_census()`, `conftest.py:340`,
`conftest.py:405 unguarded_literal_sites()`. Measured 2026-09-02:
`len(SHARED_DATA_LITERALS) == 65`, `len(SHARED_DATA_ENV_PINS) == 69`,
`UNPINNABLE_SHARED_LITERALS == []`. **CONFIRMED** (executed, output read).

**INTERPRETATION.** Pass 1 alone under-reports, because it only sees literal `/data/x`
strings. Pass 3 found at least 14 further stores. **Any future inventory of this
system must run all three passes** — the single most load-bearing methodological fact
in this report.

**CONFIDENCE.** 🟢

**OPEN QUESTION.** The census is scoped to `api/**`. `scripts/` and `tools/` write to
the volume too (`tools/archive_authdb_backup.py`); are those covered by any guard?

---

## 1. DATASTORES

### 1.1 Headline: the seed fact "20+ SQLite DBs" is a **material undercount**

**OBSERVATION.** Counting distinct SQLite *files* the code opens (union of the three
passes, de-duplicated by filename, excluding test-only temp DBs): **≈55 distinct SQLite
database files**, of which ~50 default onto the `web` service's `/data` volume. There is
**no Postgres, no MySQL, no ORM, and no migration framework** anywhere in the stack.

**EVIDENCE.**
- 41 `.db` literals in `SHARED_DATA_LITERALS` (conftest census, above).
- ~14 more resolved only through `DATA_DIR` joins: `bars.db`
  (`api/services/bars_sqlite.py:18`), `patterns.db`
  (`api/services/pattern_engine/pattern_db.py:114`), `brain_index.db`
  (`api/services/brain_kb_service.py:34`), `ai_search_member.db`
  (`api/services/ai_search_member.py:54`), `ai_search_memory.db`
  (`api/services/ai_search_memory.py:50`), `transcript_index.db`
  (`api/services/transcript_index.py:36`), `transcript_alerts.db`
  (`api/services/transcript_keyword_alerts.py:29`), `call_recaps.db`
  (`api/services/call_recap_store.py:37`), `implied_moves.db`
  (`api/services/implied_store.py:85`), `provider_coverage.db`
  (`api/services/provider_coverage_monitor.py:127`), `oi_massive.db`
  (`api/oi_massive_snapshots.py:45`), `calendar_alerts.db`
  (`api/services/calendar_alerts.py:29`), `darkpool.db` (`api/darkpool_db.py:20`, keyed
  off `RAILWAY_VOLUME_MOUNT_PATH`), `compass_eval.db`
  (`api/services/compass_eval/store.py:13`).
- `requirements.txt` contains no `psycopg`/`asyncpg`/`sqlalchemy`/`alembic`/`yoyo`.
  **CONFIRMED** by grep.
- **286 distinct `CREATE TABLE` names** across `api/**` (sweep, pass 2).

**INTERPRETATION.** The architecture is "one SQLite file per feature", opened directly
with `sqlite3.connect` at ~200 call sites. There is no connection pool, no schema
registry, and no single place that knows what the data model is. The `/data` volume *is*
the database server.

**RELEVANCE TO UCT.** TERMINAL-NEXT cannot assume "we'll just add a table". Every new
store is a new file on a volume that is already carrying ~50, on a single-replica pod
whose scheduler owns 143 jobs (§8). The coexistence question is not "can the schema hold
it" but "can the volume and the single writer hold it".

**CONFIDENCE.** 🟢 on the count as *code intent*. 🔴 that all ~55 files actually exist on
the prod volume — several are flag-gated and may never have been created.
**EVIDENCE CEILING:** a directory listing of the prod `/data` volume would settle it;
that requires `railway ssh`, which is forbidden.

**RECOMMENDATION.** Before designing TERMINAL-NEXT storage, get an actual `ls -la /data`
+ per-file byte count from the owner (or a read-only admin endpoint), and treat
"how many of these are alive" as a first-class question.

**OPEN QUESTION.** How many of these ~55 files are non-empty in production, and what is
each one's size? That number, not the file count, is the real capacity constraint.

---

### 1.2 The two DBs that matter: `auth.db` and `bars.db`

#### `auth.db` — the crown jewel

| Field | Value |
|---|---|
| **Path** | `AUTH_DB_PATH`, default `/data/auth.db` (`api/services/auth_db.py:10`) |
| **Fallback** | if `dirname(_DB_PATH)` does not exist → `<repo>/data/auth.db` (`auth_db.py:12-14`) |
| **Owning module** | `api/services/auth_db.py` (47 `CREATE TABLE`, 62 `CREATE INDEX`) |
| **Pragmas** | `journal_mode=WAL`, `foreign_keys=ON`; **web `busy_timeout` 10 s** (a documented remaining risk) |
| **Service** | `web` only — the worker/flow-worker volumes have no `auth.db` |
| **Consumers** | 26 of 100 router files reference it directly, plus every request through `validate_session` |

**Tables it owns directly** (`auth_db.py`): `users`, `sessions`, `subscriptions`,
`email_verifications`, `password_resets`, `activity_log`, `page_views`, `landing_events`,
`feedback`, `support_tickets`, `ticket_messages`, `ticket_attachments`, `admin_notes`,
`admin_todos`, `user_tags`, `user_preferences`, `referrals`, `mrr_snapshots`, `waitlist`,
`deletion_requests`, `faq_votes`, `import_sessions`, `watchlists`, `watchlist_items`,
`watchlist_alerts`, `ticker_tags`, `trading_accounts`, `journal_entries` (Journal 1.0),
`trade_executions`, `journal_screenshots`, `journal_resources`, `daily_journals`,
`weekly_reviews`, `playbooks`, and the `voice_*` family (`voice_sessions`,
`voice_transcripts`, `voice_tool_calls`, `voice_embeddings`, `voice_documents`,
`voice_settings`, `voice_feedback`, `voice_scratchpad`, `voice_prompt_variants`,
`voice_proactive_insights`, `voice_session_summaries`, `voice_usage_monthly`,
`user_voice_facts`).

**Tables other modules add to the SAME file** — this is the important part, because it is
invisible from `auth_db.py`:

| Module | Tables it puts in `auth.db` | Evidence |
|---|---|---|
| `api/services/journal_two/db.py` | **47 `j2_*` tables** (accounts, trades, positions, notes/notebook, connectors, broker sync, coach/verdicts/interventions) | `journal_two/db.py`; `_data_dir()` at :1108 → `DATA_DIR` |
| `api/services/theme_db.py` | `themes`, `theme_memberships`, `theme_sectors` | imports `auth_db.get_connection` |
| `api/services/theme_engine/store.py` | `engine_memberships`, `engine_decisions`, `engine_membership_events`, `engine_runs`, `engine_cost_log` | imports `auth_db.get_connection` |
| `api/services/totp_service.py` | `user_totp`, `user_backup_codes` | imports `auth_db.get_connection` |
| `api/services/user_playbook/db.py` | `upb_entries`, `upb_sections`, `upb_charts`, `upb_note_links` | header: "invoked additively from `auth_db.init_db()`" |
| `api/services/calendar_seen.py` | `calendar_seen` | `CALENDAR_SEEN_DB_PATH` default `/data/auth.db` |
| `api/services/bar_provenance.py` | `bar_provenance` | `_DB_PATH = AUTH_DB_PATH` |
| `api/services/bar_quarantine.py` | `quarantined_bars` | `_DB_PATH = AUTH_DB_PATH` |
| `api/services/bars_audit.py` | `audit_runs` | `_DB_PATH = AUTH_DB_PATH` |
| `api/services/indicator_alert_service.py` | `indicator_alerts` | `_DB_PATH = AUTH_DB_PATH` (:43) |
| `api/services/alert_fired_log.py` | `indicator_alert_fires` | ":122 — This table lives in **auth.db**" |
| `api/services/alert_rev_migration.py` | `indicator_alert_rev` | same family |
| `api/services/awareness/regime_snapshots.py` | `awareness_regime_snapshots` | `_DB_PATH = AUTH_DB_PATH` |
| `api/services/narrative_cost_guard.py` | `llm_route_cost_log` | imports `auth_db.get_connection` |
| `api/services/voice_hallucination_audit.py` | `voice_hallucinations` | imports `auth_db.get_connection` |

**OBSERVATION.** `auth.db` is therefore not "the auth database". It is a **~110-table
single file** holding auth, billing, support, Journal 1.0, all of Journal 2.0, the voice
subsystem, theme membership, indicator alerts, bar provenance/quarantine and the awareness
ledger — and it sits on the universal request path.

**EVIDENCE.** As tabulated. Six modules capture `AUTH_DB_PATH` **at import time**, not per
call — stated explicitly in `conftest.py:11-18` (auth_db, awareness.regime_snapshots,
bar_provenance, bar_quarantine, bars_audit, indicator_alert_service). **CONFIRMED** by
reading each module's `_DB_PATH =` line.

**INTERPRETATION.** Everything in `auth.db` shares ONE SQLite write lock. WAL gives
lock-free reads and exactly one writer; every j2 trade write, every broker sync, every
indicator-alert fire, every `last_login` touch queues behind the same lock. This is the
mechanism behind the 2026-07-01 "524" incident class.

**RELEVANCE TO UCT.** If TERMINAL-NEXT writes per-user state, the default gravity is
"another `j2_`-style table in `auth.db`" — which adds load to the one file the postgres
runbook says is the *only* migration candidate. A TERMINAL-NEXT store should be a
separate file (or explicitly accept being part of the Postgres migration).

**CONFIDENCE.** 🟢 on schema and path. 🟡 on "this is the contention bottleneck today"
(the runbook asserts it; I have no `SQLITE_BUSY` measurement).

**RECOMMENDATION.** Treat "does TERMINAL-NEXT state go in `auth.db`?" as an explicit,
recorded architecture decision, not a default. If yes, it must be listed in the Postgres
migration scope from day one.

**OPEN QUESTION.** What is `auth.db`'s current size and row count in production? The
migration runbook's own trigger is "gzipped copy > ~500 MB"; the dev-box copy reportedly
reached ~1 GB / 20,640 users from test leakage, so the prod number is unknown to me.

---

#### `bars.db` — the big one, and the only DB with a real replication story

| Field | Value |
|---|---|
| **Path** | `os.path.join(DATA_DIR, "bars.db")` — `api/services/bars_sqlite.py:18` |
| **Tables** | `ohlcv`, `_migrations` (2 tables, 3 indexes) |
| **Pragmas** | `journal_mode=WAL`, `synchronous=NORMAL`, `temp_store=MEMORY`, `mmap_size=268435456` (256 MB), **`busy_timeout` context-aware: 600000 on worker vs low on web** |
| **Write owner** | the `worker` service prewarmer |
| **Read path** | `web` and (new) `bars-api` read it; both ingest worker freshness via a **newer-wins MERGE**, never a replace |
| **Transport** | R2 tarball snapshots + deltas (§4) |

**OBSERVATION.** `bars.db` is the only store in the system with a designed
multi-service replication protocol. `api/services/data_sync.py` uploads
`snapshots/<unix-ts>.tar.gz` + `latest.txt` from the worker and merges them into the web
pod's local file with `INSERT OR IGNORE … WHERE local has none OR snap.ts > local MAX(ts)`.
There is a connection-epoch mechanism (`bars_sqlite.py:42-87`) because `shutil.move`
atomically replaces the inode and every open handle must be invalidated.

**EVIDENCE.** `api/services/data_sync.py:1-18` (module docstring naming the layout),
`:55-56` (`_LATEST_KEY = "latest.txt"`, `_SNAPSHOT_PREFIX = "snapshots/"`),
`:107-108` (`_DELTA_PREFIX = "deltas/"`, `_DELTA_INDEX_KEY = "deltas/latest.txt"`),
`:746` (`_HOTSET_KEY = "hotset_intraday.json"`), `api/services/bars_sqlite.py:42-87`.
CLAIM that this runs in production; the mechanism is CONFIRMED in code.

**INTERPRETATION.** "Newer-wins merge, never replace" is a stated locked invariant with an
emergency escape hatch (`R2_PERIODIC_PULL_LEGACY_REPLACE`) that the code comments say
caused the 2026-05-07 universe freeze. The `_migrations` table (`bars_sqlite.py:171-193`)
is a **named-once, run-once purge ledger** — the closest thing this repo has to a
migration framework, and it exists only for this one DB.

**RELEVANCE TO UCT.** This is the *pattern to copy* if TERMINAL-NEXT needs a large,
read-mostly dataset served from more than one pod: one writer service, R2 as the bus,
newer-wins merge on the readers. It is also the only precedent for splitting a workload
off the web pod at all.

**CONFIDENCE.** 🟢 (code), 🟡 (that the rail is healthy today).

---

### 1.3 Full datastore inventory

Grouped by the service whose volume they live on. "Owner" = the module that issues the
`CREATE TABLE`s. Where a path has no env var it is a `DATA_DIR` join.

#### A. `web` service volume (`/data`)

| DB file | Env override | Owner module | Key tables | Pragmas |
|---|---|---|---|---|
| `auth.db` | `AUTH_DB_PATH` | `api/services/auth_db.py` (+15 co-tenants, §1.2) | ~110 incl. `users`, `sessions`, `j2_*`, `voice_*` | WAL, FK ON, busy 10 s |
| `bars.db` | (`DATA_DIR`) | `api/services/bars_sqlite.py` | `ohlcv`, `_migrations` | WAL, sync NORMAL, mmap 256 MB, temp MEMORY |
| `cot.db` | `COT_DB_PATH` | `api/services/cot_service.py` | `cot_records`, `cot_refresh_log`, `cot_symbols_unmapped`, `cot_narratives` | WAL, sync NORMAL, busy 5 s |
| `breadth_monitor.db` | `BREADTH_MONITOR_DB` | `api/services/breadth_monitor.py` | `breadth_snapshots` | WAL, sync NORMAL, busy 5 s |
| `breadth_intraday.db` | `BREADTH_INTRADAY_DB` | `api/services/breadth_intraday.py` | `breadth_intraday` | WAL, sync NORMAL, busy 2 s |
| `breadth_daily_ohlc.db` | `BREADTH_OHLC_DB` | `api/services/breadth_daily_ohlc.py` | `breadth_daily_ohlc` | WAL, busy 3 s |
| `breadth_sentiment_history.db` | `BREADTH_SENTIMENT_DB` | `api/services/breadth_sentiment_history.py` | `breadth_sentiment` | WAL, busy 3 s |
| `breadth_dividends.db` | `BREADTH_DIVIDENDS_DB` | `api/services/breadth_dividends.py` | `dividends` | WAL |
| `screener.db` | `SCREENER_DB_PATH` | `api/services/screener/snapshot_db.py` | `screener_rows`, `scan_hits`, `scan_coverage` | WAL, busy 5 s |
| `screener_analyst.db` | `SCREENER_ANALYST_DB_PATH` | `api/services/screener/analyst_pass.py` | `analyst_rows`, `analyst_runs` | WAL, busy 5 s |
| `screener_insider.db` | `SCREENER_INSIDER_DB_PATH` | `api/services/screener/insider_capture.py` | `cluster_latest` | WAL, busy 5 s |
| `catalysts.db` | `CATALYST_DB_PATH` | `api/services/catalyst/store.py` | `catalysts`, `catalyst_cost_log`, `catalyst_alerts_fired`, `catalyst_feedback`, `catalyst_gate_rejections`, `catalyst_learn_state`, `catalyst_learned_rules` | WAL, FK ON |
| `catalyst_metadata.db` | `CATALYST_METADATA_DB_PATH` | `api/services/catalyst/ticker_metadata.py` | yfinance sector/cap/ADV cache | — |
| `news_catalysts.db` | `NEWS_CATALYSTS_DB_PATH` | `api/services/news_catalysts/store.py` | `news_catalysts`, `news_catalyst_meta`, `news_catalyst_cost_log` | WAL |
| `tweets.db` | `TWEET_DB_PATH` | `api/services/tweet_store.py` | `tweets`, `tweet_tickers`, `twitter_accounts`, `tweet_poll_state` | WAL, FK ON |
| `modelbook.db` | `MODELBOOK_DB_PATH` | `api/services/modelbook_service.py` | `modelbook_stocks/_setups/_catalysts/_year_recaps/_setup_examples/_stock_bars/_intraday_bars/_index_drawings/_setup_example_bars` | WAL, FK ON |
| `education.db` | `EDUCATION_DB_PATH` | `api/services/education_service.py` (+ `education_search.py` FTS) | `edu_videos`, `edu_categories`, `edu_paths`, `edu_path_steps`, `edu_video_notes`, `edu_video_progress`, `edu_search` | WAL, FK ON |
| `desk.db` | `DESK_DB_PATH` | `api/services/desk_store.py` | `substack_posts`, `substack_publications`, `team_members` | WAL, FK ON |
| `desk_session_jobs.db` | `DESK_JOBS_DB_PATH` | `api/services/desk_session_jobs.py` | `desk_session_jobs` (PK `meeting_uuid`) | WAL |
| `desk_announce.db` | `DESK_ANNOUNCE_DB_PATH` | `api/services/desk_session_announce.py` | `desk_announcements` | WAL |
| `community.db` | `COMMUNITY_DB_PATH` | `api/services/community_store.py` | `posts`, `threads`, `messages`, `reactions`, `mentions`, `read_state`, `chat_read_state`, `chat_reports`, `reports`, `acks`, `poll_votes`, `muted_users`, `message_reactions`, `ticker_marks` | WAL, FK ON |
| `charts_layouts.db` | `CHARTS_LAYOUTS_DB_PATH` | `api/services/charts_layout_service.py` | `charts_layouts` | WAL |
| `user_definitions.db` | `USER_DEFINITIONS_DB_PATH` | `api/services/user_definitions.py` (+ `definition_record.py`, `user_definition_relint.py`) | `user_definitions`, `definition_shares`, `definition_listings`, `user_definition_relint_log` | WAL, busy 2 s |
| `patterns.db` | `PATTERN_DB_PATH` (else *next to* `auth.db`) | `api/services/pattern_engine/pattern_db.py` | `pattern_detections`, `pattern_stats`, `pattern_feedback`, `pattern_outcomes` | WAL, busy 5 s |
| `pattern_vision.db` | `PATTERN_VISION_DB_PATH` | `api/services/pattern_vision/store.py` | `pattern_exemplars`, `pattern_verdicts`, `pattern_feedback`, `vision_cost_log` | WAL, busy 5 s |
| `ai_search_log.db` | `AI_SEARCH_LOG_DB_PATH` | `api/services/ai_search_log.py` | `ai_search_log`, `ai_search_usage`, `ai_search_feedback`, `ai_search_personal_counter` | WAL, busy 2 s |
| `ai_search_member.db` | `AI_SEARCH_MEMBER_DB_PATH` (`DATA_DIR` join) | `api/services/ai_search_member.py` (+ `ai_search_briefings`, `ai_search_deep`) | `ais_threads`, `ais_turns`, `ais_saved`, `ais_briefings`, `ais_deep_jobs` | WAL, busy 2 s |
| `ai_search_memory.db` | `AI_SEARCH_MEMORY_DB` (`DATA_DIR` join) | `api/services/ai_search_memory.py` | `ais_memory`, `ais_dossiers` | WAL, busy 2 s |
| `brain_index.db` | `BRAIN_INDEX_DB` (`DATA_DIR` join) | `api/services/brain_kb_service.py` | `brain_chunks` (OpenAI embeddings) | WAL, busy 2 s |
| `research_ratings.db` | `RESEARCH_RATINGS_DB_PATH` | `api/services/research/ratings_db.py` | `ticker_metrics`, `metric_distributions`, `sector_distributions` | WAL, sync NORMAL |
| `signal_ledger.db` | `SIGNAL_LEDGER_DB_PATH` | `api/services/signature/ledger.py` | `signature_signals`, `signature_coverage` | WAL |
| `stock_brief.db` | `STOCK_BRIEF_DB_PATH` | stock-brief service | — | — |
| `earnings_wire.db` | `WIRE_DB_PATH` | `api/services/wire/store.py` | `wire_prints` | WAL |
| `wire_feedback.db` | `WIRE_FEEDBACK_DB_PATH` | `api/services/wire_feedback_store.py` | `wire_feedback` | WAL |
| `buzz.db` | `BUZZ_DB_PATH` | `api/services/buzz_store.py` | `mentions`, `ingest_state` | WAL |
| `discord_chart_prefs.db` | `DISCORD_CHART_PREFS_DB_PATH` | `api/services/discord_chart_prefs.py` | `prefs` | WAL |
| `single_stock_etfs.db` | `SSETF_DB_PATH` | `api/services/single_stock_etfs.py` | `etfs`, `overrides`, `quarantine`, `meta` | WAL |
| `industry_map.db` | `INDUSTRY_MAP_DB_PATH` | `api/services/industry_map.py` | `industry_map` | WAL |
| `fundamentals_tables.db` | `FUNDAMENTALS_TABLES_DB_PATH` | `api/services/fundamentals_snapshot_store.py` | `fund_snapshots` | WAL |
| `fundamentals_estimates.db` | `FUNDAMENTALS_ESTIMATES_DB_PATH` | `api/services/fundamentals_estimates_store.py` | `estimate_snapshots` | WAL |
| `calendar_dates.db` | `CALENDAR_DATES_DB_PATH` | `api/services/calendar_date_integrity.py` | `calendar_date_history` | — |
| `calendar_alerts.db` | (`DATA_DIR` join) | `api/services/calendar_alerts.py` | `calendar_alerts_fired` | WAL |
| `transcript_index.db` | `TRANSCRIPT_INDEX_DB…` (`DATA_DIR` join) | `api/services/transcript_index.py` | `transcripts` | WAL |
| `transcript_alerts.db` | `TRANSCRIPT_ALERTS_DB_PATH` (`DATA_DIR` join) | `api/services/transcript_keyword_alerts.py` | `keyword_subs`, `keyword_fired` | WAL |
| `call_recaps.db` | `CALL_RECAP_DB_PATH` (`DATA_DIR` join) | `api/services/call_recap_store.py` | `recaps`, `spend` | WAL |
| `implied_moves.db` | `IMPLIED_STORE_DB` (`DATA_DIR` join) | `api/services/implied_store.py` | `implied_snapshots`, `grade_snapshots`, `sweep_runs` | WAL |
| `provider_coverage.db` | `PROVIDER_COVERAGE_DB` (`DATA_DIR` join) | `api/services/provider_coverage_monitor.py` | `coverage_history`, `defect_state` | — |
| `alert_shadow.db` | `ALERT_SHADOW_DB_PATH` | `api/services/alert_shadow_log.py` | `alert_shadow_fires` | WAL, busy 2 s |
| `darkpool.db` | (`RAILWAY_VOLUME_MOUNT_PATH` join) | `api/darkpool_db.py` (+ `darkpool_records.py`, `darkpool_bigblock.py`) | `darkpool_trades`, `darkpool_today`, `darkpool_records`, `darkpool_bigblock_alerts` | WAL, busy 10 s |
| `compass_eval.db` | `COMPASS_EVAL_DB` (`DATA_DIR` default **`"data"`, relative**) | `api/services/compass_eval/store.py` | `eval_runs`, `eval_scores`, `eval_cost` | WAL |

#### B. `flow-worker` service volume

| DB file | Env override | Owner | Notes |
|---|---|---|---|
| `flow.db` | `FLOW_DB_PATH` | `api/flow_db.py` (`flow` table, 7 indexes) + `api/live_alerts_db.py` (`live_alerts`), `api/ticker_types.py` (`ticker_types`), `api/dealer_positioning.py` (`dealer_positioning`), `api/baselines.py` (`ticker_baselines`), `api/flow_gap_autofill.py` (`flow_fill_runs/_windows/_inserted/_archive`), `api/live_massive_router.py` (`pushed_alerts`, `worker_starts`), `api/massive_ws_worker.py` (`worker_metrics`, `q_pool_events`) | ~792 MB / ~835 k rows per `api/flow_backup.py:2-3`. **Web keeps a FROZEN pre-cutover copy** at `/data/flow.db`. |
| `flow_explain.db` | `FLOW_EXPLAIN_DB_PATH` | `api/flow_explain.py` | `flow_explanations`, `flow_explain_costs`, `flow_explain_user_requests` |
| `oi_snapshots.db` | `OI_SNAPSHOTS_DB_PATH` | `api/oi_snapshots.py` | `contract_oi_snapshots`, `oi_snapshot_runs`; WAL, busy 30 s |
| `oi_massive.db` | `OI_MASSIVE_DB_PATH` | `api/oi_massive_snapshots.py` | `oi_massive_snapshots` |
| `notable_alerts.db` | `NOTABLE_FLOW_DB_PATH` | `api/notable_flow.py` | `dedupe`, `settings` |

#### C. `worker` (bars) service volume

`bars.db` + `bars_cache/` (the write side). Per `docs/runbooks/postgres-migration-trigger.md`,
"the worker pod has a *separate* `/data` volume with `bars.db` and no `auth.db`".

#### D. `bars-api` service volume — **NEW, dated today**

See §5.2.

**CONFIDENCE (whole inventory).** 🟢 that these are the paths the code opens.
🟡 on the service-volume attribution for anything other than `bars.db`/`flow.db`
(the split is asserted in module docstrings and the postgres runbook, not measured).

---

### 1.4 Retention / purge

**OBSERVATION.** Retention is per-store and per-env-var; there is no central policy.
Measured knobs: `TWEET_RETENTION_DAYS` (7), `CATALYST_NEWS_RETENTION_HOURS` (48),
`AI_SEARCH_LOG_RETENTION_DAYS`, `ALERT_SHADOW_RETENTION_DAYS`,
`TRANSCRIPT_INDEX_RETENTION_DAYS`, `DEFINITION_RECORD_RETENTION_DAYS`,
`FLOW_RETAIN_TRADE_DAYS` + `FLOW_PRUNE_ENABLED` + `FLOW_PRUNE_MAX_DAYS_PER_RUN`,
`FLOW_TAPE_SPOOL_RETENTION_HOURS` (26), `FLOW_BACKUP_RETAIN_DAYS` (14),
`J2_ATTACHMENT_BACKUP_RETAIN_DAYS` (14), `AUTHDB_BACKUP_KEEP` (14), `SNAPSHOT_KEEP`,
`DELTA_KEEP`, `AUDIT_REPORTS_KEEP` / `_MAX_AGE_DAYS`,
`FLOW_FILL_BACKUP_KEEP` / `_MAX_AGE_DAYS` / `_MAX_GB`.

**EVIDENCE.** Grep over `api/**`; purge SQL at `api/services/tweet_store.py:152`,
`api/services/breadth_intraday.py:166`, `api/services/catalyst/news_store.py:107`,
`api/services/catalyst/store.py:688`, `api/services/definition_record.py:684`,
`api/services/provider_coverage_monitor.py:309`,
`api/services/fundamentals_estimates_store.py:101`. **CONFIRMED** in code.

**OBSERVATION (gap).** Several append-only stores have **no prune at all** —
`awareness_regime_snapshots` (CLAUDE.md itself flags "grows unbounded, ~51 rows/weekday,
no prune"), `activity_log`, `page_views`, `landing_events`, `pattern_detections`
(prod `auth.db` reportedly held 2.37 M detection rows before the split to `patterns.db` —
`api/services/pattern_engine/pattern_db.py:99`).

**INTERPRETATION.** Disk growth on the web volume is the failure mode with real history
here: `api/services/disk_watchdog.py:5-9` records a 2026-07-23 incident where 33 GB of
unpruned gap-fill backups in one directory starved the options tape spool off a 46 GB
volume for **three trading days**, undetected.

**RELEVANCE TO UCT.** Any TERMINAL-NEXT store must ship with a retention rule *and* be
visible to `disk_watchdog`'s top-consumer report. "We'll add pruning later" has already
cost this system three days of data.

**CONFIDENCE.** 🟢

---

## 2. MIGRATIONS

**OBSERVATION.** There is **no migration framework**. Schema change ships in four
distinct idioms, and they do not agree with each other:

1. **Idempotent `CREATE TABLE IF NOT EXISTS` at `init_db()`** — the dominant idiom.
   Every store module re-executes its whole `_SCHEMA` string on startup.
2. **`try: ALTER TABLE … except: pass` blocks** — `api/services/auth_db.py:527-640`
   (individual `try` blocks per column), `auth_db.py:680 _migrate_journal_v2` (a
   `(table, col, typedef)` loop at :718), `journal_two/db.py:794 _PHASE_2_ALTERS`
   (a list of `ALTER TABLE` strings replayed every boot).
3. **A named, run-once ledger** — `bars_sqlite.py:171-193`: table `_migrations(name,
   applied_at)` with a `_migrations = [(name, sql), …]` list. This is the only
   versioned mechanism, and it exists for exactly one DB. Its three entries are all
   `DELETE FROM ohlcv` purges, not schema changes.
4. **One-shot marker files in `DATA_DIR`** — `.fmp_tz_heal_v1`, `.strict_gt_heal_v2`,
   `.intraday_heal_v3_60day`, `.notebook_migration_v1`, `.notebook_migration_v2`,
   `.deep_cache_built_v4`, `.cache_nuked_v2`, `.60min_purged_v1`, `.brain_last_ts`,
   `.force_resync_done_token`, `.barspack_web_ingested_version` (grep of `"\.[a-z_0-9]+"`
   literals). A flag file on the volume *is* the migration state for these.

**EVIDENCE.** As cited. `grep -inE "alembic|yoyo|migrate" requirements.txt` → no hits.
**CONFIRMED.**

**OBSERVATION (backfill scripts).** Backfills are ad-hoc scripts, run by hand:
`api/apply_cancel_patches.py`, `api/apply_gap_fill.py`, `api/backfill_from_patches.py`,
`api/backfill_rest.py`, `api/backfill_side_heal.py`, `api/backfill_ticktest.py`, and
`scripts/{flow_db_migrate,migrate_j2_theme,backfill_adv_dec_counts,backfill_setups,
backfill_posters,backfill_video_insights,backfill_community_desk_threads,
seed_community_starters,seed_j2_yss,seed_journal_data}.py`.

**INTERPRETATION.** Schema state is not knowable from the repo — it is whatever the
accumulated `IF NOT EXISTS` + swallowed `ALTER`s produced on each pod's volume. A column
added in idiom 2 that fails for a reason *other* than "duplicate column name" fails
**silently**, forever.

**RELEVANCE TO UCT.** TERMINAL-NEXT will need schema changes. There is no safe existing
path for a change that must *alter* data (as opposed to add a nullable column). Any
non-additive change to `auth.db` today has no rollback and no applied-version record.

**CONFIDENCE.** 🟢

**RECOMMENDATION.** If TERMINAL-NEXT introduces its own store, give it the
`bars_sqlite._migrations` shape (named, once, recorded) from the first commit — it is
already in-house, already understood, and it is the only idiom here that can answer "did
this run?".

**OPEN QUESTION.** Does any `ALTER TABLE` in `auth_db.py`/`journal_two/db.py` currently
distinguish "duplicate column" from a real failure, or does every one `except: pass`?
(Spot-checks suggest broad `except`; a full audit was out of budget.)

---

## 3. VOLUME AND PATHS

**OBSERVATION.** The volume layout implied by code (`web` service, `/data`):

```
/data
├── <~50 *.db files>            (§1.3)
├── bars_cache/                 disk bar cache (2–72 h TTL tiers)
├── index_bars_cache/           INDEX_BARS_CACHE_DIR, api/index_bars.py:92
├── tape_spool/                 MASSIVE_TAPE_SPOOL — OPRA frame spool (8 GB budget)
├── j2_attachments/             J2_ATTACHMENT_ROOT, api/services/journal_two/attachment_root.py
├── journal_screenshots/        Journal 1.0 WebP uploads
├── avatars/                    AVATARS_DIR
├── team_photos/                DESK_PHOTO_DIR
├── community_uploads/          COMMUNITY_UPLOAD_DIR
├── support_attachments/        SUPPORT_ATTACHMENTS_DIR
├── voice_audio_cache/          VOICE_AUDIO_CACHE_DIR
├── desk_recaps/                DESK_RECAP_DIR
├── audits/                     AUDIT_DIR
├── ticker_meta_cache/          per-ticker JSON, 24 h TTL
├── brain/                      BRAIN_DIR — the installed Brain Pack
├── tmp/                        TMPDIR for bars-api tarball extraction
├── wire_data.json              PERSISTENT_WIRE_DATA_FILE / WIRE_DATA_FILE
├── uct20_compositions.json, theme_performance.json, watchlists.json, trades.json,
│   contract_history.json, curated_thresholds.json, dormant_tickers.json,
│   top_flow_picks.json, flow_conviction_board.json, flow_opt_agg.json,
│   liveflow_user_blocklist.json, buzz_state.json, desk_cover_backfill.json,
│   desk_description_backfill.json, ticker_search_index.json,
│   screener_earnings_dates.json
├── schwab_token.json           api/schwab_service.py:35
└── .<marker files>             §2 idiom 4
```

**EVIDENCE.** `SHARED_DATA_LITERALS` (65 entries, §0) plus `DATA_DIR`-join grep.
`api/bars_api_main.py:91` (`<DATA_DIR>/tmp`), `api/index_bars.py:92`,
`api/services/journal_two/attachment_root.py:41-46`, `api/schwab_service.py:33-37`.
**CONFIRMED** in code; the actual volume contents are NOT INSPECTED.

**OBSERVATION — the container-vs-volume trap, with a shipped precedent.**
`api/services/journal_two/attachment_root.py:1-27` documents that the J2 attachment root
default *used to be repo-relative* (`<repo>/data/j2_attachments`), which on Railway
resolves to `/app/data/...` — the **container** filesystem — so **every redeploy deleted
every note image**, and the nightly R2 backup faithfully tarred the same ephemeral tree.
Found on prod 2026-08-13.

**EVIDENCE.** That docstring (a first-hand incident record). **CONFIRMED** as a code
change; the incident itself is a CLAIM in that file.

**OBSERVATION — one remaining member of that class.**
`api/services/compass_eval/store.py:13` reads `os.environ.get("DATA_DIR", "data")` —
note the **relative** `"data"`, unlike every other store's `"/data"`. If `DATA_DIR` is
unset on a pod, `compass_eval.db` lands on the container filesystem. It is the only such
default I found.

**EVIDENCE.** grep for `environ.get("DATA_DIR", "data")` → exactly one hit.
**CONFIRMED** in code. Whether `DATA_DIR` is set on Railway is NOT DETERMINED (no
`railway variables` access).

**INTERPRETATION.** `DATA_DIR` being set on Railway is load-bearing for at least one
store and probably not audited. `RAILWAY_VOLUME_MOUNT_PATH` is a *third* spelling of the
same idea, used by `api/darkpool_db.py:19` and `api/oi_massive_snapshots.py:44`.
Three names (`DATA_DIR`, `RAILWAY_VOLUME_MOUNT_PATH`, per-store `*_DB_PATH`) for one
concept is a second-authority pattern.

**RELEVANCE TO UCT.** Whatever TERMINAL-NEXT persists must resolve through **one**
documented root helper. This system does not have one, and it has already lost user data
to that.

**CONFIDENCE.** 🟢 on the code facts, 🟡 on production impact of `compass_eval` (it is a
dev/eval store, so the blast radius is small).

**RECOMMENDATION.** Add a single `api/services/paths.py::data_root()` and make everything
call it; or at minimum add a conftest-style rail asserting no store defaults to a
relative path.

**OBSERVATION — the conftest pins concept (name only, per contract).**
`conftest.py` at repo root does two things **at import**, before any other conftest:
(1) **REDIRECT** — `SHARED_ROOT_ENV_REDIRECTS = _redirect_shared_root_env_vars()` points
all 69 derived env pins at a per-session sandbox (`SANDBOX_DATA_ROOT`), because six
modules capture `AUTH_DB_PATH` at import and a fixture's `monkeypatch.setenv` reaches
none of them; (2) **TRIPWIRE** — guarded `sqlite3.connect` / `open` / `io.open` /
`makedirs` / `mkdir` / `remove` / `unlink` / `rename` / `replace` that **record** and
raise on any path inside `SHARED_DATA_ROOTS` (derived as `['c:\data']`), failing the
whole run at `pytest_sessionfinish`. Modes: `UCT_TEST_SHARED_ROOT_GUARD` =
`enforce` (default) / `report` / `off`.

**EVIDENCE.** `conftest.py:30-33, 409-415, 447-461, 469-479, 587, 601, 724`.
**CONFIRMED** (read, and the pin map executed).

**⚠️ The guard is a *pytest-only* rail.** It arms at conftest import. A bare
`python tools/...` run, a `python -m uvicorn api.main:app` local server, or
`run-local.ps1` bypasses it entirely (§10).

---

## 4. OBJECT STORAGE (R2)

**OBSERVATION.** One S3-compatible bucket family, addressed by a single credential set
`DATA_SYNC_ENDPOINT_URL` / `DATA_SYNC_BUCKET` / `DATA_SYNC_ACCESS_KEY` /
`DATA_SYNC_SECRET_KEY` / `DATA_SYNC_REGION`, reused by several independent rails with
different key prefixes:

| Rail | Module | Key prefix | Cadence | Retention |
|---|---|---|---|---|
| bars snapshots | `api/services/data_sync.py` | `snapshots/<unix-ts>.tar.gz` + `latest.txt` | `SNAPSHOT_INTERVAL_SECONDS` (default 20 min), gated by `in_active_data_window()` = weekdays 04:00–20:00 ET | `SNAPSHOT_KEEP` |
| bars deltas | same | `deltas/<ts>.tar.gz` + `deltas/latest.txt` | incremental | `DELTA_KEEP` |
| bars hot-set | same | `hotset_intraday.json` | per cycle | n/a |
| Brain Pack | `api/services/brain_sync.py` | `brain/latest.txt` + `brain/<ts>.tar.gz` | nightly (PC-side exporter, 21:00 CT claim) | newest 5 |
| `flow.db` backup | `api/flow_backup.py` | `flow_backups/` | nightly, `FLOW_BACKUP_ENABLED` (default **0**) | `FLOW_BACKUP_RETAIN_DAYS` 14, min 3 kept |
| `auth.db` backup | `api/services/authdb_backup.py` | `authdb/backup/<YYYYMMDDTHHMMSSZ>.db.gz` | 6 h + nightly jobs, `AUTHDB_BACKUP_ENABLED` (default **0**) | `AUTHDB_BACKUP_KEEP` 14 |
| J2 attachments | `api/j2_attachments_backup.py` | tar.gz of the attachment tree | nightly, `J2_ATTACHMENT_BACKUP_ENABLED` (default **0**) | 14 d, min 3 |
| breadth OHLC | `api/services/breadth_ohlc_sync.py` | — | `BREADTH_OHLC_PULL_SECS` | — |
| Massive flat files | `api/massive_flatfiles_worker.py` | separate creds `MASSIVE_S3_ENDPOINT` / `_BUCKET` / `_ACCESS_KEY` / `_SECRET` | T+1 | — |

**EVIDENCE.** `data_sync.py:1-18, 55-56, 107-108, 176-182, 527, 746`;
`brain_sync.py:58-64`; `flow_backup.py:1-34, 61-100`; `authdb_backup.py:1-47, 96-161`;
`j2_attachments_backup.py:1-34, 85-114`. **CONFIRMED** in code; every cadence is a CLAIM.

**OBSERVATION — a real inconsistency in the boto3 checksum config.**
`flow_backup.py:85-100` and `j2_attachments_backup.py:99-114` build the client with
`botocore.config.Config(request_checksum_calculation="when_required",
response_checksum_validation="when_required")` and `region_name` default **`us-east-1`**,
with an explicit comment that modern boto3's default CRC32 integrity checksums are
**rejected by Cloudflare R2**. `data_sync.py:176-182` and `brain_sync.py:58-64` pass
**no `config=` at all** and default `region_name` to **`auto`**.

**EVIDENCE.** The four `boto3.client(` blocks, side by side. `requirements.txt:22` pins
`boto3==1.42.54` — well past the botocore ~1.36 in which those knobs landed.
**CONFIRMED** by reading all four.

**INTERPRETATION.** Either (a) the two older rails work anyway (different operations, or
R2 tolerates it for these calls), or (b) one of them is silently failing and nobody has
looked. The two files that *added* the knobs both say in prose that R2 rejects the
default. Two rails on the same bucket with opposite checksum config is a second-authority
defect regardless of which one is right.

**RELEVANCE TO UCT.** If TERMINAL-NEXT ships anything to R2, copy the `flow_backup.py`
client-construction helper, not `data_sync.py`'s — and resolve the divergence first.

**CONFIDENCE.** 🟢 that the divergence exists. 🔴 on which behaviour is correct in
production. **EVIDENCE CEILING:** a single log line from a bars-snapshot upload would
settle it; I have no log access.

**RECOMMENDATION.** Factor one `r2_client()` helper. Until then, treat "the bars snapshot
rail uploads successfully" as unverified.

**OPEN QUESTION.** Is the bars snapshot upload actually succeeding today, or has the web
pod been serving a stale `latest.txt` since the boto3 bump?

---

## 5. DEPLOYMENT

### 5.1 `railway.json` — one file, now **four** service roles

**OBSERVATION.** `railway.json` is shared by every service; the role is selected by env
var inside `startCommand`. **The contract's KNOWN FACTS list three branches; the file has
four.**

```
build.buildCommand:
  pip install -r requirements.txt && cd app && npm install
  && NODE_OPTIONS='--max-old-space-size=4096' npm run build

deploy.startCommand:
  BARS_API_ENABLED=1    -> exec python -m api.bars_api_main
  FLOW_WORKER_ENABLED=1 -> exec python -m api.flow_worker_main
  WORKER_ENABLED=1      -> exec python -m api.worker_main
  else                  -> exec uvicorn api.main:app --host 0.0.0.0 --port $PORT
                           --proxy-headers --forwarded-allow-ips='*'
                           --timeout-graceful-shutdown 5

deploy.drainingSeconds: 30
deploy.healthcheckPath: /api/health
deploy.healthcheckTimeout: 600
deploy.restartPolicyType: ALWAYS
```

**EVIDENCE.** `railway.json` verbatim. **CONFIRMED.** The contract's stated build command
also omits `NODE_OPTIONS='--max-old-space-size=4096'`, which is present.

**INTERPRETATION.** The three-part unit called out in CLAUDE.md holds: `exec` in **both**
branches (without it `sh` is PID 1 and swallows SIGTERM, so no graceful shutdown ever
runs), `--timeout-graceful-shutdown 5` (bounds the never-ending SSE streams so lifespan
shutdown is reached), and `drainingSeconds: 30`. Removing any one breaks the other two.

**Supporting config, all consistent:** `nixpacks.toml` (`NIXPACKS_PYTHON_VERSION=3.12`;
nixPkgs `python312`, `nodejs_20`, `npm`, **`ffmpeg`**; venv at `/opt/venv`),
`runtime.txt` = `python-3.12`, `Procfile` = a plain uvicorn `web:` line.
⚠️ `nixpacks.toml`'s own `[start] cmd` and the `Procfile` **both** hard-code the
web-uvicorn command with **no dispatcher and no `--timeout-graceful-shutdown`**. They are
dead weight while `railway.json` wins, but they are two extra authorities on the start
command, and either would silently start a *web* process on a worker service.

**RELEVANCE TO UCT.** TERMINAL-NEXT as a separate service is *cheap here* — it is one
more env-var branch in this dispatcher. That is the single most useful deployment fact
in this report.

**CONFIDENCE.** 🟢

**RECOMMENDATION.** If TERMINAL-NEXT gets its own pod, add a fifth branch and set its
watch paths in the Railway dashboard (never in `railway.json` — §5.3).

---

### 5.2 A **fourth** service appeared today: `bars-api`

**OBSERVATION.** `api/bars_api_main.py` carries the header *"Dedicated bars-SERVING tier
(Path B, **2026-09-02**)"* — dated the day of this research. It serves only
`/api/bars` + `/api/bars-history` from an R2-synced `bars.db`, with no warmers, no
Massive WS, no reconciliation, so that app/partner deploys can never restart chart
serving.

**EVIDENCE.** `api/bars_api_main.py:1-40`. Its stated boot sequence:
`download_snapshot` **synchronously in `main()` before uvicorn** (so it is covered by the
600 s startup-healthcheck grace and there is no live `/api/health` to starve), extract
onto `<DATA_DIR>/tmp` on the **50 GB volume** rather than the small ephemeral `/tmp`,
then `init_db()`. Two named traps it survived: `init_db()` before the pull created an
empty DB and forced a row-by-row merge; running the install in a lifespan thread starved
`/api/health` and Railway silently restart-looped it "even with 32GB/50GB".

**INTERPRETATION.** This is (a) a live example of splitting a *serving* workload off the
web pod, which is exactly the coexistence question TERMINAL-NEXT faces, and (b) evidence
that pod sizes are larger than "single small replica" folklore — the header names
32 GB RAM / 50 GB volume for this service.

**RELEVANCE TO UCT.** The strongest existing precedent for "TERMINAL-NEXT is its own
service that reads a replicated snapshot". It also proves the R2 install path works from
a cold pod.

**CONFIDENCE.** 🟡 — the code is CONFIRMED present on this branch; whether a `bars-api`
Railway service exists, is deployed, and is receiving traffic is **NOT DETERMINED**
(no `railway status`). Its own header says its watch paths are *not yet* narrowed
("once its Railway watch paths are narrowed").

**OPEN QUESTION.** Is `bars-api` live in production today, and does the web pod still
serve `/api/bars` in parallel? This changes the coexistence baseline materially.

---

### 5.3 Deploy-on-push, and what gates it

**OBSERVATION.** **Nothing in this repository gates a deploy.** There is exactly one
GitHub Actions workflow: `.github/workflows/optionsflow-guard.yml`, which runs
`npx vitest run src/pages/optionsFlow/` on pushes/PRs touching
`app/src/pages/OptionsFlow.jsx` or `app/src/pages/optionsFlow/**`. Its own header states
the scope is deliberately narrow because "a workflow that cries wolf gets ignored".
It does not deploy, block, or interact with Railway.

**EVIDENCE.** `find .github -type f` → one file. Read in full. **CONFIRMED.**
The "Deploy window guard" workflow and `tools/git-hooks/pre-push` referenced elsewhere
are **gone** — consistent with `api/flow_worker_main.py:22-24` ("tools/git-hooks/pre-push
was deleted 2026-08-24 along with the deploy freeze").

**OBSERVATION.** "Deploy on push to master" is **a CLAIM I cannot confirm from config** —
it is a Railway dashboard setting, not a repo artifact. The strongest in-repo evidence:
`api/flow_worker_main.py:3-24` states that flow-worker is GitHub-triggered on **narrow
watch paths set per-service in the Railway dashboard**, that `railway.json` must never
carry `watchPatterns` (it is shared, so an api-only list there would stop web frontend
deploys), and that "the dashboard is the only authority; this mirror had drifted".

**EVIDENCE.** `api/flow_worker_main.py:3-30`. **CLAIM** (a comment naming a mechanism),
though a well-corroborated one — it names a specific drift it already corrected.

**INTERPRETATION.** The deploy trigger, the watch paths, and therefore the blast radius of
any push live **outside the repo**, in a UI, with one in-repo mirror that has already gone
stale once. There is no CI test gate on any deploy — the full suite is deliberately not
wired to CI.

**RELEVANCE TO UCT.** TERMINAL-NEXT work will ship by pushing to master, with no automated
gate, into a system where a push touching a watched flow file **permanently gaps the OPRA
tape** until the T+1 flat file. The freeze that used to prevent mid-session pushes was
removed 2026-08-24 by owner decision; nothing mechanical replaces it.

**CONFIDENCE.** 🟢 on "no repo-side gate". 🟡 on the Railway trigger configuration.
**EVIDENCE CEILING:** the Railway dashboard service settings (watch paths, replicas,
volume sizes, branch) are the missing primary source.

**RECOMMENDATION.** Get a screenshot/export of each service's Railway settings into
`docs/terminal-research/` before any TERMINAL-NEXT deploy decision. The one in-repo mirror
has already drifted.

**OPEN QUESTION.** Are `watchPatterns` set for the `web` service at all, or does every
push rebuild it (including doc-only commits)? The Phase-Zero rule "docs push to master =
PROD DEPLOY" implies the latter.

---

### 5.4 Healthcheck — the `/api/ready` trap, CONFIRMED from a primary source

**OBSERVATION.** `healthcheckPath` is `/api/health` and **must stay there**.
`/api/ready` exists but is observability-only.

**EVIDENCE.** `api/main.py:6764-6776` (`/api/health` returns `status`, `wire_date`,
`uptime_seconds`, `thread_count`, `rss_mb`) and `api/main.py:6779-6810`, whose docstring
states: the claim that `healthcheckPath` pointed at `/api/ready` "was FALSE for over a
month"; pointing it there **was tried in production on 2026-07-26 (deploy `650865d5`) and
caused a ~3 MINUTE OUTAGE** — Railway does not keep the old pod serving while the new one
healthchecks, so a 503-until-warm probe takes the site down (`Attempt #1..#8 failed with
service unavailable`, 502 for ~3 min). "Slow-but-serving beats hard-down."
Standing guard: `tests/api/test_ready_endpoint.py::test_railway_healthcheck_must_not_gate_on_readiness`.

**⭐ The meta-lesson, quoted from the same docstring:** *"FOUR places in this repo asserted
the wiring existed (here, `api/services/readiness.py`, `api/worker_main.py`,
`api/flow_worker_main.py`). Four copies of one claim read as corroboration, so the single
config line that falsifies them went unopened — and the sentence is an active trap,
because acting on it reproduces the outage."*

**INTERPRETATION.** This is the sharpest evidence-standard artefact in the codebase and it
directly validates this program's CLAIM-vs-CONFIRMED discipline.

**RELEVANCE TO UCT.** **Railway does not do zero-downtime pod handover here.** Every
deploy is a hard cut with a ~1-minute `/api/*` blip. Any TERMINAL-NEXT design that assumes
"we can gate on warm" is wrong on this platform, and a warm-gated healthcheck is an outage,
not a safeguard.

**CONFIDENCE.** 🟢 (primary source, plus a named regression test).

---

### 5.5 Deploy-survival state restoration

**OBSERVATION.** Because the pod cannot be withheld, the system instead makes the cold
window cheap:

- **`api/services/cache_snapshot.py`** persists the in-memory `TTLCache` to the volume
  every 3 min + on shutdown and reloads it at boot. Entries are re-inserted with their
  **remaining** TTL (absolute `expires_at`), so a deploy never extends a value's life;
  entries whose deadline passed while the pod was down are dropped. What is persisted is
  **derived, not enumerated** (every JSON-round-trippable entry under `MAX_VALUE_BYTES`),
  explicitly to avoid a hand-typed roster drifting.
- Its docstring measures the problem: "~3.5 minutes to warm … during that window every
  endpoint answers in ~8.5 s". Measured on prod 2026-08-29.
- `/data/wire_data.json` re-seeds the wire cache at boot (`api/main.py` lifespan).
- **`api/flow_tape_spool.py`** replays spooled OPRA frames after a consumer restart
  (`RETENTION_HOURS` 26, `MAX_SPOOL_BYTES` 8 GB, `MIN_FREE_BYTES` 2 GB).
- **`api/flow_gap_autofill.py`** heals deploy-swap gaps from the T+1 flat file (armed).
- **`flow_rest_backfill`** would heal them same-day — `docs/runbooks/rest-backfill-arming.md`
  says it is "built, wired, **NOT ARMED**".

**EVIDENCE.** `api/services/cache_snapshot.py:1-40`; `api/flow_tape_spool.py:67-73`;
`docs/runbooks/rest-backfill-arming.md` (its own layer table). CONFIRMED in code;
"armed / not armed" states are CLAIMS from the runbook.

**RELEVANCE TO UCT.** TERMINAL-NEXT inherits a ~3.5-minute cold window per deploy unless
its state is snapshot-restorable. `cache_snapshot.py` is a reusable, correct pattern.

**CONFIDENCE.** 🟢 (code), 🟡 (arming states).

---

### 5.6 Postgres — when, and what moves

**OBSERVATION.** `docs/runbooks/postgres-migration-trigger.md` (65 lines) is a complete,
threshold-driven decision doc. Migrate when ANY is sustained:

| Signal | Trigger |
|---|---|
| `SQLITE_BUSY` rate on `auth.db` (`database is locked` on `auth_db.get_connection()` writes) | **> ~1 % of auth writes**, or any user-visible 5xx traced to a lock. *"This is the PRIMARY trigger — it is the thing SQLite can't scale past."* |
| Concurrent write-active journal users | **> ~150–200** at peak |
| Today-surface p95 at peak, after cache warm | **> 800 ms sustained** (if p95 climbs while CPU is idle → lock/threadpool wait) |
| `auth.db` backup size/duration (`authdb_backup` log line) | **> ~60 s, or gzipped > ~500 MB** |

**What migrates:** `auth.db` **and only `auth.db`**. Explicitly NOT: `bars.db`
(worker-local, read-only merge on web, no write contention to relieve), and not
`cot.db` / `breadth_monitor.db` / `catalysts.db` / `tweets.db` / `modelbook.db` etc.
(low write rate, scheduler-written, off the hot path).

**The move (sketch in the runbook):** managed Postgres (Railway plugin) → port
`auth_db.get_connection()` + the `j2_*`/auth schema to psycopg ("a driver + DSN swap, not
a rewrite", since the query surface is plain SQL) → **backfill from the latest
`authdb/backup/<ts>.db.gz` R2 snapshot — the dark backup is also the migration seed** →
multi-worker the web pod becomes possible **only after** this.

**EVIDENCE.** The runbook, read in full. **CLAIM** (it is a plan, not a measurement); no
Postgres dependency exists in `requirements.txt` — **CONFIRMED** not started.

**RELEVANCE TO UCT.** If TERMINAL-NEXT adds write-active users to `auth.db`, it moves the
150–200 concurrent-writer trigger closer. Conversely, the runbook is the ready-made
argument for giving TERMINAL-NEXT its own store.

**CONFIDENCE.** 🟢 that the doc says this; 🔴 on where the metrics currently sit
(no logs).

**OPEN QUESTION.** Has anyone measured the `SQLITE_BUSY` rate? The runbook names the
primary trigger but no instrument that reports it.

---

## 6. ENVIRONMENT VARIABLES

**OBSERVATION.** **1,053 distinct environment-variable names** are read by
`api/` + `scripts/` + `tools/` (via `os.environ.get` / `os.getenv` / `os.environ[...]`).

**EVIDENCE.** Regex census over the three trees, de-duplicated. **CONFIRMED** (executed).
A handful are test-harness names (`PYTEST_CURRENT_TEST`, `MOBILE_AUDIT_*`, `REPRO_*`,
`SSETF_E2E_*`, `TMP`/`TMPDIR`) and platform-provided (`PORT`, `RAILWAY_ENVIRONMENT`,
`RAILWAY_SERVICE_NAME`, `RAILWAY_REPLICA_ID`, `RAILWAY_DEPLOYMENT_ID`,
`RAILWAY_VOLUME_MOUNT_PATH`).

**Families by prefix** (top): `MASSIVE_*` 91 · `CATALYST_*` 76 · `FLOW_*` 63 ·
`DESK_*` 45 · `DARKPOOL_*` 43 · `DISCORD_*` 41 · `AI_SEARCH_*` 41 · `BARS_*` 35 ·
`BROKER_*` 23 · `BREADTH_*` 23 · `EARNINGS_*` 20 · `SCREENER_*` 19 · `BUZZ_*` 16 ·
`LIVEFLOW_*` 14 · `ALPHA_GOLD_*` 14 · `NEWS_*` 13 · `CONFLUENCE_*` 13 · `COMPASS_*` 13 ·
`CALL_RECAP_*` 13 · `OI_*` 12 · `COMMUNITY_*` 12.

**By purpose:**

- **Secrets / credentials (name only — no values read or reproduced):**
  `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `PERPLEXITY_API_KEY`, `MASSIVE_API_KEY`,
  `MASSIVE_SECRET_KEY`, `MASSIVE_ACCESS_KEY`, `MASSIVE_S3_ACCESS_KEY`,
  `MASSIVE_S3_SECRET`, `POLYGON_API_KEY`, `FINNHUB_API_KEY`, `FMP_API_KEY`,
  `ALPHAVANTAGE_API_KEY`, `FRED_API_KEY`, `FINVIZ_API_KEY`, `FINVIZ_TOKEN`,
  `THEFLY_API_KEY`, `UW_API_KEY`, `BULLFLOW_API_KEY`, `LOGODEV_TOKEN`,
  `DATA_SYNC_ACCESS_KEY`, `DATA_SYNC_SECRET_KEY`, `STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `SENTRY_DSN`, `PUSH_SECRET`,
  `BROKER_ENCRYPTION_KEY`, `NOTE_ENCRYPTION_KEY`, `SNAPTRADE_CLIENT_ID`,
  `SNAPTRADE_CONSUMER_KEY`, `SNAPTRADE_WEBHOOK_SECRET`, `SCHWAB_APP_KEY`,
  `SCHWAB_APP_SECRET`, `SCHWAB_TOKEN_JSON`, `ZOOM_S2S_ACCOUNT_ID`/`_CLIENT_ID`/`_CLIENT_SECRET`,
  `ZOOM_WEBHOOK_SECRET_TOKEN`, `YT_OAUTH_CLIENT_ID`/`_CLIENT_SECRET`/`_REFRESH_TOKEN`,
  `DISCORD_BOT_TOKEN`, `DROPBOX_APP_KEY`/`_APP_SECRET`, `MSGRAPH_*`,
  `REDDIT_CLIENT_ID`/`_CLIENT_SECRET`, `WEBSHARE_PROXY_USERNAME`/`_PASSWORD`,
  `CHART_RENDERER_SECRET`, `CHART_RENDER_TOKEN`, `VOICE_ACTION_SECRET`,
  plus ~20 `DISCORD_*_WEBHOOK_URL` endpoints (URL-shaped secrets).
- **Paths:** the 69 `SHARED_DATA_ENV_PINS` (§0) plus `DATA_DIR`,
  `RAILWAY_VOLUME_MOUNT_PATH`, `BRAIN_DIR`, `BRAIN_INDEX_DB`, `J2_ATTACHMENT_ROOT`,
  `INDEX_BARS_CACHE_DIR`, `TICKER_SEARCH_INDEX_PATH`, `CACHE_SNAPSHOT_PATH`,
  `SCHWAB_TOKEN_PATH`, `NHNL_STATE_PATH`, `UCT_INTEL_PATH`.
- **Feature flags (`*_ENABLED`):** the largest single class. The ones that decide whether
  a subsystem runs at all include: `WORKER_ENABLED`, `FLOW_WORKER_ENABLED`,
  `BARS_API_ENABLED`, `MASSIVE_WS_ENABLED`, `STREAM_BARS_ENABLED`,
  `FLOW_READS_PROXY_ENABLED`, `CATALYST_ENGINE_ENABLED`, `TWITTERAPI_IO_ENABLED`,
  `THEME_ENGINE_ENABLED`, `BRAIN_PACK_ENABLED`, `BRAIN_TOOLS_ENABLED`,
  `AWARENESS_ENGINE_ENABLED`, `BROKER_SYNC_ENABLED`, `NOTE_SYNC_ENABLED`,
  `DESK_DAILY_SESSION_ENABLED`, `DESK_TSDR_ANNOUNCE_ENABLED`, `COT_NARRATIVE_ENABLED`,
  `SCAN_SWEEP_ENABLED`, `SCAN_LIVE_SWEEP_ENABLED`, `RATINGS_PERCENTILE_ENABLED`,
  `PATTERN_VISION_ENABLED`, `RECONCILE_ENABLED`, `FUNDAMENTALS_MONITOR_ENABLED`,
  `PROVIDER_COVERAGE_MONITOR_ENABLED`, `DISK_WATCHDOG_ENABLED` (default **1**),
  `AUTHDB_BACKUP_ENABLED` (0), `FLOW_BACKUP_ENABLED` (0),
  `J2_ATTACHMENT_BACKUP_ENABLED` (0), `LLM_BATCH_ENABLED`,
  `COMPASS_AUTOMATION_ENABLED`, `WIRE_ENABLED`, `COMMUNITY_ENABLED`,
  `SUBSTACK_ENABLED`, `SINGLE_STOCK_ETFS_ENABLED`.
- **Tuning scalars:** caps, timeouts, cadences, cost caps, model names
  (`*_MODEL`, `*_COST_CAP_DAILY`, `*_TIMEOUT*`, `*_INTERVAL*`, `*_MAX_*`).
- **Client-exposed (`VITE_*`, baked into the JS bundle):** `VITE_CATALYST_UI_ENABLED`,
  `VITE_CHART_RENDER_TOKEN`, `VITE_COMING_SOON`, `VITE_CONFIG`,
  `VITE_DESK_BG_AUDIO_ENABLED`, `VITE_DISCORD_CHART_APP_ID`, `VITE_GRID_WARM_ENABLED`,
  `VITE_LAUNCH_DATE`, `VITE_MASSIVE_CURATED_STREAM`, `VITE_MASSIVE_STREAM`,
  `VITE_PICOVOICE_ACCESS_KEY`, `VITE_REALTIME_BARS`, `VITE_TWITTER_UI_ENABLED`,
  `VITE_WS_HOST`.

**INTERPRETATION.** A thousand names is a configuration surface no single person can hold.
The known defect shape is that *OFF-and-unset is indistinguishable from off-on-purpose*;
the repo already carries `tools/feature_flag_index.py` (AST indexer) and
`flag_ledger_audit.py` for exactly this.

**RELEVANCE TO UCT.** Every TERMINAL-NEXT flag joins a namespace of ~1,000. A
`TERMINAL_*` prefix and a ledger entry from day one are the minimum.

**CONFIDENCE.** 🟢 on the code-side census.

**EVIDENCE CEILING — the diff I could not do.** The contract asks for
`railway variables --json` key names diffed against the code list to find
**KEY-PRESENT-only** names (credentials configured for providers the code no longer
calls — the "a provider KEY on Railway is NOT evidence we use it" class). The CLI is
installed (v4.35.0) but `railway status` returns *"No linked project found."*, and
`railway link` is forbidden by this contract. **That diff is NOT INSPECTED.** It would
take one `railway variables --json | python -c "import json,sys;print(sorted(json.load(sys.stdin)))"`
run from a linked directory, values never printed.

---

## 7. BACKUPS AND RECOVERY

**OBSERVATION.** Three offsite backup rails exist. **All three default OFF.**

| What | Module | Flag (default) | Method | Retention |
|---|---|---|---|---|
| `auth.db` | `api/services/authdb_backup.py` | `AUTHDB_BACKUP_ENABLED` (**0**) | `sqlite3.Connection.backup` online API → gzip → R2 `authdb/backup/<ts>.db.gz` | newest `AUTHDB_BACKUP_KEEP` = 14 |
| `flow.db` | `api/flow_backup.py` | `FLOW_BACKUP_ENABLED` (**0**) | SQLite online `.backup()` → gzip → R2 `flow_backups/` | 14 d, min 3 |
| J2 attachments tree | `api/j2_attachments_backup.py` | `J2_ATTACHMENT_BACKUP_ENABLED` (**0**) | tar.gz of the tree → R2 | 14 d, min 3 |

**EVIDENCE.** `authdb_backup.py:43-52` (`ENABLED_ENV`, `KEY_PREFIX`, `RETAIN`);
`flow_backup.py:24-34, 55-64`; `j2_attachments_backup.py:24-34`. `api/main.py:5204-5216`
registers two auth.db jobs (`authdb_backup_6h`, `authdb_backup_nightly`).
**CONFIRMED** that the defaults are `"0"`. Whether they are flipped ON in Railway is
**NOT DETERMINED**.

**OBSERVATION — every one of the three headers says the same thing about the risk.**
`authdb_backup.py:8-12`: *"`auth.db` is the crown-jewel DB … it is web-local — it lives
only on the single web pod's `/data` volume. A volume loss would be unrecoverable without
an off-box copy. This is that copy."* `flow_backup.py:4-7`: *"flow.db lives ONLY on the
web service's Railway volume. A volume corruption or loss has NO recovery path — the live
Massive OPRA feed does NOT replay."* `j2_attachments_backup.py:4-9`: *"A volume loss =
permanent loss of every user-uploaded screenshot with NO recovery path."*

**INTERPRETATION.** Three modules, written at different times, independently identify
volume loss as an unrecoverable event and each ships its mitigation **dark**. The design
invariants are sound (never file-copy a hot WAL DB; run on a scheduler thread, never the
event loop; exception-contained; inert without R2 creds; prune to newest-N). The open
question is purely operational: are they on?

**Explicitly NOT backed up anywhere I could find:** the other ~50 SQLite files —
`cot.db`, `breadth_*.db`, `catalysts.db`, `tweets.db`, `modelbook.db`, `education.db`,
`community.db`, `charts_layouts.db`, `user_definitions.db`, `patterns.db`,
`ai_search_*.db`, `desk*.db`, … Several are re-derivable from source (COT from CFTC zips,
breadth from the collector, bars from R2); several are **not** (`community.db` member
posts, `modelbook.db` curation, `charts_layouts.db` saved layouts,
`user_definitions.db` member scans, `education.db` video catalog + progress).

**RELEVANCE TO UCT.** If TERMINAL-NEXT stores anything a member creates, it needs a backup
rail **and that rail needs to be ON**. Today the recovery posture for member-authored
content outside `auth.db` is: none.

**CONFIDENCE.** 🟢 on what exists and its defaults. 🔴 on production arming.
**EVIDENCE CEILING:** `railway variables` (key names would at least show whether the
flags are set at all) or one log line `uploaded … (<bytes>, <secs>)`.

**RECOMMENDATION.** Before TERMINAL-NEXT ships anything durable, confirm with the owner
which of the three backup flags are `=1` in Railway, and add the member-content DBs
(`community.db`, `modelbook.db`, `charts_layouts.db`, `user_definitions.db`,
`education.db`) to a backup rail.

**OPEN QUESTION.** Has any of these three backups ever produced an object in R2?
"Ships dark" plus "never verified" is indistinguishable from "no backup".

**Adjacent — disk budget.** `api/services/disk_watchdog.py` (default **ON**) samples the
volume every `DISK_WATCHDOG_CHECK_SECONDS` (1800), warns at `WARN_PCT` 75 / `CRIT_PCT` 90,
re-alerts every 6 h while still over, names the **top 6 consumers by size and growth**,
and flags any consumer that jumps `GROWTH_ALERT_GB` (5 GB) between checks. It is
read-only by design — *"deciding what is expendable belongs to the subsystem that wrote
it, not to a monitor."* It exists because the 2026-07-23 incident had two failures and
fixing the spool addressed only the first: **nothing watched the volume as a whole**.

---

## 8. RESOURCE CONSTRAINTS

**OBSERVATION — single process, and it is load-bearing.** The web pod is one uvicorn
process = one event loop + one anyio threadpool (64). CLAUDE.md states multi-worker is
impossible because live-price SSE state is in-process. The postgres runbook adds that
multi-worker "becomes possible **only after**" the `auth.db` → Postgres move.

**OBSERVATION — memory, MEASURED.** `api/main.py:6423-6441` records a production
measurement on 2026-08-29: `/api/health/memory?trim=1` on an 8-minute-old pod took
**RSS 1490.0 → 1276.6 MB, 213.4 MB released in one `malloc_trim()` call**, glibc returned
1. The comment rules out the two rival explanations *with evidence*: the caches hold
~3 MB (0.17 % of RSS) and +481 MB of growth came with only +11 % GC-tracked objects.
Conclusion recorded there: RSS growth is **glibc per-arena free-list fragmentation**
across ~64 threads — not a leak. A `malloc_trim` job now runs every
`MALLOC_TRIM_MINUTES` (default 10), and its **duration is logged, not just the megabytes**,
because "if the elapsed_ms ever climbs into the hundreds, this is the wrong shape and the
env cap is the answer". `api/main.py:3623-3624` separately notes RSS inflating "toward
~2.4 GB" with `MALLOC_ARENA_MAX` unset, and `:6436` states plainly: *"This does NOT
replace `MALLOC_ARENA_MAX`, it is the half that needs no environment change and no
redeploy."*

**EVIDENCE.** `api/main.py:3620-3650, 6423-6462, 6764-6776`. **CONFIRMED** as an in-code
record of a real probe (the numbers and the glibc return value are quoted from a run).
`MALLOC_ARENA_MAX=2` being set on Railway is a **CLAIM** — `grep MALLOC_ARENA_MAX api/`
finds only the two comments, so **no code sets it**; it is either a Railway variable or it
is not set at all. I cannot tell which.

**OBSERVATION — threads.** `/api/health` reports `thread_count` because of a 2026-06-09
thread-exhaustion incident. `THREAD_BURST_LOG_THRESHOLD` exists. A
`[mem] rss_mb=… threads=…` line is printed every 60 s (`api/main.py:3638-3647`) because
the point-in-time `/api/health` read was not enough to characterise the working set.

**OBSERVATION — the scheduler load that pins jobs to `web`.**
`api/main.py` contains **144 `add_job` call sites / 143 distinct job ids**. Families:
`authdb_backup_6h`, `authdb_backup_nightly`, `awareness_engine_scan`,
`bars_nightly_refresh`, `bars_split_repair_sweep`, 5× `breadth_*`, 9× `broker_*`,
`buzz_poll`, `cache_snapshot_save`, 3× `calendar_*`, 9× `catalyst_*`, 4× `compass_*`,
6× `cot_*`, 7× `darkpool_*`, 6× `desk_*`, `discord_index_close`(+retry), `malloc_trim`,
`mrr_snapshot`, 5× `patterns_*`, 9× `screener_*`, `session_cleanup`, 6× `tweet_poll_*`,
5× `voice_*`, 2× `watchlist_*digest`, 4× `wire_*`, and others.

**EVIDENCE.** grep of `id="…"` in `api/main.py`. **CONFIRMED** (count executed).

**INTERPRETATION.** This is the numerical form of the seed fact "jobs cannot move off
web". The postgres runbook states the architectural reason: *"The web pod's scheduled jobs
operate on `auth.db`, which is web-local. The worker pod has a separate `/data` volume
with `bars.db` and no `auth.db`. A scheduler on the worker would have nothing to act on."*
It also explicitly rejects the "evict schedulers to relieve the pod" suggestion: those
jobs are off-peak and low-frequency; the peak-load problem is the per-request write path.

**RELEVANCE TO UCT.** Adding TERMINAL-NEXT workloads to the web pod means sharing one
event loop, one 64-slot threadpool, one `auth.db` write lock, ~64 threads' worth of
allocator fragmentation, and becoming the 144th scheduler job. The two viable shapes are
(a) a new Railway service (§5.1, §5.2), or (b) work that is genuinely read-only and cached.

**OBSERVATION — the OOM history.** Memory records "NEVER run the report card / any heavy
script on the prod pod — OOM ⇒ member-visible outage (twice, 8/28)". This is a **CLAIM**;
I found no in-repo artifact recording those two OOMs. The nearest in-repo corroboration is
the RSS instrumentation added around that date and `disk_watchdog`'s stated principle
that "a watchdog that can crash the pod it watches is worse than no watchdog."

**CONFIDENCE.** 🟢 on the memory measurement and the job count. 🟡 on pod sizing
(`bars_api_main.py` says 32 GB/50 GB *for that service*; the web pod's limits are
NOT DETERMINED). 🟡 on the OOM history.

**OPEN QUESTION.** What are the web pod's actual CPU/RAM limits and volume size, and is
`MALLOC_ARENA_MAX` set? Three values that would change every capacity answer here.

---

## 9. SECURITY OF SECRETS

**OBSERVATION — no secret values are logged.** A scan for `print`/`logger.*` lines within
80 chars of `API_KEY|SECRET|TOKEN|PASSWORD`, excluding presence/masking idioms, returned
**zero hits**.

**EVIDENCE.** grep over `api/**`. **CONFIRMED** (negative result; the regex is
heuristic, so this is "no obvious leak", not a proof).

**OBSERVATION — two provider keys ARE client-side by design.**
1. `VITE_PICOVOICE_ACCESS_KEY` — read at `app/src/hooks/useWakeWord.js:52` via
   `import.meta.env`, therefore **baked into the production JS bundle** and readable by
   any visitor. It is a real Picovoice access key with a real quota.
2. `VITE_CHART_RENDER_TOKEN` — read in `app/src/pages/{BookRender,BreadthRender,BuzzRender}.jsx`
   (and siblings). `BreadthRender.jsx:7` states these are **public routes with no
   AuthGuard**, and `?token=` is checked against this value — so the shared secret that
   protects the render routes ships to every browser.

**EVIDENCE.** The four cited files. **CONFIRMED** in code.

**INTERPRETATION.** (2) is the more interesting one: a token that gates access is
distributed to everyone who loads the app. It is a speed bump, not an authorization
boundary. Whether that is acceptable depends on what the render routes expose — out of
scope here, but it should be someone's finding.

**OBSERVATION — one committed credential literal.**
`api/services/ticker_logos.py:229` contains a hard-coded logo.dev key literal as the
fallback when `LOGODEV_TOKEN` is unset. The comment at :227-228 states it is logo.dev's
*publishable* key class ("Safe to share publicly. Used with img.logo.dev."). **Value not
reproduced in this report.**

**EVIDENCE.** That file, lines 227-241. **CONFIRMED** the literal is there. That
logo.dev genuinely treats this key class as public is a **vendor claim quoted in a
comment**; I did not verify it with logo.dev.

**OBSERVATION — encryption at rest is real and well-designed.**
`api/services/crypto_box.py` wraps Fernet with **key-version prefixes** (`v1:`) so keys
can be rotated with dual-decrypt, and maintains **two isolated key families**:
`BROKER_ENCRYPTION_KEY` (SnapTrade userSecrets + TOTP secrets) and `NOTE_ENCRYPTION_KEY`
(Roam/Craft/Notion/Dropbox connector tokens), *"so a broker key rotation/compromise can
never touch note tokens and vice versa"*. Retired keys live in `<PREFIX>S_V<n>`. Decrypt
failure raises `CryptoBoxError`; callers must mark the connection 'broken', not crash.
The docstring states loss of the active key is catastrophic and it must be treated as a
permanent, backed-up Railway secret on par with a DB credential.

**EVIDENCE.** `api/services/crypto_box.py:1-40`. **CONFIRMED** in code.

**OBSERVATION — OAuth tokens on disk.** `api/schwab_service.py:33-37` writes the Schwab
token to `/data/schwab_token.json` (or `SCHWAB_TOKEN_PATH`, default `/tmp/...`) as
**plaintext JSON**, and prints the destination path at :72 (path only, not contents).
(The adjacent `api/schwab_router.py` is partner-owned; noted only for mounting, not
described further.)

**EVIDENCE.** Those lines. **CONFIRMED**.

**OBSERVATION — `.env` handling.** `.gitignore:1` ignores `.env`; `.gitignore:11` ignores
`data/`. `.env.example` lists **38 variable names with no values** — a clean template.
`AUTH_DB_PATH` appears in it, which is the right nudge for local dev, but §10 shows the
nudge is not taken by either sanctioned local-run recipe.

**EVIDENCE.** `.gitignore`, `.env.example`. **CONFIRMED**.

**OBSERVATION — the diagnostic health family was public until 2026-08-09.**
`api/main.py:6818-6825` records that `/api/health/thread-stacks` *"returned 2,841 bytes of
LIVE PYTHON STACK TRACES — absolute module paths, function names and line numbers for
every running thread — to anyone on the internet"*, alongside `/threads` (names every
background subsystem the pod runs) and `/cache` (R2 bars-snapshot sync state). Now
admin-gated, deliberately **not** via `AdminGuardMiddleware`, because widening its
`/api/admin/*` prefix tuple to swallow `/api/health/*` would put the liveness probes one
typo away from a 403 — and `healthcheckPath` is `/api/health`.

**EVIDENCE.** That comment block. **CONFIRMED** as a code record.

**RELEVANCE TO UCT.** Two patterns TERMINAL-NEXT should inherit: (a) `crypto_box`'s
key-family isolation for any new credential class; (b) the rule that a diagnostic
endpoint's default is authenticated. And one to avoid: shipping a gate token through
`VITE_*`.

**CONFIDENCE.** 🟢 on all code facts; 🟡 that the `VITE_CHART_RENDER_TOKEN` exposure is
a real risk (depends on what the render routes serve, which I did not assess).

---

## 10. LOCAL DEVELOPMENT — and the hazard that matters most

**OBSERVATION.** `run-local.ps1` starts two windows: FastAPI on **:8000** with heavy jobs
off (`WORKER_ENABLED=0`, `CATALYST_ENGINE_ENABLED=0`, `TWITTERAPI_IO_ENABLED=0`,
`BARS_PREWARM_DISABLED=1`, `TICKER_NAMES_PREWARM_DISABLED=1`, `COT_SEED_DISABLED=1`,
`ADMIN_EMAILS='dev@local.dev'`), and Vite on :5173 proxying `/api`.

**🔴 It sets neither `DATA_DIR` nor `AUTH_DB_PATH`. It explicitly *creates* `C:\data` if
missing** — `if (-not (Test-Path "C:\data")) { New-Item -ItemType Directory "C:\data" }`.

**EVIDENCE.** `run-local.ps1` in full. **CONFIRMED.**

**INTERPRETATION.** Every store defaults to `/data/...`, which on this Windows box is
`C:\data` — the owner's LIVE files. So the sanctioned local-dev script runs the whole
backend against production data. The conftest tripwire does **not** protect this: it arms
at pytest conftest import, and this is a bare uvicorn process. CLAUDE.md's own
`C:\data IS REAL` section concedes exactly this: *"writes into `C:\data` from outside
pytest … hit the live files. The guard is a *test-suite* rail only."*

**OBSERVATION — the same gap in the second documented recipe.** CLAUDE.md's mobile-audit
loop (lines ~655-663) starts `python -m uvicorn api.main:app --port 8077` with the same
five job-suppression vars and, likewise, **no `DATA_DIR` and no `AUTH_DB_PATH`**. That is
the port-8077 stale-backend hazard: a long-lived local backend on 8077 serving from — and
writing to — `C:\data`.

**EVIDENCE.** CLAUDE.md:655-663; `run-local.ps1`. **CONFIRMED** (both recipes read in
full).

**OBSERVATION — a claim that does not check out.**
`api/services/journal_two/attachment_root.py:23-26` says: *"local runs should set
`DATA_DIR` (**the sandbox runbook already does**), exactly as they must for auth.db."*
I could find **no such runbook**: `docs/runbooks/` has 11 files
(`alert-replay-gate`, `ast-conformance-gate`, `broker-canary-arming`, `buzz-activation`,
`chart-parity-gate`, `cutover-watch`, `definition-record`, `liveflow-unstick`,
`options-flow-cloudflare-cache`, `postgres-migration-trigger`, `rest-backfill-arming`)
and none is a sandbox runbook; `grep -rn "DATA_DIR *=" docs/*.md docs/runbooks/*.md
docs/operations/*.md` returns nothing.

**EVIDENCE.** `ls docs/runbooks/`, the grep. **CONFIRMED negative.** This is a comment
naming a mechanism — a claim about a run — that I cannot corroborate.

**RELEVANCE TO UCT.** Terminal-Next research and build work will run local backends. Under
the current scripts, **that means running against the owner's live data**, including
`auth.db` (users, subscriptions, journals) and `screener.db` — the exact pair that have
already been damaged this way (`C:\data\auth.db` at ~1 GB / 20,640 users from test
leakage; one daemon thread writing ticker `A` into `C:\data\screener.db` and making the
member-facing screener label 3,583 month-old rows "today", `e86ad6d5`).

**CONFIDENCE.** 🟢 (both scripts read in full; the missing runbook verified by grep).

**RECOMMENDATION — the single highest-value infrastructure fix this report found.**
Add `$env:DATA_DIR` and `$env:AUTH_DB_PATH` (pointing at a sandbox directory) to
`run-local.ps1` and to the CLAUDE.md :8077 recipe, and write the sandbox runbook
`attachment_root.py` already cites. It is a two-line change that removes a live-data
hazard from every local run in this program.

**OPEN QUESTION.** Is there an unversioned local `.env` on this box that sets `DATA_DIR`
and quietly makes the above moot? (`.env` is gitignored; I did not read it, and reading it
would risk secrets in context.)

---

## 11. SUMMARY — the six facts a TERMINAL-NEXT architecture must respect

1. **~55 SQLite files on one volume, no Postgres, no migration framework.** The seed fact
   "20+" is an undercount by more than 2×. `auth.db` alone is ~110 tables contributed by
   16 modules and carries one write lock on the universal request path.
2. **The web pod is one process, one event loop, one 64-slot threadpool, and 143
   scheduler jobs.** Jobs cannot move to the bars worker because `auth.db` is web-local —
   stated architecturally in the Postgres runbook, not merely observed.
3. **Railway does not hand over pods gracefully.** A warm-gated healthcheck is an
   *outage* (proven 2026-07-26, ~3 min). Every deploy is a hard cut; the mitigations are
   `cache_snapshot`, `wire_data.json` re-seed, tape-spool replay and gap autofill.
4. **Nothing in the repo gates a deploy.** One narrow GitHub workflow, zero deploy
   gating, watch paths living only in the Railway dashboard, and the market-hours freeze
   removed 2026-08-24.
5. **Every offsite backup ships dark.** `auth.db`, `flow.db` and the J2 attachment tree
   each default OFF, and ~50 other DBs — including all member-authored content outside
   `auth.db` — have no backup rail at all.
6. **There is a live precedent for splitting a service off web** (`bars_api_main.py`,
   dated 2026-09-02, plus the `flow-worker` cutover). `railway.json`'s dispatcher makes a
   fifth service a one-line change. This is the cheapest coexistence path for
   TERMINAL-NEXT.

---

## GAPS — what the budget did not reach

- **Per-DB router/consumer mapping.** Q1 asks which routers read and write each store.
  I mapped owning modules and did a coarse consumer count for 14 stores
  (`auth_db` → 26 router files, `bars_sqlite` → 12, `tweet_store` → 10,
  `breadth_monitor` → 8, `cot_service` → 6, `community_store` → 4, `desk_store` → 4,
  `education_service` → 4). A full read/write matrix across 100 routers × ~55 DBs was not
  affordable. ⛔ `user_definitions → 52` in that same count is almost certainly substring
  noise — do not reuse it.
- **Column-level schemas.** I captured table names, index counts and pragmas, not key
  columns, for all but `auth.db` / `bars.db` / `flow.db`. 286 tables was beyond budget.
- **Which `ALTER TABLE` blocks swallow real errors** vs only "duplicate column".
- **`docs/operations/`** (`gate-5-shadow-mode-runbook.md`, `phase-7-launch-checklist.md`)
  was listed but not read.
- **8 of 11 runbooks** read by title only (`alert-replay-gate`, `ast-conformance-gate`,
  `broker-canary-arming`, `buzz-activation`, `chart-parity-gate`, `definition-record`,
  `liveflow-unstick`, `options-flow-cloudflare-cache`). `postgres-migration-trigger.md`
  was read in full; `cutover-watch.md` and `rest-backfill-arming.md` in part.
- **`scripts/` and `tools/`** were included in the env-var census but not individually
  reviewed (27 scripts, ~40 tools).
- **The flow-worker DB set** is attributed from module docstrings + the cutover plan, not
  measured.
- **`bars_cache/` disk-cache mechanics** (TTL tiers, purge) were noted but not audited.

## NOT INSPECTED — out of reach, and why

- **The Railway control plane.** `railway --version` → 4.35.0, but `railway status` →
  *"No linked project found. Run railway link to connect to a project"*. This contract
  forbids `railway link`, so: no service list, no replica count, no per-service watch
  paths, no volume sizes, no CPU/RAM limits, no `railway variables --json` (hence no
  KEY-PRESENT-only diff — the one contract question I could not even partially answer),
  no `railway logs`.
- **The production `/data` volume.** No listing, no file sizes, no proof any of the ~55
  DBs exist. `railway ssh` is forbidden.
- **Production runtime.** No `/api/health` call (the preamble permits one only where a
  contract allows it; D-04 does not), so no live `rss_mb`, `thread_count` or
  `uptime_seconds`. Every RSS/thread number here is quoted from an in-code record of a
  past probe.
- **The local `.env`** — deliberately unread (gitignored; reading it risks secrets in
  context).
- **`C:\data`** — never touched, listed, or opened.
- **Port 8077** — never probed (preamble hazard).
- **The test suite** — never run (this contract does not authorise it). `conftest.py` was
  imported in an isolated subprocess for its census only; that import creates temp
  directories and monkeypatches the subprocess's own `sqlite3`/`open`, and touches
  nothing else.
- **Partner-owned files** (`OptionsFlow.jsx`, `schwab_router.py`, `live_massive_router.py`,
  `massive_ws_worker.py`, `massive_processor.py`) — read only far enough to record that
  they open `FLOW_DB_PATH` / `flow.db` and which tables they create. Deliberately not
  described further.
- **Git history** — no `git log` / `show` / `blame` / `diff` run; this contract does not
  name them.
