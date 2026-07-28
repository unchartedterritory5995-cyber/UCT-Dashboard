# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

## Project Overview

**UCT Dashboard** is a live bento-box trading dashboard for Uncharted Territory. It is a full-stack app:
- **Frontend:** React + Vite SPA with React Router (NOT Next.js — ignore all "use client" suggestions)
- **Backend:** FastAPI (Python) — serves the React build and all `/api/*` data endpoints
- **Deployment:** Railway (single service) at `https://uctintelligence.com` (Cloudflare DNS)
- **Domain:** `uctintelligence.com` — Cloudflare registrar + DNS, Railway custom domain
- **Email:** Resend (verified domain), sends from `UCT Intelligence <noreply@uctintelligence.com>`
- **Payments:** Stripe (sandbox + live), webhook at `/api/webhooks/stripe`
- **Auth:** Custom SQLite-based auth with sessions, email verification, password reset

The **Morning Wire** is one tab within this dashboard. Its engine (`morning_wire_engine.py`) lives in `C:\Users\Patrick\morning-wire\` locally and is mirrored as a git submodule at `external/morning-wire`.

## Git Submodules (sister repos)

Both sibling repos are available as submodules under `external/` for Claude Code visibility:

| Path | Repo | Description |
|------|------|-------------|
| `external/morning-wire` | unchartedterritory5995-cyber/morning-wire | Morning wire engine, runs locally on Windows |
| `external/uct-intelligence` | unchartedterritory5995-cyber/uct-intelligence | Python/SQLite trading engine, knowledge base |

**Path gotcha:** `api/services/engine.py` resolves morning-wire as `../../../morning-wire` (three levels up = outside the repo, finds the local `C:\Users\Patrick\morning-wire\`). On Railway, data flows via `/api/push` — the direct import is a local-dev fallback only. The submodule path (`external/morning-wire`) is NOT used by the backend at runtime.

**Hardcoded local paths in engine.py:** Lines 1508 and 1540 reference `C:\Users\Patrick\uct-intelligence` — local fallbacks that fail silently on Railway (primary path is wire_data from push).

## Nav Tabs (left sidebar)

Dashboard · Morning Wire · UCT 20 · Breadth (tabs: Monitor | Heatmap | COT Data | Data Charts | Analogues) · Theme Tracker · Calendar · Traders · Screener · Options Flow · Post Market · Model Book · Journal · Watchlists · Support
Settings + Admin (admin only) pinned to bottom of sidebar.

## UI Icons — `UIcon` (NO emoji)

**`app/src/components/ui/UIcon.jsx` is the single source of truth for all UI
iconography.** `<UIcon name="..." size={18} />` renders an inline SVG from a
~65-glyph registry. **Do NOT use generic/system emoji as decorative icons** —
reach for a `UIcon` name (or add a new glyph to the registry).

- **Gold-embossed by default:** every icon renders a toned-down metallic gold
  gradient + slow shimmer (reduced-motion-gated) + soft glow. Pass `gold={false}`
  to force `currentColor` on a specific surface (rare).
- **`TileCard` has an `icon` prop** (a UIcon name) — use it for tile/section
  headers; it keeps `title` a plain string so `aria-label` stays correct. Every
  TileCard section + main page-title across the app carries an icon.
- **SVG `<text>` caveat:** a `<UIcon>` (an `<svg>`) cannot nest inside an SVG
  `<text>` element (e.g. RadarView/Treemap axis labels) — keep a `★`/`◆` text
  marker there instead.
- Sweep history + gotchas: user memory `feedback_no_generic_emoji`.

## Journal 2.0 — parallel rebuild (beta)

A full side-by-side rebuild of the Journal tab lives at `/journal` → "Journal 2.0 beta" (last sub-tab). **Additive only** — the existing Journal's code, data, and UI are unchanged. The two Journals share no code, no components, and no database tables.

- **Source:** `app/src/pages/journal-2-0/`, `api/routers/journal_two.py`, `api/services/journal_two/`
- **Tables (all `j2_` prefix, migration from `auth_db.init_db()`):**
  - `j2_settings` — legacy pre-accounts global settings (fallback path)
  - `j2_accounts` — multi-account model (per-account sizing/setups/goals/fees)
  - `j2_positions`, `j2_trades` — open + closed equity trades
  - `j2_day_notes` — prep/mid-day/recap reflection + attachments + rules checklist
  - `j2_notes` + `j2_note_folders` — **Notebook** (Substack-style long-form notes, TipTap WYSIWYG, folders + tags, optional ticker, hero image). Replaced Playbook 2026-05-26 via one-shot migration (gated by `.notebook_migration_v1` flag in `DATA_DIR`).
  - `j2_playbook_entries` — **deprecated** (kept as backup; manual `DROP TABLE` after ~30d of green prod). Old Playbook tab + UI + routes removed.
  - `j2_option_strategies`, `j2_option_legs` — Pattern C multi-leg options
- **Phases shipped:** 1 (Calendar) · 2 (Accounts) · 3 (Analytics 14 charts + Edge Scorecard) · 4 (Goals + Report) · 5 (Fees, Daily Notes, ~~Playbook~~ → **Notebook**, Options multi-leg)
- **Specs:** `docs/superpowers/specs/` (newer specs; e.g. `2026-04-19-options-multi-leg-design.md`) + `docs/plans/journal-2.0-spec.md` (original)
- **Architecture:** `docs/journal-2.0-architecture.md`
- **Cherry-picking reference:** `docs/feature-blending-guide.md`

### Journal 2.0 — Options (Phase 5 Step 3)
- **Pattern C schema:** separate `j2_option_strategies` (one row) + `j2_option_legs` (N rows, immutable after create). 18 strategy types (long/short call/put, verticals, straddle/strangle, calendar/diagonal, iron condor/butterfly, call/put butterfly, custom).
- **Calc rules** (mirrored in `api/services/journal_two/options.py` Python AND `app/src/pages/journal-2-0/lib/optionCalcs.js` — keep in sync):
  - `net_entry = Σ (sideSign × qty × entry_price × 100)` — positive = debit, negative = credit
  - `pnl_dollar = net_exit − net_entry − fees − exit_fees` (NET of fees; pnl_percent stored as fraction, not percent)
  - `max_risk`: long = net_entry; credit spread = width×100×qty + net_entry; iron condor/butterfly = wider_wing×100×min_qty + net_entry; naked short = None
  - `closed_at` date-only inputs anchor at **ET noon** (not UTC midnight) so calendar bucketing lands on the user-typed day regardless of DST
  - Past expirations rejected at create (server + client)
- **Analytics:** options get their own `options` section (byAssetType, byStrategyType, creditVsDebit, DTE-vs-R scatter) — separate from equity aggregates, not unioned into equity curve.
- **Calendar:** closed strategies union into day `pnlDollar`/`tradeCount`; open strategies with leg expiration in window get `expiringCount` badge; `DayDetailPage` renders closed + expiring strategies in separate sections + auto-fills a recap summary button.
- **Live options pricing + Greeks + chain data = TODO (future critical work).** Greeks, IV rank, live option quotes, and option-chain integration are out of v1 scope.

Open the last tab to try it. All existing Journal tabs behave identically to before.

### Journal 2.0 — Compass Coaching Layer (Phases A–G, shipped 2026-05-08 → 2026-05-12)

J2 is now a full coaching product: Journal + Notebook + AI Coach. **10 distinct coaching surfaces** powered by Anthropic Sonnet 4.6 with server-side hallucination audit + sample-size confidence + regime awareness.

- **Source:** `api/services/journal_two/coach*.py` (coach, coach_chat, coach_chat_tools, coach_prompts, coach_validation, coach_data_assembler), `api/services/journal_two/{pre_trade_verdict,trade_review,interventions,profile_suggestions,overview}.py`
- **Frontend:** `app/src/pages/journal-2-0/components/{CompassChat,CompassOverview,VoiceInputButton,TradeDrawer}.jsx`
- **Tables (extend `j2_` family):** `j2_chat_messages`, `j2_onboarding_responses`, `j2_verdicts`, `j2_trade_reviews`, `j2_interventions`, `j2_profile_suggestions` + columns added to `j2_accounts`: `trader_profile`, `onboarded`, `onboarding_mode`, `onboarding_session_id`, `muted_setups`, `paper_only_days`

**The 10 surfaces:**
1. **Weekly Review** — Sunday auto-generated; user 👍/👎 trains profile
2. **EOD Recap** — daily 4:30 PM ET via APScheduler; this-week-focus persisted
3. **Compass Chat** — conversational coach (28+ tools, preview-confirm for action tools, elevated-warning subtype for discipline mutations, streaming + sliding-window summarization, validate_chat_output audit)
4. **Compass Onboarding** — adaptive 10-category intake interview (Section 8 prompt directive)
5. **Pre-Trade Verdict** — 🧭 button on AddPositionModal; two-stage pipeline (hard checks → LLM) → GO/HOLD/SKIP with factors
6. **Per-Trade Post-Mortem** — 🧭 button on TradeDrawer; idempotent 3-5 sentence prose review with data citation
7. **Real-Time Intervention** — 4 tilt rules (rapid_fire, daily_loss_approach, loss_streak, cooling_off_active); banner on AddPositionModal + CompassTab; cooldowns per rule
8. **Active Feedback Trimming** — 👎 auto-creates `j2_profile_suggestions`; Compass refines `trader_profile` via `update_trader_profile` tool with preview-confirm
9. **Voice → Compass Bridge v1** — browser-native SpeechRecognition mic + opt-in `speechSynthesis` TTS; zero backend; localStorage prefs
10. **Compass Overview** — capstone card at top of Compass tab; 3-col (Profile · This Week · Today) + footer pills (recent reviews); null on fresh accounts

**P5 polish (2026-05-12 → 2026-05-13):**
- **P5-M** — 🧭 indicator on Trade Log rows whose `j2_trades.id` appears in `j2_trade_reviews`. Inline in Symbol cell, SWR-polled, no new column. Files: `app/src/pages/journal-2-0/{hooks/useReviewedTradeIds.js, components/TradesTable.jsx, tabs/TradeJournalTab.jsx}`.
- **P5-N** — urgent voice variant for verdict refusals. SKIP → `"Hold up. Compass says SKIP."` at speed 1.1; HOLD → `"Heads up."` at default speed; GO unchanged. File: `app/src/pages/journal-2-0/components/PreTradeVerdictCard.jsx`.
- **P5-O** — weekly Compass email digest, Sundays 8 AM ET. Per-account batch via `j2_accounts.compass_enabled`. Idempotent via `j2_weekly_email_log`. Service: `api/services/journal_two/coach_email_digest.py`; scheduler id `compass_weekly_email_digest` in `api/main.py`.
- **Pattern Engine bridge** — 3 read tools (`find_patterns_on_ticker`, `scan_active_patterns`, `list_pattern_types`) make the 50-detector engine reachable from Compass in BOTH voice mode (registered in `voice_tool_impls.py` + `_compass_tool_union()` allowlist in `voice_agents.py`) AND text chat (`TOOLS` dict in `coach_chat_tools.py`). Read-only: queries the `pattern_detections` table populated by the background `_run_patterns_universe_scan` job. Always call `_ensure_pattern_detectors_loaded()` before pattern_id lookups — registry is empty until `api.routers.patterns` is imported.

**Critical:** All coaching writes go to J2 ONLY. Journal 1.0 must remain untouched by coach + voice (voice tools migrated in commit `b4ee2aa`/`b8d7709`/`3a32eab`). Watch `_J2_SCHEMA` + `_PHASE_2_ALTERS` patterns in `db.py`.

**Test counts at shipping:** Backend `journal_two/` 482 passing · Frontend vitest 227 passing across 31 files. Plus session-level: pattern bridge 15 cases · email digest 9 cases · pattern_engine suite 1011 cases · TradesTable 7 cases.

**In-flight:** Tight Compass ↔ Voice Assistant unification ("one brain, shared memory") is being built in a parallel Claude session — see `project_compass_va_unification_inflight.md` in user memory before refactoring `coach_chat.py`, `voice.py`, or shared trader-memory architecture.

### Voice Dictation Everywhere (2026-05-13)

Whisper-backed push-to-talk dictation + Compass voice conversation are paired on every long-form text field across Journal 2.0. Two reusable components do the heavy lifting; surfaces just drop them in next to a textarea.

- **Backend:** `POST /api/voice/transcribe` (`api/routers/voice.py`) — additive endpoint. Multipart audio in, `{text, seconds_billed}` out. Thin wrapper around existing `transcribe_audio()` (OpenAI Whisper). New `mode_d` cap (1 hr/month default, `MODE_D_DEFAULT_CAP_SECONDS`) tracks usage via `voice_usage.record_mode_d_seconds`. `voice_usage_monthly` gained a `mode_d_seconds` column (auth_db migration list).
- **`VoiceInputButton`** (`app/src/pages/journal-2-0/components/VoiceInputButton.jsx`): same prop API (`onTranscript`, `disabled`). MediaRecorder → POST primary, browser Web Speech fallback if MediaRecorder unavailable OR backend 5xx. Same visual UX (🎤 / 🛑, "Listening…" / "Transcribing…").
- **`CompassAssistButton`** (`app/src/components/voice/CompassAssistButton.jsx`): 🧭 button that opens a full Realtime conversation with Compass, pre-loaded with a surface-specific `pageHint`. Reuses existing `useRealtimeSession` + `setVoicePageHint` infra — no new backend. Returns null when no `VoiceProvider` is mounted.
- **Surfaces wired:** `CompassChat` (already had both); `DayReflection` (4 sections, date threaded into hint); `TradeDrawer` (🎙️ Talk about this trade — hint includes ticker/side/entry/exit/P&L/setup); `AddPositionModal` (Notes); ~~`PlaybookEntryModal`~~ (replaced by Notebook 2026-05-26; voice integration intentionally not carried over); `CompassReview` (Weekly Review — 🎙️ Discuss).
- **Page hints**: every CompassAssistButton passes a rich `pageHint` describing the surface + record context. `setVoicePageHint` is called on click so the Realtime session-token mint includes it. Compass's existing P4-B mechanism turns the hint into a "=== CURRENT PAGE ===" block in its system prompt.
- **Cleanup mode (2026-05-15):** `cleanup_transcript()` in `voice_openai.py` — gpt-4o-mini pass that strips fillers, fixes ticker mishears ("in video"→NVDA), adds punctuation. Best-effort: returns original text on ANY error so dictation is never lost. `/api/voice/transcribe` takes optional `cleanup` form param; `VoiceInputButton` sends `cleanup=true` by default (overridable via `cleanup={false}` prop).
- **Settings (2026-05-15):** "Ways to talk to Compass" section in the Compass TileCard (`Settings.jsx`) — read-only list of all 6 voice access paths (dictate, assist/talk, orb, push-to-talk hotkey, wake word, read-aloud).
- **First-run hint (2026-05-15):** one-time discoverability popover in `VoiceInputButton`. Single localStorage flag `voice.dictation.hintSeen` gates it across ALL surfaces (not per-surface). Dismissed by ✕ button OR first voice use. `VoiceInputButton.test.jsx` `beforeEach` defaults the flag to seen so behavioral tests are unaffected; 4 hint tests opt out explicitly.
- **Tests**: backend 8 tests in `tests/test_voice_router.py` (auth, paid-gate, happy path, empty audio, usage tracking, cap exceeded, cleanup applied, cleanup skipped by default) + 3 in `test_voice_openai.py` (cleanup happy/empty/error-passthrough). Frontend 4 in `CompassAssistButton.test.jsx` + 6 in `VoiceInputButton.test.jsx` (Whisper path, fallback, cleanup param). All 51 backend voice + 547 frontend tests pass.

## Journal 2.0 — Broker Sync (SnapTrade) — LIVE in production (2026-06-16→18)

Connect a brokerage once → J2 auto-imports every trade, open position, balance, and
option, no manual entry. **Read-only, premium-gated, multi-user, idempotent.** Provider =
**SnapTrade** (30+ US brokers). Live on production credentials; mirrors the broker account.
Full session detail: user memory `project_broker_sync_2026_06_15.md`.

### Architecture
- All under `api/services/journal_two/broker/` + router `api/routers/broker_sync.py`
  (`/api/j2/broker/*`). Runs **web-side** (auth.db is web-local).
- SnapTrade isolated in `snaptrade_client.py` (sync SDK via `asyncio.to_thread` +
  global token-bucket limiter + structured errors `SnapNotConfigured`/`SnapAuthError`/
  `SnapUserSecretInvalid`/`SnapRateLimited`/`SnapTransient`). userSecrets encrypted at
  rest via `api/services/crypto_box.py` (Fernet, key-id prefixed).
- Pipeline (`sync.py` → `reconstruct.py`/`option_reconstruct.py` over the raw
  `j2_broker_activities` ledger): fetch activities (full backfill or incremental from
  cursor) → store deduped → FIFO reconstruct (`fifo.reconstruct_trades(allow_shorts=True)`)
  → **holdings-as-truth** reconcile (`balances.reconcile_positions` for equities,
  `option_reconstruct.reconcile_option_holdings` for options) → write balances + daily
  equity snapshot.

### Key files
- BE: `broker/{snaptrade_client,snaptrade_adapter,service,sync,reconstruct,option_reconstruct,balances,balance_resolver,connections,activities_store,dedup,rate_limit}.py`, `routers/broker_sync.py`, `services/crypto_box.py`
- FE: `pages/journal-2-0/components/{BrokerConnectionsCard (Settings),PositionsTable,BrokerEquityCurve,BrokerReviewNudge,BrokerSyncStatus}.jsx` + `tabs/{OpenPositionsTab,TradeJournalTab}.jsx` (options merged into both tables)
- Diagnostics (manual, gitignored state): `tools/snaptrade_{smoke_test,shape_audit,j2_e2e}.py`

### Env vars (Railway web pod; production)
`SNAPTRADE_CLIENT_ID` (`UNCHARTED-TERRITORY-REAQG`) · `SNAPTRADE_CONSUMER_KEY` ·
`BROKER_ENCRYPTION_KEY` (Fernet — PERMANENT, backed up) · `SNAPTRADE_WEBHOOK_SECRET` ·
`BROKER_SYNC_ENABLED=1` (scheduler: 20-min incremental + 2:30am ET nightly reconcile).
Inert with these unset. `railway variables --set` STAGES → must `railway redeploy
--service web --yes` to apply.

### Schema (j2_broker_* tables in db.py)
`j2_broker_users` (encrypted secret), `j2_broker_accounts` (1:1 → a `j2_accounts` row,
`balance_source='broker'`), `j2_broker_activities` (raw ledger), `j2_broker_sync_log`,
`j2_broker_dup_flags`, `j2_broker_equity_snapshots` (daily net-liq → equity curve).
Plus alters: `source`/`external_id`/`entry_estimated` (+ `broker_price` = current
per-share mark, refreshed each `reconcile_positions` so equity rows show a real
price/P&L after hours when the live feed is empty) on positions; `source`/`external_id`
on trades; `source`/`external_id`/`broker_current_value` on option_strategies; broker
balance cols on accounts.

### UI surfaces (all in Open Positions / Trade Journal)
Connect/disconnect in **Settings → Brokerage Connections** (`BrokerConnectionsCard`).
Open Positions tab leads with: sync-freshness line, real **equity curve** (from net-liq
snapshots), "needs a setup" nudge; **options render as rows in the same table as shares**
(`CRWV Oct 16 $110C` · `LONG CALL` · Current/P&L from broker mark). Trade Journal: closed
options merged into the closed-trades table likewise. Compass already coaches imported
trades (`imported:true` flag + `coach_prompts.py` rule).

### LOCKED invariants — do NOT regress
- **MERGE AS A UNIT:** `from api.routers import broker_sync` + `include_router` + scheduler
  block in `main.py` must all be present together. **After EVERY master merge, verify
  `grep -c broker_sync api/main.py` ≥ 7 BEFORE pushing** — a concurrent/partner commit
  silently dropped this once → router unmounted → `POST /connect` hit the SPA catch-all →
  **405 Method Not Allowed** (the tell: `GET /connect` → 200 HTML).
- **Mirror the broker EXACTLY** — never filter/curate/suppress imported trades or positions
  (`feedback_broker_mirror_fidelity`; the "dust filter" was rejected).
- **Holdings-as-truth** for open positions AND open options (broker's current holdings win;
  quantity corrected to broker truth when activity reconstruction diverges).
- **Idempotent** reconstruction (stable `external_id` fingerprint → re-sync = 0 dupes);
  per-account `asyncio.Lock`.
- **SnapTrade option units quirk:** holding `price` is PER-SHARE but `average_purchase_price`
  is PER-CONTRACT (premium×100) — normalized to per-share in `_holding_contract`.
- **`connect` auto-recovers** from a secret invalid-at-SnapTrade (key swap / rotation):
  re-registers under the current key + retries (no manual Disconnect).
- `j2_positions.stop_price`/`entry_date` are NOT NULL → broker imports store placeholders;
  the UI renders "—"/"est." (don't show a fake stop / today's date).
- **SINGLE-PROCESS assumptions (correct today, first thing to break on scale-out).**
  The web pod is ONE uvicorn process, and these are all per-PROCESS state — they
  are correctness guards, not caches, so a second instance silently doubles the
  thing each one bounds: `sync._locks` (per-account `asyncio.Lock` — the
  idempotency guard against concurrent syncs of one account) · `recent_orders._last_poll`
  (SnapTrade's contractual ≤1 poll/5min/account) · `manual_refresh._last_trigger`
  (BILLED refresh calls) · `notifications._failure_pinged` + `_spike_pinged` (alert
  dedup) · `partner_health._cache`. Durable equivalents exist where a repeat is
  genuinely costly (`j2_broker_member_stale_notify` for member email,
  `j2_broker_digest_dedup` for the owner digest) — extend that pattern rather than
  adding new module dicts if the web pod ever goes multi-instance.

## Journal 2.0 — Table & Analytics polish (2026-06-24)

UX pass over the three big J2 surfaces (memory `project_journal_tables_polish_2026_06_24`).

- **Collapsible Analytics** — `tabs/AnalyticsTab.jsx` is now an accordion of
  `components/CollapsibleSection.jsx` (reusable: inline-SVG chevron — NO emoji,
  per-section open/closed persisted in `localStorage` key
  `uct.j2.analytics.section.<id>`, children UNMOUNTED while collapsed so the
  ECharts don't mount). Defaults: **Edge Score + Closed-Trade Equity open;
  Performance / Distribution / Attribution / Options Breakdown collapsed.** The
  broker "Account Balance" panel stays always-visible. Section components dropped
  their own `<section>`+`<h3 sectionHeader>` — CollapsibleSection supplies the header.
- **Sortable table headers** — both `components/TradesTable.jsx` (closed trades)
  and `components/PositionsTable.jsx` (open positions) have click-to-sort headers
  (gold ▲/▼ caret + `aria-sort`; first click numeric/date→desc, text→asc, second
  click toggles; blanks always sink last; stable tiebreak). TradesTable default =
  entryDate desc; PositionsTable default = symbol asc; the Actions column isn't
  sortable. PositionsTable's `sortKeyFor()` mirrors Row's display logic (live-price
  P&L/risk/heat, broker no-real-stop blanking, option-row N/A). Shared CSS
  `.thBtn`/`.sortCaret`/`.thBtnActive` is duplicated in both `.module.css`.
- **Inline setup tagging** — the Setup cell on EQUITY closed-trade rows is an
  inline `<select>` of `settings.setups`; saves via `PATCH /api/j2/trades/{id}`
  with an OPTIMISTIC SWR write (reconciled from the server response, rolls back via
  `refresh()` on error) + invalidates `/api/j2/analytics` so attribution recomputes.
  **Option rows stay read-only** (their id is a strategy id, not a `j2_trades` row →
  PATCH would 404); an off-list existing setup is preserved as an option.
  `hooks/useJ2Trades.js` now also returns `mutate` for the optimistic write.

## Compass Brain Bridge (mentor initiative) — dark, flag-gated (2026-07-02)

Bridges the uct-intelligence brain (8,500+-entry KB, 48 setup templates, sizing/analog
engine) to Railway as a nightly **Brain Pack** and exposes it to BOTH Compass surfaces
(voice + text chat) through one shared facade, plus the runnable **report-card exam**
that grades it all. Everything shipped DARK — all flags default OFF.
Plan: `docs/superpowers/plans/2026-07-02-compass-brain-bridge.md`.

### Brain Pack — layout + R2 keys
- Tarball built nightly on the PC from `C:\Users\Patrick\uct-intelligence` by
  `scripts/brain_pack_export.py` (that repo): engine package code + a consistent
  SQLite-backup copy of its KB database + manifest.
- **R2 keys (same bucket + `DATA_SYNC_*` env names as the bars rail):**
  `brain/latest.txt` (text ts) + `brain/<ts>.tar.gz`; exporter prunes to the
  newest 5 packs.
- Installed layout on the web pod (default `<DATA_DIR>/brain`, i.e. `/data/brain`):
  `uct_intelligence/*.py` + `data/uct_intelligence.db` + `PACK_MANIFEST.json`
  (`{ts, kb_rows, template_rows, db_bytes}`). This preserves the engine's hardcoded
  `<package-parent>/data/uct_intelligence.db` resolution, so the previously-dead
  `api/routers/intelligence.py` lights up with just `UCT_INTEL_PATH=/data/brain` —
  zero engine changes, no submodule init on Railway.
- **LOCKED invariant — two-repo contract:** the pack layout
  (`uct_intelligence/` + `data/uct_intelligence.db` + `PACK_MANIFEST.json`) is a
  contract between uct-intelligence (`scripts/brain_pack_export.py`) and
  uct-dashboard (`api/services/brain_sync.py`). **Change both sides together or
  not at all.**

### Modules
- `api/services/brain_sync.py` — pulls `brain/latest.txt`, verifies (path-traversal
  guard + required members + `PRAGMA integrity_check`), atomically installs at
  `brain_dir()` (env `BRAIN_DIR` override), marker `<DATA_DIR>/.brain_last_ts`,
  `on_install(fn)` callbacks, `start_background_sync()` = boot pull + 6h refresh
  daemon thread. New engine *code* needs a process restart; the *DB* re-reads per
  connection.
- `api/services/brain_service.py` — shared facade over the engine
  (`lookup_playbook`/`setup_winrate`/`find_historical_analogs`/`size_a_trade`).
  Single point both Compass surfaces call so voice and text can never diverge.
  Never raises: returns `{"ok": False, "error": "brain not available"}` when the
  pack isn't installed. Sizing validates stop-below-entry and hard-caps account
  risk at 2%; blank regime fills from the dashboard's own classifier.
- `api/services/brain_kb_service.py` — semantic index over the KB for
  `ask_the_brain` (v1 retrieval-only: returns cited passages; the calling model
  synthesizes). OpenAI `text-embedding-3-small`, own SQLite at
  `<DATA_DIR>/brain_index.db` (env `BRAIN_INDEX_DB`), in-memory numpy matrix
  cache, incremental reindex by content hash. `main.py` wires
  `brain_sync.on_install(lambda: brain_kb_service.reindex())` so each pack
  install reindexes.

### Tools (5 brain + 3 parity, all behind `BRAIN_TOOLS_ENABLED=1`)
- **5 brain tools in BOTH registries** — voice (`voice_tool()` in
  `voice_tool_impls.py`) AND text chat (`TOOLS` dict via `_BRAIN_TOOLS` in
  `coach_chat_tools.py`): `ask_the_brain` · `lookup_playbook` · `setup_winrate` ·
  `find_historical_analogs` · `size_a_trade`.
- **3 chat parity tools** (chat-only additions; voice already had them):
  `get_quote` · `get_regime` · `get_breadth`, delegated to the voice impls via
  `voice_tools.dispatch` so there is one implementation.
- **Known-by-design parity gap:** golden-set questions **R1-06 (earnings date)
  and R1-07 (top movers)** need `get_earnings_intel`/`get_earnings_this_week`/
  `get_movers`, which exist voice-side only — text chat fails those two report-card
  questions until those tools are added to chat parity.

### Flags / env (Railway web pod; all default OFF)
- `BRAIN_PACK_ENABLED=1` — boot pull + 6h refresh in `main.py` lifespan (also
  auto-sets `UCT_INTEL_PATH` to `brain_dir()` when unset).
- `UCT_INTEL_PATH=/data/brain` — points `api/routers/intelligence.py` (+ the
  brain facade) at the installed pack.
- `BRAIN_TOOLS_ENABLED=1` — exposes the 5+3 tools on both surfaces.
- `COMPASS_MENTOR_MODE` (`0`/`1`/`admin`) — the two-lane mentor persona
  (`MENTOR_TWO_LANE` in `coach_prompts.py`, re-exported by
  `voice_prompts/compass.py`) **now also reaches text chat**
  (`coach_chat._mentor_mode_active`) with identical semantics: `1` = everyone,
  `admin` = admin users only, else off.

### PC-side exporter + schedule
- `C:\Users\Patrick\uct-intelligence\scripts\brain_pack_export.py` —
  `--build-only <out.tar.gz>` (no network) or `--upload` (build + push to R2 +
  prune). Uses the same `DATA_SYNC_*` env names as the dashboard.
- Nightly schedule: Windows Task Scheduler job **"UCT Brain Pack Export"
  weekdays 21:00 CT** running `--upload` (registered per the activation runbook,
  Task 15 of the plan; mirrors the "UCT Wire Critic" registration pattern).

### Report card (`api/services/compass_eval/` + `scripts/run_report_card.py`)
- 50-question golden set (`golden_set.json`) across 5 rungs with per-rung pass
  bars (`RUNG_BARS`); runner replays questions through
  `coach_chat.handle_user_turn` on a seeded sandbox DB, reads fired tools from
  `j2_chat_messages.tool_calls`, applies mechanical checks (`checks.py`: tool
  gate + 11 auto-fail safety tokens) + a `claude-haiku-4-5` judge, stores scores
  in a SQLite trend store.
- Usage: `python scripts/run_report_card.py --db %TEMP%\rc.db [--rungs 1,2]
  [--questions R1-01-quote-nvda] [--offline]` (needs `ANTHROPIC_API_KEY` unless
  `--offline`; defaults `BRAIN_TOOLS_ENABLED=1` + `COMPASS_MENTOR_MODE=1` for
  the run).
- **Deploy-gate rule: exit 1 (any safety break, or any rung below its bar) =
  do NOT ship that Compass change.**
- **First baseline (2026-07-02, v2 post harness-fix): 12/50.** Rungs 1-2 pass
  ~6/10 each (facts + grounded craft work); Rungs 3-5 (the opinionated verdict
  tiers) fail — the model **hedges**: it skips the sizing/verdict tools and won't
  commit to a decisive regime-first GO/HOLD/SKIP + entry/stop/size. That is the
  Phase-2 "make the 6-step chain unskippable" work, and this baseline is the
  number every future change is measured against. (Two harness bugs were fixed to
  reach a trustworthy score: the `price_without_tool` check false-positived on
  percent fractions, and the judge graded live numbers against its own memory
  instead of the fired tool results.)

### grade_ticker — the unskippable verdict (Phase 2 · dark, flag-gated · 2026-07-02)
The Phase-2 answer to the hedging above. `api/services/grade_ticker.py` is a pure
orchestrator that composes the already-shipped tools into ONE decisive, tool-sourced
verdict: `get_regime` (the gate) → `get_quote` → `find_patterns_on_ticker`
(`detections[].levels{entry,stop,target_primary}` + confidence → grade) →
`lookup_playbook` (win-rate/mistakes) → `brain_service.size_a_trade` (regime-scaled,
2%-capped). It returns a typed `{verdict: GO|HOLD|SKIP, regime, setup, grade, entry,
stop, size_pct, account_risk_pct, first_target, basis, hard_flags, sources}` — never
null, never "it depends", never raises (`{ok: False, reason}` when the regime gate
can't run).
- **Decisiveness is STRUCTURAL, not prompted.** Deterministic hard-gates force the
  verdict: `no_setup`/`regime_red`/`grade_below_b`/`risk_over_cap`/`size_skip` → SKIP;
  `extended`/ORANGE/(YELLOW+B) → HOLD; else GO. The model narrates but can't hedge
  (verdict is computed) or fabricate (every number is tool-sourced). `size_a_trade`'s
  own `recommendation="SKIP"` (regime×grade table = do-not-size) is honored as `size_skip`.
- **Registered in BOTH surfaces** behind `BRAIN_TOOLS_ENABLED` — voice (`voice_tool()` +
  `voice_agents` union/core) and chat (`_BRAIN_TOOLS` in `coach_chat_tools.py`).
- **Made unskippable by `§11 Verdict protocol`** appended to `MENTOR_TWO_LANE`
  (`coach_prompts.py`, re-exported to voice) — gated by `COMPASS_MENTOR_MODE`: any
  "call this trade / grade X / should I buy X" question MUST route through `grade_ticker`,
  regime-first. Rungs 1–2 fact/craft questions never trigger it.
- **The report-card golden set credits it:** `grade_ticker` was added to every Rung-3+
  tool-gate OR-group it covers (one call satisfies regime+quote+playbook+sizing+verdict).
- **DEPLOY GATE:** re-run the report card (`--rungs 3,4,5`) with the flags on — Rungs 3–5
  must climb off the 0/10·0/7·0/13 baseline before `COMPASS_MENTOR_MODE` advances past
  `admin`. Merged dark: the tool is live under `BRAIN_TOOLS_ENABLED` but the ENFORCED
  verdict behavior is admin-only until the exam clears.
  Spec: `docs/superpowers/specs/2026-07-02-compass-grade-ticker-verdict-design.md`;
  plan: `docs/superpowers/plans/2026-07-02-compass-grade-ticker.md`.

### Rung-4/5 mentor — multi-name + portfolio verdicts (Phase 2 cont. · dark · 2026-07-05)
`grade_ticker` graded ONE name; Rungs 4-5 (grade-my-watchlist / heat / can-I-add)
still hedged. Three structural artifacts close it (spec
`docs/superpowers/specs/2026-07-05-compass-rung4-5-mentor-design.md`, plan
`…/plans/2026-07-05-compass-rung4-5-mentor.md`), reshaped by a 4-lens adversarial
end-shape analysis. All behind `BRAIN_TOOLS_ENABLED`, both surfaces.
- **`api/services/portfolio_heat.py`** — structural STATE read, **NO GO-path**. Two
  metrics NEVER blended: risk-heat `Σ(entry−stop)·shares/capital` vs the **10%
  Desjardins aggregate cap** (read from brain via `brain_service.aggregate_heat_cap_pct()`,
  fail-soft 10), notional exposure vs the regime ceiling. **SAFETY-CRITICAL:
  detects broker placeholder stops (`stop==entry`) → excludes them from the
  confident heat number + surfaces them** (counting them 0-risk under-reports heat
  → would green-light an over-cap add). Wraps `voice_position_sizing`'s
  aggregator (which computes risk-heat $, verified) + adds per-position at-risk +
  by-sector 40% concentration flags. NO separate `portfolio_stress` tool.
- **`api/services/grade_watchlist.py`** — funnel (cheap filter → `grade_ticker` on
  survivors) + compute-once market ctx + **MANDATORY list-level synthesis**: 0-GO
  "sit on your hands" on a RED/hostile regime, same-sector correlation-collapse,
  behavioral note. Edge-annotated per name; failed names returned INLINE
  (`failed:true`), never dropped/fabricated. `source ∈ watchlist|flagged|positions|
  explicit|scan` via `watchlist_source.resolve` (states which set it graded).
- **`api/services/personal_edge.py`** — the Rung-4 MOAT (the USER's per-setup
  expectancy, distinct from firm `setup_winrate`): `get_aggregates`-by-setup
  (`avg_r`/`total_r`) normalized to template keys via `resolve_setup_name`. **Edge
  = expectancy/R, not W-L. SOFT**: hard-mute ONLY at n≥25 AND negative expectancy;
  thin sample annotated with uncertainty, never dropped; cold-start → firm
  win-rate. Share store with `awareness_preferences` (avoid split-brain) — follow-up.
- **Add-verdict = persona COMPOSITION (not a tool):** `§11b` in `MENTOR_TWO_LANE`
  routes list→grade_watchlist, heat/add→portfolio_heat, and gates the add so GO is
  the terminal branch (tilt/average-down/widen-stop/RED → REFUSE; placeholder →
  confirm-first; over 2%/10% → SKIP). `validate_trade` already enforces the sizing caps.
- **Golden set** credits both on Rung-4/5 gates (grade_watchlist +9, portfolio_heat +18).
- **SCOPED OUT:** T3 agentic premarket-prep + theme research (Phase 3), conditional
  "if QQQ loses 590" stress, pure-refusal traps (persona, never a grade tool).
- ⚠️ **REMAINING before flag-flip:** `source='scan'` wiring (plan Task 8), **report-card
  HARDENING** (Task 11 — mechanical checks that edge+heat were actually applied, a
  RED-tape 0-GO fixture, a placeholder-stop-no-GO fixture; without it a shallow grid
  can game the score into a WORSE mentor — the biggest risk), then re-run the report
  card (Task 13) — Rungs 4-5 must climb HONESTLY before `COMPASS_MENTOR_MODE` past `admin`.

## Awareness Engine — Milestone 1 (dark, flag-gated · 2026-07-02)

Compass now *watches the market and speaks up first* — Milestone 1 of the
Awareness Engine (mentor-vision §5.4). A background scan cycle produces
proactive insights that the **existing** delivery surfaces (session-start
speak, chat-thread mirror, `/api/voice/insights`, email/Discord away-delivery)
consume unchanged. Everything is DARK behind two flags.
Plan: `docs/superpowers/plans/2026-07-02-awareness-engine-m1.md`.

### What it watches (3 rules, pure functions in `api/services/awareness/rules.py`)
- **R1/R2 stop-watch** — a position at/through its stop (`stop_hit`, importance
  10) or nearing it within 3% (`stop_proximity`). Reads only the shared
  live-price cache — **never** fetches per-position. **Skips broker
  placeholder stops** (broker imports store `stop_price == entry_price`; without
  the skip every broker position reads "at stop"). Cooldown keys are
  namespaced (`{sym}:stop_hit` vs `{sym}:stop_near`) so a proximity warning can
  never suppress the actual breach alert.
- **R4 regime-flip** — the market regime label changed since the last cycle, for
  any user with a position or watchlist at stake. Needs the durable
  `awareness_regime_snapshots` ledger (below) because the regime classifier
  recomputes from a 15-min cache and never persisted a prior label.
- **R5 earnings-proximity** — an owned or watched symbol reporting within the
  window (`AWARENESS_EARNINGS_PROXIMITY_DAYS`, default 3; threaded through
  `scan_ctx`). Owned gets a higher personal multiplier than watched.

### Scoring + queue reuse
- Each candidate's **deterministic relevance score** (`base_signal ×
  personal_multiplier × urgency`, clamped 1-10) becomes the `add_insight`
  importance. `add_insight` (`voice_proactive_service.py`) owns dedup, the 8/day
  cap, and the 6h per-symbol cooldown — the engine adds no new queue logic.
- Importance **≥ 8 also away-delivers** via `watchlist_alert_service.deliver_alert_payload`
  (in-app + email + Discord).

### The engine (`api/services/awareness/engine.py`)
- `run_awareness_scan()` = **one shared market scan per cycle** (regime +
  earnings window + cached live prices for every held symbol) → **two bulk
  queries** load all users' open `j2_positions` (`closed_at IS NULL`) +
  watchlist symbols (no N+1) → rules per user → dedup-fire. Exception-layered:
  a bad user or a bad `deliver` can't abort the rest of the cycle, and the
  scheduler job wraps the whole call.
- `api/services/awareness/regime_snapshots.py` — append-only per-cycle ledger in
  `auth.db` (`awareness_regime_snapshots`, WAL + `busy_timeout=2000`); schema
  inits unconditionally at startup (cheap, idempotent).

### Scheduler (double-gated) + the tile
- Registered in `api/main.py` via `_add_compass_job` (which gates on
  `COMPASS_AUTOMATION_ENABLED`), and the job function **also** checks
  `AWARENESS_ENGINE_ENABLED` — **both must be on**. 20-min cadence, weekday
  market-adjacent hours, `max_instances=1` (the regime read-then-append assumes
  single-instance — do not raise it).
- Frontend: the previously-built-but-unmounted `CompassTodayTile.jsx` is revived
  as a grouped, dismissible **"Compass noticed"** feed (dismiss → the existing
  `POST /api/voice/insights/{id}/dismiss`) and mounted on the Dashboard below the
  existing tiles (desktop + mobile). Renders `null` when there's nothing to show.

### Activation
> Both `COMPASS_AUTOMATION_ENABLED=1` AND `AWARENESS_ENGINE_ENABLED=1` must be set
> in Railway for the scan to run at all (the job registers only under the first;
> the job function checks the second). Rollback = unset either one — no code
> change, no rebuild. **NOTE:** `COMPASS_AUTOMATION_ENABLED` has been OFF since
> 2026-05-18 (token burn) — enabling it also re-enables the other paused Compass
> jobs, so treat that flip as a deliberate un-pause decision.

### Known limitations / tuning backlog (surfaced by the final review, deferred to M2)
- **Shared 8/day insight cap:** `add_insight`'s per-user daily cap is global across
  ALL kinds. The awareness scan runs 4:00–7:20am before `daily_focus` posts at
  7:30am, so a very active user's awareness insights can exhaust the budget and
  silently drop that day's `daily_focus`. If activated, watch for this; the fix
  (reserve a slot / sub-cap awareness) is M2.
- **Cold earnings-calendar cache:** `_collect_earnings_window` calls Finnhub up to
  4× per 20-min cycle when `calendar_weekly` is cold (e.g. right after a redeploy,
  pre-market before anyone opens /calendar). Bounded + off the request path, but a
  small per-day memo in the engine would cut Finnhub contention — M2.
- **`awareness_regime_snapshots` grows unbounded** (~51 rows/weekday, no prune). Trivial
  for years; add a retention sweep eventually.
- **Score ceiling:** a near-stop proximity warning and an actual stop breach can both
  clamp to importance 10 — consumers should key severity off `kind`, not `importance`.
- **Regime-flip delivery is in-app only** (deliberate, to avoid mass-emailing every
  position holder on every flip). If you want a "regime changed" email, add it back
  with a confidence gate.

## Mobile Navigation

Shown at ≤1024px (desktop uses the left `NavBar`). Two pieces, both in `Layout.jsx`:
- **`MobileNav` top bar** — fixed header: menu button + page title + movers shortcut + `AlertBell`. The menu button does NOT open a drawer anymore; it calls `onMenu` → opens the same `MoreSheet` as the bottom bar.
- **`MobileTabBar` (bottom)** — Home · Markets · Charts · Journal · **More**. Branded `UIcon` glyphs (never emoji). "More" + the top-bar menu button both open **`MoreSheet`** — the SINGLE comprehensive directory (sectioned Core/Markets/Trading/Help/Account, identity header, free/paid/admin gating, active-route highlight, Compass badge). The old side drawer was REMOVED (2026-06-19) so there's one menu, two triggers — don't reintroduce a second nav.

### Floating buttons (FABs)
The voice orb (`voice/FloatingOrb.jsx`, paid-only, bottom-right) and the feedback "?" (`FeedbackWidget.jsx`, bottom-left) are `position:fixed` above the tab bar. Both **auto-hide on scroll-down** via `hooks/useHideOnScroll.js` and restore on scroll-up / near-top / ~1.4s idle. The orb stays put during a live call or drag; the feedback button stays put while its menu is open.

### ⚠️ Mobile layout gotcha — `useMediaQuery`/`useIsTouch` is stale at first paint
`hooks/useMediaQuery.js` seeds from `matchMedia(q).matches` at MOUNT and only updates on a media **`change`** event. In a fixed mobile context the viewport never changes, so a JS `useIsTouch()` read can render the desktop variant on a phone. **Use CSS `@media` queries for layout/positioning** (for inline-styled components add a CSS-module class + `!important` inside the query); reserve `useIsTouch()` for click-triggered conditional rendering (open a `Sheet` vs anchored popover on tap). Scroll listeners must use capture phase — the app scrolls the inner `.main` element, not `window` (`Layout.module.css`: `.shell` overflow:hidden, `.main` overflow-y:auto).

### OptionsFlow mobile (partner-owned, ~7k lines, all inline styles)
Rebase-safe technique only: add `className` HOOKS to `OptionsFlow.jsx` (never edit its inline `style={{}}` objects) + ride the additive `OptionsFlow.mobile.css` layer (all `@media (max-width:640px)` + `!important`). Hooks in use: `of-mroot` (root), `of-tabs` (tab bar), `of-chiprow`/`of-chiprow-seg`/`of-chiprow-wrap` (filter strips → horizontal scroll, 44px), `of-tip` (theme-help ⓘ, tap-toggled via a `data-pin` flag so the touch mouseenter→click ordering doesn't cancel it).

## Responsive / Mobile System (2026-06-05 — mobile-seamless initiative)

The whole app is being made mobile-seamless with **near-full feature parity** (TradingView-mobile quality, including touch charting). Plan: `C:\Users\Patrick\.claude\plans\we-need-to-go-enchanted-crown.md`.

### Breakpoints — 3 tiers, 2 boundaries (canonical; do NOT invent new literals)
- **phone** ≤ 640px · **tablet** 641–1024px · **desktop** ≥ 1025px
- **Source of truth:** `app/src/styles/breakpoints.js` (`BP`, `MQ`) + `app/src/hooks/useBreakpoint.js` (`useIsPhone`/`useIsTablet`/`useIsTouch`/`useIsDesktop`/`useHasCoarsePointer`/`useHasNoHover`). All wrap the existing `useMediaQuery.js`.
- **CSS:** copy the canonical `@media` strings from `app/src/styles/breakpoints.css` (imported in `index.css`). PHONE `@media (max-width:640px)` · TABLET `@media (min-width:641px) and (max-width:1024px)` · TOUCH `@media (max-width:1024px)` · DESKTOP `@media (min-width:1025px)`. Utilities: `.hideOnPhone`/`.showOnPhone`/`.hideOnTouch`/`.touchTarget`/`.hoverReveal`.
- **Convention:** new/touched CSS uses ONLY 640 and 1024; new JS uses the `useBreakpoint` hooks. Snap legacy literals when you touch a file (768/900/720 → 1024, 600/480 → 640). Never add a new non-canonical literal.

### Reusable mobile primitives (`app/src/components/mobile/`)
- **`Sheet.jsx`** — responsive modal/drawer: centered modal on desktop, bottom-sheet or fullscreen on touch (`variant="auto|modal|bottom-sheet|fullscreen"`). Portal, focus-trap, Escape, drag-to-dismiss, body-scroll-lock, safe-area. Use for ALL new modals/drawers/popovers on mobile.
- **`useLongPress.js`** — pointer-based long-press (450ms, 10px tolerance, haptic); also accepts right-click on desktop so one binding serves both inputs. Replaces right-click-only context menus.
- **`ContextPopover.jsx`** — action menu via `Sheet` bottom-sheet on touch / anchored menu on desktop; 44px rows.
- **`ResponsiveTable.jsx`** — `<table>` on desktop; on phone either **card mode** (entity rows, 3–5 key fields) or **frozen-first-column scroll** (dense comparison grids where per-cell heat/color matters). Pick per surface.

### Tap targets
`--tap-min: 44px` is defined in tokens.css. Enforce on all interactive elements on touch (use `.touchTarget` or `min-height/width: var(--tap-min)`).

### Mobile audit harness — `tools/mobile_audit.py` (no device needed)
Playwright sweep (Python Playwright + Chromium already installed). Boots phone/tablet viewports, dismisses the intro overlay, visits each route, flags **horizontal overflow** (the #1 objective mobile bug) + sub-44px tap targets, saves a full-page screenshot per route/viewport to `tools/mobile_audit_out/` (gitignored) + `report.md`.

**Tightest loop = local backend + admin account (sees ALL routes, no deploy wait):**
```
# 1. Start backend (heavy jobs off). ADMIN_EMAILS auto-promotes the test user → admin (admins skip email-verify + see every route)
$env:ADMIN_EMAILS="mobtest@local.dev"; $env:WORKER_ENABLED="0"; $env:CATALYST_ENGINE_ENABLED="0"; $env:TWITTERAPI_IO_ENABLED="0"; $env:BARS_PREWARM_DISABLED="1"; $env:TICKER_NAMES_PREWARM_DISABLED="1"
python -m uvicorn api.main:app --port 8077
# 2. One-time: create the admin account
curl -X POST http://localhost:8077/api/auth/signup -H "Content-Type: application/json" -d '{"email":"mobtest@local.dev","password":"LocalTest2026!","display_name":"x"}'
# 3. Audit (rebuild `app` first so the backend serves fresh dist/)
$env:MOBILE_AUDIT_EMAIL="mobtest@local.dev"; $env:MOBILE_AUDIT_PASSWORD="LocalTest2026!"
python tools/mobile_audit.py --base http://localhost:8077 --auth                                   # all routes, all viewports
python tools/mobile_audit.py --base http://localhost:8077 --auth --viewport phone --routes /journal # focused
```
Loop: edit CSS → `cd app && npm run build` → re-run audit → read `report.md` + screenshots. Against live Railway instead: `--base https://uctintelligence.com` (a free test account only sees FREE_PAGES + /settings). Auth uses `page.request.post('/api/auth/login')` so the cookie lands in the context jar — robust vs the intro overlay. **Must pass `--auth`** to log in (the `--routes` flag alone does not).

## Cinematic Intro Animation (LIVE — 2026-05-09)

**Brand identity reveal that plays on every page load.** Mounted at `App.jsx` root inside `<AuthProvider>` so it has access to `useAuth().user.name`. Internal route changes don't remount the App, so it does NOT replay during in-app navigation — only on actual page loads (initial visit, refresh, bookmark hit, post-deploy reload).

### Brand structure
- **Uncharted Territory** = parent brand (the umbrella identity)
- **UCT Intelligence** = product / dashboard within Uncharted Territory
- **Tagline (locked):** *Navigate the market, effectively.*
- **Compass + candlestick mark** = brand symbol; red/green primary, gold-embossed for premium contexts

### Three-act structure (~9.3s total)

1. **Cartographer (0.0–3.8s)** — parchment world emerges with cross-hatch grid, drifting candle ghosts, coordinate marks. The compass arms ink themselves in (mask-position sweep). Compass-rose backdrop strokes from center outward, bearing tick ring rotates into place with a needle-finds-north wobble. Dotted journey path strokes corner-to-corner with a glowing gold ship marker riding along (SVG SMIL `animateMotion`). Wax seal medallion stamps in bottom-right with serif **UT** monogram + arched "CHARTING THE MARKET" text. Italic-serif map labels: *UCT INTELLIGENCE* (top), *From — Premarket* / *To — Closing Bell* (corners), *"Navigate the market, effectively."* (bottom).

2. **Welcome (4.0–5.7s)** — gold ignition flash burns the parchment away. Personalized **"Welcome, {firstName}."** with gold-shimmered name + hairline rule + tagline beneath. Held 1.4s for emotional landing. Logged-out / nameless fallback: **"Welcome, TRADER."** (all-caps).

3. **Brand Finale (6.0–8.5s)** — compass mark pops in (rotate -30°→0° + scale bounce). **UCT INTELLIGENCE** wordmark with gold-gradient shimmer. *"— Uncharted Territory —"* italic serif subtitle. **12 capability pills** cascade in 4×3 grid: Morning Wire · UCT 20 · AI Intelligence · Live Breadth · Theme Tracker · Trade Journal · Setup Library · Real-Time Stream · Watchlists · Scanner · Options Flow · Calendar.

### Files
- `app/src/components/intro/IntroAnimation.jsx` — main component (~250 lines)
- `app/src/components/intro/IntroAnimation.module.css` — all keyframes (~700 lines)
- `app/src/components/intro/introStorage.js` — `prefersReducedMotion()` helper (storage helpers retained but unused after switching to play-every-load)
- `app/src/components/intro/assets/compass-mark.png` — Pillow-processed transparent red/green compass (white background → alpha 0)
- `app/src/components/intro/assets/parchment-mark.png` — aged-paper compass

### Skip behavior
- ESC / Enter / Space / click anywhere / "Skip" button (top-right) → finishes immediately
- `prefers-reduced-motion: reduce` → 1.6s static fade with logo + welcome only (no cartographer / brand-finale animation)

### Mobile (< 640px)
- Compass mark shrinks 130px → 96px
- UCT INTELLIGENCE wordmark shrinks 40px → 28px
- 4×3 pill grid collapses to 2×6
- Wax seal hides

### Personalization
```js
const greetingName = user?.display_name?.trim().split(' ')[0] || user?.email?.split('@')[0] || 'TRADER'
```

### Spec
`docs/superpowers/specs/2026-05-08-uct-intelligence-intro-animation-design.md`

### Tech notes
- Pure CSS keyframes + SVG SMIL motion, **zero new dependencies**
- ~70KB image assets, ~12KB CSS
- Uses `Georgia, 'Times New Roman', serif` for cartographer/map decoration ONLY (explicit exception to font-unification rule because these are graphic decoration, not UI text). Welcome line + product wordmark + pills all use Instrument Sans

## Charts Hub V2 — `/charts` Customizable Workspace (2026-05-24 + polish 2026-05-25)

The `/charts` tab is a TradingView-grade react-grid-layout workspace. Replaces V1's sub-tab Charts Hub. Free tier includes everything.

### Architecture
- **Top-level shell:** `app/src/pages/charts/ChartsWorkspace.jsx` — owns layout state + 4 color groups + viewport-lock sizing. Layout persists to `usePreferences('charts_workspace_layout')` (debounced 500ms). Color-group syms persist to `charts_workspace_groups`.
- **Grid:** `react-grid-layout@^1.5.3` Responsive component. `cols={12}`, `FIXED_ROWS=20`, `rowHeight` computed dynamically via `ResizeObserver` on `.workspaceBody` so the grid always fills the visible viewport exactly. `maxRows={20}` + `overflow: hidden` on body = no outer scroll. `margin=[6,6]`, `compactType: 'vertical'`. `resizeHandles={['nw','ne','sw','se']}` enables resize from all 4 corners.
- **Color groups (A/B/C/D)** are how widgets link tickers. A widget assigned color A reads/writes `groupSyms.A`; multiple widgets on the same color stay in lockstep. `WorkspaceContext` (`useWorkspace()`) exposes `{groupSyms, setGroupSym(color, sym)}`. `ChartsSymContext` (V1 API, `useChartsSym()`) is now a shim: explicit Provider → WorkspaceContext Group A → null fallback. Watchlists/ThemeTrackerPage/Screener (V1-era) still work without code change because they default to Group A.
- **Widget types:** `chart` (StockChart), `watchlist` (Watchlists with `embedded` prop), `themes` (ThemeTrackerPage `embedded`), `scanner` (Screener `embedded`). Each widget wrapped in a scoped `ChartsSymContext.Provider` so the wrapped page publishes/reads tickers from THE WIDGET'S color group, not Group A.
- **WidgetHost** (`app/src/pages/charts/WidgetHost.jsx`): type dispatcher + `WidgetHeader`. **WidgetHeader** is the drag bar with drag grip (`.charts-widget-drag-handle` consumed by RGL `draggableHandle`), color-cycle dot, close button. **Label is visually hidden (sr-only)** — color dot + body content identify the widget.
- **Mobile (`<640px`)** bypasses RGL entirely → renders a single full-screen `StockChart` via `MobileChartFallback` (ticker persists to `localStorage['charts_mobile_sym']`).
- **Legacy URLs** (`/theme-tracker`, `/watchlists`, `/multi-chart`) redirect to bare `/charts` via `LegacyRedirect` (strips `?tab=`, preserves other query params).

### ChartWidget specifics (`app/src/pages/charts/widgets/ChartWidget.jsx`)
- **TF bar** above the chart with 8 buttons: `1m`/`5m`/`15m`/`30m`/`1h`/`1D`/`1W`/`1M` (codes `1`/`5`/`15`/`30`/`60`/`D`/`W`/`M`). TF persists per-widget via `opts.tf` through the same debounced save path. StockChart's `onTfChange` (keyboard shortcuts) is wired back so the TF bar stays in sync.
- **SymbolSearch badge** at the left of the TF bar with vertical divider. Click → predictive dropdown. Imperative `openWith(text)` exposed via `forwardRef + useImperativeHandle` so the chart can populate it.
- **Click-to-focus + type-to-search**: chart container is `tabIndex={0}`. Click anywhere on the chart focuses it; typing a letter/digit/period opens SymbolSearch prefilled with that character. The chart's keydown handler ignores events bubbling from inputs so subsequent characters flow into the search input naturally.
- **Persistent focus after ticker pick**: every ticker change (dropdown click, Enter, internal `StockChart.onSymbolChange`) routes through a single `handleSymbolChange` in ChartWidget; after the sym updates, `requestAnimationFrame` refocuses the chart container. Pick ticker → still focused → start typing the next ticker without re-clicking. **Do not pass `setGroupSym` directly to SymbolSearch or StockChart** or this behavior breaks.

### Predictive ticker autocomplete (TradingView-style)
- **Backend:** `GET /api/ticker-search?q=NV&limit=20` (`api/routers/ticker_search.py`). Loads `cap_universe.json` (3,742 tickers) once at module import. Ranks: exact → prefix → substring. Returns `{results: [{ticker, name | null}]}`.
- **Name source:** existing `ticker_meta` cache (same one powering chart watermarks). In-process TTLCache → on-disk `/data/ticker_meta_cache/{TICKER}.json` (24h TTL). For misses, fires bounded async backfill (2-worker pool, max 8 in-flight) via `_base_meta()` so the next request resolves the name. Never blocks the autocomplete response.
- **Frontend (`SymbolSearch.jsx`):** 150ms debounced fetch. Renders full-width rows with bold gold ticker + dim grey company name. Arrow ↑/↓ navigate, Enter submits highlighted, Esc closes. Empty query falls back to a hardcoded POPULAR list (30 ETF/megacap entries with names baked in so the dropdown is never bare on a fresh deploy). "Go to {TICKER}" fallback row when no exact match exists so any ticker still works.
- **Background prewarmer** (`api/services/ticker_names_prewarm.py`): daemon thread on Railway startup (60s warmup delay so it doesn't fight `bars_prewarm`) walks the full cap_universe and calls `_base_meta` on each (250ms sleep between calls). Skips already-fresh disk entries → reboots no-op in ~5s. Full cold pass ~30 min. Toggle off with `TICKER_NAMES_PREWARM_DISABLED=1`.

### Watchlist arrow-key navigation (`app/src/pages/Watchlists.jsx`)
- Arrow ↑/↓ on a focused workspace moves through every expanded list (Flagged + tag color auto-lists + user/community watchlists), not just Flagged.
- Builds a deduped flat sym list in visual order via `visibleSymsFlat = useMemo(...)`. Arrow keys find `selectedSym` in the list, move ±1, set both `selectedSym` AND the hub sym (so a paired Chart widget follows).
- `scrollIntoView({block: 'nearest'})` via the `data-watch-sym` attribute on each `.listRow` (4 render points) keeps the active row visible. Ignored while typing in inputs/textareas/contenteditable.

### Responsive embedded content (`@container` queries, NOT `@media`)
- `.widgetBody` is the `container-type: inline-size` root.
- Scanner's 3-col grid collapses to 2 then 1 col as the *widget* (not viewport) narrows.
- `.pageEmbedded` on Watchlists/Themes/Screener is `display: flex; flex-direction: column; overflow: hidden`; inner panel `flex: 1; min-height: 0`. Standalone (non-embedded) mode keeps the old `display: flex; row` layout.

### Critical invariants — do not regress
- **Viewport-lock**: `rowHeight` is dynamic via `ResizeObserver`. Never hardcode it. `maxRows={FIXED_ROWS=20}` + `overflow: hidden` on `.workspaceBody` are load-bearing.
- **Container-query root is `.widgetBody`** — Watchlists/Themes/Screener embedded CSS uses `@container`. If you remove or rename the container-type, all widget-responsive behavior breaks.
- **`useChartsSym()` shim resolution order** (explicit Provider → WorkspaceContext Group A → null) — load-bearing for V1-era components.
- **`embedded` prop on Watchlists/ThemeTrackerPage/Screener** hides their right-side StockChart panel + tightens chrome. Without it, nested chart-in-chart inside widgets.
- **Layout persist debounced 500ms** — never persist on every drag tick.
- **Backfill pool bounds (2 workers, 8 in-flight)** in `ticker_search.py` are intentional — yfinance rate-limits aggressively.
- **Prewarmer 250ms + 60s warmup delay** are tuned for yfinance/Finnhub politeness.
- **All ticker changes in ChartWidget route through `handleSymbolChange`** (refocuses chart via rAF).
- **`SymbolSearch.openWith(text)` imperative API** is consumed by ChartWidget's type-to-search; preserve the forwardRef + useImperativeHandle surface if refactoring.

### Files
- Workspace: `app/src/pages/charts/{ChartsWorkspace,WidgetHost,WidgetHeader,WorkspaceContext,ChartsSymContext,LegacyRedirect}.jsx` + `ChartsWorkspace.module.css`
- Widgets: `app/src/pages/charts/widgets/{ChartWidget,WatchlistWidget,ThemesWidget,ScannerWidget,MobileChartFallback}.jsx`
- Hooks: `app/src/hooks/useMediaQuery.js`
- Embedded pages (existing): `app/src/pages/{Watchlists,ThemeTrackerPage,Screener}.jsx` with new `embedded` prop
- Predictive search: `app/src/components/chart/SymbolSearch.jsx` + `.module.css`
- Backend search: `api/routers/ticker_search.py`, `api/services/ticker_names_prewarm.py`
- Spec: `docs/superpowers/specs/2026-05-24-charts-hub-v2-workspace-design.md`
- Plan: `docs/superpowers/plans/2026-05-24-charts-hub-v2-workspace.md` (16 tasks)

## Multi-Chart Grid Mode — /charts (shipped 2026-07-16/17)

A second MODE of the Charts workspace: a fixed N×M CSS grid of independent chart
cells (presets 1x2→4x4 + custom N×M, hard cap `GRID_MAX_CELLS=16` in
`gridLayouts.js` — perf-spike-validated: 16 cells framed in ~900ms, +63MB heap).
Entry point: **Open Layout ▾ → "▦ Multi Chart ▸"** (hover/click flyout) — NOT a
header tab (owner decision 7/17). Source: `app/src/pages/charts/grid/`.

- **Cell = `GridChartCell`** (React.memo, controlled `{id, sym, tf, chartType}`)
  composed on StockChart directly with the ChartWidget canvas recipe — NEVER
  ChartWidget itself (color groups cap at 4 independent syms). Per-cell chart
  Style select via the `settingsOverride` StockChart prop (partial blob merged
  over the global `chart_settings`; write-restore keeps overrides out of the
  global blob). Saved drawings render read-only (`showSavedDrawings` +
  `ChartDrawingOverlay readOnly` — display-only overlays must pass `readOnly`
  or their window keydown swallows Ctrl+Z/V/Escape page-wide).
- **Mount queue** (`useStaggeredMount`): ≤3 cells loading at once, slot freed by
  StockChart `onBarsReady` or 5s safety timer — the guard against the
  2026-05-24 fetch-herd outage class. Cells pass `backgroundWarm={false}` (no
  all-TF warm chain / dwell-warm). NEVER bypass with eager mounts.
- **Chart-parity warming** (shipped 2026-07-20, `feat/multichart-warm-parity`,
  flag `VITE_GRID_WARM_ENABLED` default ON): grid cells feel instant on all
  timeframes + scroll-back like the primary chart, herd-safely. Spec/plan:
  `docs/superpowers/{specs,plans}/2026-07-20-multichart-warm-parity*`. Design
  reality: live-streaming, stale-gap-refetch, and the sane-price chokepoint
  ALREADY reach cells unchanged (cells default `liveUpdates=true`) — the only
  gap was warming. **How it works — and its LOCKED invariants:**
  - `GridChartCell` **MUST keep `backgroundWarm={false}`** — flipping it re-runs
    StockChart's per-cell all-TF chain, which does DIRECT `fetch()` (StockChart
    ~L2416) = instant 16×7 herd. Parity is achieved WITHOUT it.
  - **Container-driven warm**: `MultiChartGrid` calls `prefetchGridWarm(gridSyms)`
    (`utils/prefetchBars.js` — `prefetchListAllTimeframes` over all 8 TFs
    `GRID_WARM_TFS`) which rides the EXISTING bounded, idle-deferred `_idbQueue`
    (`_IDB_MAX=3`). A 16-cell grid = up to 128 jobs but **≤3 concurrent** (prod-
    verified: 80 fetches peaked at 6 in flight incl. mount, all shallow
    `bars=600`). The warm MUST go through the prefetch module (never a direct
    fetch). The decision logic is the pure helper `grid/gridWarm.js`
    (`makeGridWarmer`) with 4 guards: content-keyed (a TF/Style/undo change with
    the same sym-set never re-warms), ready-gated (`hydrated && firstPaintSettled`
    — deferred past the cold paint), read-only (never a state mutator → no
    `scheduleSave` thrash), + a ~2h re-warm for boards left open past IDB's 26h
    intraday eviction.
  - **`deepWarm` prop** (StockChart) gates ONLY the dwell-warm (deep history),
    independent of `backgroundWarm`. Passed **maximized-cell-only**
    (`deepWarm={gridWarmEnabled && maxId===cell.id}`) — NOT hover-driven
    `activeIdx` (that broke GridChartCell's React.memo "hover sweep re-renders
    zero charts" contract). ≤1 deep fetch in flight.
- **Streaming needs NOTHING**: priceStreamManager/barsStreamManager pool
  browser-wide (16 cells = 1 SSE). Never add a per-cell stream or second mux.
- **Persistence**: working state = `multichart_state` pref (500ms debounce +
  hydration gate + flush-on-unmount, sanitized by `gridLayouts.sanitizeState`);
  named grids = `/api/charts/layouts` rows with `layout.kind='multichart'` and
  `widgets: []` (passes backend validation) — BOTH menus filter by `kind`, and
  grid templates DO store tickers/tfs/chartTypes (unlike arrangement-only
  workspace templates).
- **Hotkeys**: each cell passes `hotkeysActive={() => activeCellRef.current === i}`
  (hover/focus-tracked in `MultiChartGrid`) so one TF keypress retimes only the
  active cell; ChartWidget uses the same prop via `WorkspaceContext.activeChartRef`.
- **StockChart paint/framing latches** (`lastCfgSigRef`/`prevBarsRef`/`zoomKeyRef`
  etc.) are RESET in the unmount cleanup and gated by `_freshChart` — a
  destroyed→recreated chart must never inherit a 'noop' render plan (blank-cell
  bug class). Series-length swaps use `rangeDescribesOldExtent` before the
  bars-from-right re-anchor.
- **Perf harness**: admin-only `?gridspike=N&tf=D|5` runs the real grid path with
  persistence off; results → console `[gridspike:done]` + 
  `localStorage['uct.gridspike.last']`. Run it in a VISIBLE tab (hidden tabs
  rAF-throttle; the sweep has a validity guard). Spec + punch list:
  `docs/superpowers/specs/2026-07-16-multichart-grid-design.md`.

## Charts — Lightweight Charts v5

All charts use TradingView Lightweight Charts (NOT TradingView iframes). Key component: `app/src/components/StockChart.jsx`.
- 5 chart types: candles, hollow, bars (OHLC), line, area — user-selectable
- Candlestick + volume (separate panes), configurable MA overlays (4 slots)
- HVC gold volume bars (52W volume high detection, O(n) sliding window deque)
- BUY/SELL markers, entry/stop price lines
- 200-bar default zoom via `setVisibleLogicalRange`, 8-bar right padding
- `rightBarStaysOnScroll: true` — latest candle stays pinned when zooming
- **5000 bars ALL timeframes** (5min/30min/1hr/Daily/Weekly)
- Backend: `/api/bars/{ticker}?tf=D&bars=5000` (Massive API primary, yfinance fallback for stale intraday)
- **COT charts are Chart.js** — do NOT replace those

### Crosshair OHLCV Legend
- TradingView-style overlay at top-left of chart, appears on hover
- Shows: date/time, O, H, L, C, V (formatted K/M), change + change%, MA overlay values with colors
- Developing bar: falls back to REST session volume + last computed MA values
- Uses `chart.subscribeCrosshairMove()` API, state in `crosshairData`
- Works on all chart surfaces (TickerPopup, Breadth, ThemeTracker, Watchlists, CustomScan)

### Chart Performance Architecture
- **Chart instance reuse**: no DOM destroy on ticker switch — `setData()` on existing series, `applyOptions()` for settings. Only `chart.remove()` on unmount.
- **Memoized data**: `ohlcData`, `closeData`, `volData`, `overlayData`, `resolvedOverlays` all wrapped in `useMemo`. Prevents recomputation on non-data changes.
- **GZip compression**: `GZipMiddleware` on FastAPI (skips `/api/stream/*` SSE endpoints), ~6x smaller payloads
- **3-layer cache**: in-memory TTLCache (~1ms, 5-15min) → persistent disk `/data/bars_cache/` (~10ms, 2-72hr) → Massive API (4-30s)
- **Disk cache TTLs**: D=48hr, W=72hr, 60m=8hr, 30m=4hr, 5m=2hr. Empty results never cached.
- **Full universe pre-cache**: background thread on startup fetches 3,742 tickers (`api/data/cap_universe.json`) × 5 TFs = 18,425 entries. Also pulls tickers from wire_data (UCT20, candidates, earnings), theme taxonomy (all tiers), watchlists, and tagged tickers. Continuous refresh loop cycles permanently.
- **SWR prefetch**: `app/src/utils/prefetchBars.js` — `prefetchBars(tickers, tf)` warms adjacent tickers in list contexts, `prefetchAllTimeframes(sym)` warms all 5 TFs on selection. Wired into DrillModal, ThemeTrackerPage, Watchlists, CustomScan. `prefetchBar(sym)` on TickerPopup hover.
- **Stale intraday detection**: `_is_intraday_stale()` checks if Massive data is >5 days old (catches pre-split bars), falls back to yfinance (split-adjusted).
- **Lookback caps**: daily/weekly capped at 30 years (10,950 days) to avoid strftime crash on pre-1900 dates. Intraday scales dynamically: `bars_per_day = 390 / multiplier`, lookback = `max_bars / bars_per_day * 1.5`.
- **Startup purge**: `bars_disk_cache.purge_empty()` removes empty cache files from prior bugs.

### Bars Freshness & Reliability Architecture (2026-05-16/17 overhaul — CRITICAL, do not regress)

Spec: `docs/superpowers/specs/2026-05-16-bars-freshness-fix-design.md`. Fixed a systemic universe-wide intraday freeze + frontend spike/phantom classes. **Locked invariant: newest bar wins per `(ticker, tf, ts)` on EVERY path.**

- **Two services, separate volumes, R2 bridge**: `web` (uvicorn, serves users) + `worker` (`python -m api.worker_main`, `WORKER_ENABLED=1`, runs the prewarmer + uploads R2 snapshots). Separate `/data` volumes. Web ingests worker freshness via a **newer-wins MERGE** (`data_sync.merge_snapshot` / `sync_if_newer_merge`): `INSERT OR IGNORE … WHERE local has none OR snap.ts > local MAX(ts)`. **NEVER re-enable replace-style pull** — `R2_PERIODIC_PULL_LEGACY_REPLACE=1` is an emergency-only escape hatch; replace-pull caused the 2026-05-07 regression that froze the universe.
- **Cold-stale ⇒ synchronous first paint**: `_is_cold_stale_intraday()` (weekend/pre-open aware) — an entry missing ≥1 session is fetched **synchronously** (correct first paint), NOT stale-while-revalidate. `_delta_intraday` paginates `next_url` (multi-day gaps fully backfill).
- **Dual-class symbology**: `massive.to_polygon_symbol()` maps `BRK-B`→`BRK.B` at the Massive REST boundary ONLY (cache/FMP/yfinance keep hyphen). Massive/Polygon use dot notation for class shares.
- **SQLite writes**: in-process `bars_sqlite._WRITE_LOCK` serializes `put_bars`/`put_provenance` (reads stay lock-free, WAL). `busy_timeout` is **context-aware: 30s on worker / 2s on web** (web's 2s is intentional — high values compound with the retry loop and saturate the anyio pool). Worker prewarm pool = 4.
- **Worker proactive intraday warm is SCOPED to the ACTIVE set** (priority + breadth drill lists + watchlists + UCT20 + candidates + theme holdings), NOT the full cap_universe. cap_universe-only long tail gets light D/W/M universe-wide + on-demand-correct Part-1 intraday (correct on first open, ~2-4s then cached — never wrong). Tiered TFs: 60/30/15 whole active set, 5/1 top-800.
- **Frontend hardening** (`StockChart.jsx`, `utils/barsIDB.js`): `isSaneLivePrice()` is the SINGLE chokepoint for ALL live-apply paths (rejects non-finite/≤0 and >50% deviation vs last bar OR poison-proof `lastServerCloseRef` — a baseline only ever set from clean server bars; this killed the DDOG 20798 = 100× phantom lock-in). Stale intraday IDB is NOT rendered (`idbStaleIntraday` → full no-since refetch). barsIDB has a logical `CACHE_LOGIC_VERSION` (bump to invalidate all cached bars — do NOT bump `DB_VERSION`, it deadlocks) + intraday eviction keyed on **bar-data freshness** (newest bar >26h ⇒ cache miss), not save-time.
- **Watchdog**: `bars_continuous_audit._run_5min_check` samples the hot-set; `chart_health_alerts.emit('intraday_hotset_stale', …)` if actively-viewed charts go ≥1 session stale (universe long-tail baseline is logged, NOT alerted — avoids permanent-red).
- **GOTCHA — quarantine is intraday-only**: `bar_quarantine`/`bars_disk_cache` write does `int(bar['t'])` which throws+swallows for daily ISO `t`, and the read filter compares ISO-string `t` vs an int set — so quarantine **silently no-ops for D/W/M**. Make it date_tf-aware (YYYYMMDD int both sides) before relying on it for daily.
- **Reusable audit tools**: `tools/full_chart_diagnostic.py`, `tools/phantom_scan.py`, `tools/daily_split_audit.py`. (Do NOT use `tools/detect_dead_tickers.py` — unsafe: self-induced load makes it false-flag live megacaps as delisted.)
- Outstanding/deferred items: see user memory `project_chart_accuracy_initiative.md` → "OUTSTANDING" section.

### Bars Correctness Layer — 2026-05-22/23 weekend (CRITICAL, do not regress)

Capstone fix-pass over the long-weekend closure. Killed the last persistent
bug classes that survived the May-16/17 freshness overhaul. **Locked invariants:**

- **FMP `_fetch_intraday_fmp` parses `date` as ET, NOT naive.** FMP returns
  ET local text (`"2026-05-22 15:30:00"`); the prior naive `datetime.strptime`
  + `.timestamp()` interpreted that as UTC and shifted every FMP-sourced bar
  by the ET-UTC offset (4h EDT / 5h EST). yfinance fallback got a defensive
  fix in the same commit so it can't regress to the same trap.

- **`_delta_intraday` uses `>=` (NOT strict `>`)** for the boundary bar.
  Strict-`>` froze in-progress 30min bars stored at chart-load-snapshot
  values (e.g. BB 5/21 13:00 ET stored at the 13:15 ET partial = C=6.47
  V=738K instead of the closed C=6.62 V=2.68M). With `>=` the boundary
  bucket gets re-aggregated from up-to-date 30min source on every delta;
  INSERT OR REPLACE overwrites the wrong row. WS still owns the per-tick
  display via `bar_broadcaster`; REST writes the persisted SQLite row.

- **Canonical ET-anchored bucket: `bars_fetch.bucket_60_et_unix_seconds`.**
  Single source of truth for 60min bucketing — shared by `_session_resample_hourly`
  AND `bar_rollup.bucket_start` (for tf=60). Equivalence by construction.
  Property-tested across 1000 random minutes + explicit DST transitions.

- **60min has WS streaming.** `bar_broadcaster.ROLLUP_TFS = ("5","15","30","60")`;
  `stream.py` allow-list includes "60"; `StockChart.jsx::realtimeTfEligible`
  includes "60". 1hr charts now receive authoritative AM-derived OHLCV via
  SSE instead of relying on tick synthesis.

- **`_needs_fresh` post-market refinement.** Weekday 4 AM – 8 PM ET uses
  the standard tf threshold (catches pre/post-market new bars); overnight
  + weekend keep the conservative 30h gate. Eliminates the "chart opened
  at 17:00 ET stuck at noon" trap.

- **Browser IDB `CACHE_LOGIC_VERSION = 4`.** Bump to 5 (or higher) on any
  future bar-fetch/merge logic change that invalidates cached shapes. The
  jump from 3 to 4 cleared FMP-poisoned shifted-ts rows that `mergeDelta`
  could never heal (delta only ADDS — can't remove rows at wrong ts).

- **SWR `refreshInterval: 30000` intraday / 300000 D/W/M** on every
  `StockChart` instance, plus a no-op repaint guard in the delta-merge
  effect (skip `setData` when the post-merge tail is structurally identical
  to the pre-merge tail). Eliminates the "chart frozen at first-fetch
  data until remount" trap and prevents the 30s-cadence flicker.

- **Continuous reconciliation worker** (`bars_reconciliation.py`):
  background daemon, 30-min cycles, ~60 (ticker, tf) pairs/cycle sampled
  across hot-set / priority / random long-tail. Diffs SQLite vs Polygon
  canonical via `audit.audit_ticker`; on `fail_count > 0` surgically
  `DELETE`s the diverged (ticker, tf, ts) rows so next fetch repopulates
  clean. Gated on `RECONCILE_ENABLED=1` (worker pod only). Status:
  `GET /api/admin/reconciliation-status`. **This is the structural safety
  net behind every future write-path bug** — catches drift before users
  notice. Replaces "find and patch individual bug classes" with "detect
  and correct drift continuously."

- **Heals v1/v2/v3 ran one-shot on startup** (flags `.fmp_tz_heal_v1`,
  `.strict_gt_heal_v2`, `.intraday_heal_v3_60day` in DATA_DIR). v3
  cleared 60 days of legacy artifacts. Future drift handled incrementally
  by the reconciliation worker — no more mass-wipes needed.

- **Startup fingerprint line** for grep verification:
  `[startup] chart-realtime-mode: fmp_tz_fix=on yfinance_tz_fix=on heal_v1=ran-once heal_v2=ran-once heal_v3_60day=ran-once needs_fresh_post_market=on swr_refresh_interval=30s_intraday tf60_ws_streaming=on bucket_canonical=bars_fetch.bucket_60_et_unix_seconds delta_intraday_filter=>= idb_cache_logic_version=4 reconciliation_worker=on|off`

### Bars Push Feed — Phase C streaming (LIVE 100%, 2026-07-06 — CRITICAL, do not regress)

TradingView-grade continuous live bars via a Massive WebSocket **push** feed, replacing the
Finnhub 250ms SSE **poll** for the developing bar. **LIVE for all ~200 users.** Rides the ONE
shared uvicorn event loop (the 524-outage surface) — it was ramped canary→25→100% under
event-loop monitoring, held flat. Session detail: memory `project_charts_dominance_2026_07_03`.

- **Two feeds, client-side arbitration.** Finnhub poll (`priceStreamManager`, always on) +
  Massive push (`app/src/lib/barsStreamManager.js`, a BYTE-SEPARATE pool — a bug in the bars
  path can never break live prices). `useRealtimeBars.js` subscribes; `stream.py::stream_bars`
  serves `/api/stream/bars?bars=SYM:TF,…` (250ms idle sleep, named heartbeat); ingest via
  `bar_stream.py` (Massive WS) → `bar_broadcaster.py` (per-(sym,tf) queue fan-out, maxsize=64
  drop-oldest).
- **🔒 LOCKED single-writer invariant** (`StockChart.jsx`): exactly ONE developing-bar writer per
  (sym,tf). `barsPushActive = _barsPushEnabled() && eligible && liveUpdates && !heikinAshi &&
  delivering`. When true, push writer B owns the bar + `liveBarRef`/`lastBarRef`; the Finnhub
  writers early-return. **FOUR writer sites, indexed at the `barsPushActiveRef` declaration** —
  A (livePrices tick), B (onRealtimeBar), C (registry), D (post-setData re-top). **Any new
  developing-bar writer MUST consult barsPushActiveRef** (a missing guard = the Heikin-Ashi
  raw-candle bug that shipped 2026-07-06). HA is EXCLUDED from push (needs the full-series
  `toHeikinAshi()` recompute — falls back to the SWR path).
- **`delivering` is recency-gated with hysteresis** (`barsStreamManager.js`): engage when a bar
  arrived <120s ago (`BARS_LIVE_STALE_MS`), disengage only after 300s (`BARS_LIVE_DISENGAGE_MS`)
  so a thin ticker doesn't thrash push↔Finnhub. A silent-but-heartbeating feed hands the bar back
  to Finnhub within ~10s (watchdog `_notifyAllStatus`). NEVER make delivering sticky/no-recency.
- **Rollout + revert.** `export const BARS_PUSH_ROLLOUT_PCT = 100` in `StockChart.jsx` = % of
  browsers on push by default (stable per-browser bucket). Cohort narrow = lower it + deploy
  (~10min). Full backend kill = `STREAM_BARS_ENABLED=0` + redeploy. **Instant per-browser:**
  DevTools `window.__uctBarsPush(false)` (localStorage `uct.barsPush.enabled`='0'); pool kill =
  `uct.barsPool.disabled`.
- **Observability:** `GET /api/admin/bars-stream-status` (no-auth) — WS connected + subscribers +
  `bars_emitted_total`/`bars_dropped_total`/`last_emit_age_s`. Flat emitted while subscribers>0
  during RTH = "push silently dead, everyone fell back to Finnhub". Boot fingerprint:
  `[startup] bars-push-rail: …`. `tools/market_open_chart_check.py` reads the stream directly
  (the scheduled 9:45 ET agent's push-render proof).
- **Env (web pod):** `STREAM_BARS_ENABLED=1` (backend push on) · `VITE_REALTIME_BARS=1`. Deliberately
  NOT multi-worker (in-process SSE state). Deferred backlog (measure-first / insurance) in memory.

### Chart Settings System
- `app/src/components/chart/chartDefaults.js` — schema, defaults, 3 presets (Classic Dark / OLED Black / TradingView)
- `chart_settings` JSON blob stored server-side via `usePreferences` (`POST /api/auth/preferences`)
- `mergeChartSettings(userSettings)` deep-merges user prefs over defaults
- **Gear icon** in chart toolbar opens inline settings panel (chart type, colors, indicators, volume, crosshair, watermark, drawing defaults, presets, reset)
- Settings page also has a Chart Settings TileCard (mirror of toolbar panel)
- `ColorPicker` component: `app/src/components/chart/ColorPicker.jsx` — reusable swatches + hex input

### Chart Drawing Tools
- `ChartDrawingOverlay.jsx` — canvas overlay for all annotations
- `ChartToolbar.jsx` — horizontal toolbar with tool buttons + settings gear
- Tools: cursor, trendline, extended, horizontal, hray, vertical, rect, circle, arrow, fib, channel, AVWAP, text, measure
- **AVWAP**: anchored VWAP from click point forward, time-based lookup (not pixel), survives scroll/zoom
- **Repeat toggle**: keeps tool selected (repeat ON) or reverts to cursor after one drawing (repeat OFF), persisted in localStorage
- `useChartDrawings.js` — localStorage persistence per symbol
- Drawing defaults (color, width) configurable in chart settings

### Chart Header — Consistent UI Across All Surfaces
- **SymbolSearch** (`app/src/components/chart/SymbolSearch.jsx`): clickable ticker title that opens search dropdown with popular tickers + type-any-ticker
- Wired on: ThemeTrackerPage, Watchlists, CustomScan (via `onSymbolChange` prop)
- Read-only on: Breadth DrillModal, Journal TradeDrawer (contextual, symbol locked)
- **Flag button** (⚑ Flag/Flagged) on: ThemeTrackerPage, Watchlists, CustomScan, Breadth DrillModal, TickerPopup
- **Period tabs**: 5min / 30min / 1hr / Daily / Weekly (Journal: Daily/Weekly only)
- **TickerPopup**: click-to-open modal with StockChart, live price, flag, earnings intel, insider activity, position calculator. NO Finviz hover preview, NO external links

## Live Pricing

15s polling via `/api/live-prices?tickers=X,Y,Z` (Massive batch snapshot). `useLivePrices` hook + `useMobileSWR` (doubles interval on mobile, pauses on background tab). `useMarketOpen` detects session state and 10x slows polling when market closed.

## Auth & User System

- SQLite DB at `/data/auth.db` (Railway persistent volume)
- Tables: users, sessions, subscriptions, email_verifications, password_resets, activity_log, page_views, feedback, support_tickets, ticket_messages, user_tags, admin_notes, user_preferences, referrals, mrr_snapshots
- `AuthGuard` component: checks auth + email verification + plan + admin role
- **Free tier**: Dashboard, Breadth, Charts, Options Flow, Journal, Model Book accessible without payment
- `FREE_PAGES` whitelist in AuthGuard, NavBar, MobileNav — locked pages hidden from nav, redirect to `/dashboard`
- Signup flow does NOT redirect to Stripe — users land directly on dashboard after email verification
- Stripe integration still intact (checkout/portal/webhooks) for future monetization
- Admin role check: `user.role === 'admin'`; set via `ADMIN_EMAILS` env var
- Verification tokens reuse existing valid token on resend (>1hr remaining)
- Stripe webhook uses `_safe_get()` for stripe>=8.0 compatibility

## Worktree Directory

Worktrees live in `.worktrees/` (project-local, gitignored).

## Design Documents

All design docs are in `docs/plans/`. Key docs:
- `docs/plans/2026-02-22-dashboard-redesign.md` — full architecture decisions
- `docs/plans/2026-02-22-dashboard-implementation.md` — 25-task implementation plan
- `docs/plans/2026-02-22-data-pipeline-design.md` — data pipeline architecture
- `docs/plans/2026-02-22-theme-tracker-rebuild.md` — Theme Tracker rebuild (completed)

## Project Structure

```
uct-dashboard/
├── app/                        # React + Vite frontend
│   ├── src/
│   │   ├── components/
│   │   │   ├── NavBar.jsx      # Left sidebar nav
│   │   │   ├── TileCard.jsx    # Tile wrapper component
│   │   │   ├── TickerPopup.jsx # Hover preview + 5-tab chart modal
│   │   │   └── tiles/
│   │   │       ├── ThemeTracker.jsx    # Expandable ETF rows + stock chips
│   │   │       ├── MarketBreadth.jsx
│   │   │       ├── TopMovers.jsx
│   │   │       └── ...
│   │   ├── pages/
│   │   │   ├── Dashboard.jsx
│   │   │   ├── MorningWire.jsx
│   │   │   ├── UCT20.jsx       # Leadership 20 page
│   │   │   ├── Settings.jsx
│   │   │   └── ...
│   │   └── main.jsx
│   └── vite.config.js
├── api/                        # FastAPI backend
│   ├── main.py
│   ├── routers/
│   │   ├── push.py             # POST /api/push — receives wire_data from engine
│   │   └── ...
│   └── services/
│       ├── engine.py           # _normalize_themes(), get_themes(), get_leadership(), etc.
│       └── cache.py            # TTLCache (in-memory, resets on Railway redeploy)
├── data/                       # Railway volume mount point (/data) — persists across redeploys
│   └── wire_data.json          # Written by /api/push; loaded on startup to seed cache
├── tests/                      # pytest tests for backend
│   ├── test_themes_holdings.py # 5 tests for holdings/etf_name/intl_count in themes
│   └── ...
├── docs/plans/                 # Design and implementation docs
├── nixpacks.toml               # Railway build config (python312 + nodejs_20)
└── .env                        # API keys (never committed)
```

## Running Locally

```bash
# Backend
uvicorn api.main:app --reload --port 8000

# Frontend (separate terminal)
cd app && npm run dev
```

## Environment Variables

Same as morning-wire `.env`, plus:
- `FINNHUB_API_KEY`, `ANTHROPIC_API_KEY`, `DISCORD_WEBHOOK_URL`
- `MASSIVE_API_KEY`, `MASSIVE_SECRET_KEY`
- `DASHBOARD_URL` — Railway URL (`https://web-production-05cb6.up.railway.app`)
- `PUSH_SECRET` — shared secret for `/api/push` endpoint (set in Railway env vars)
- `VERCEL_TOKEN` (legacy)

## Data Pipeline

```
UCT Intelligence KB → Morning Wire Engine → wire_data.json → POST /api/push → Railway cache
                                                                                      ↓
                                                              Browser ← /api/themes, /api/leadership, etc.
```

**Engine run:** `cd C:\Users\Patrick\morning-wire && python morning_wire_engine.py`
- Takes ~7.7 min. Pushes to Railway automatically on completion.
- Windows Task Scheduler: runs daily at 7:35 AM ET (Mon–Fri), task name "UCT Morning Wire"
- Scanner (`scanner_candidates.py`) should run at 7:00 AM CT via separate Task Scheduler entry to avoid 151s inline cost
- **After any Railway redeploy, the in-memory cache resets but is seeded from `/data/wire_data.json` (Railway volume) on startup — no manual repopulation needed after the first engine run.**

**POST /api/push** (`api/routers/push.py`):
- Secured with `Authorization: Bearer <PUSH_SECRET>` header
- Stores wire_data in TTLCache (23hr TTL)
- Invalidates all derived cache keys on push
- Writes payload to `/data/wire_data.json` (Railway volume) for redeploy persistence

**Startup cache seeding** (`api/main.py` lifespan):
- On boot, loads `/data/wire_data.json` from Railway volume into cache (23hr TTL)
- Logs: `[startup] Loaded wire_data from volume (date=YYYY-MM-DD)`
- No-ops silently if volume not mounted (local dev)

## Data Sources

| Tile | Source | Refresh |
|------|--------|---------|
| Live Prices | Massive API batch snapshot (`/api/live-prices`) | 15s (30s mobile) |
| Chart Bars | Massive API primary, yfinance fallback for stale intraday (`/api/bars`) | 3-layer: memory 5-15min / disk 2-72hr / API |
| Market Snapshot | Massive API (Railway fetches live) | 15s |
| Top Movers | Massive API (Railway fetches live) | 30s |
| News | AlphaVantage (primary) + RSS fallback (live) | 30 min (AV) / 10 min (RSS) |
| Theme Tracker | Massive API bars (per-holding returns) | Daily recompute on wire push |
| UCT20 Portfolio NAV | Massive API bars + composition history | Daily recompute on wire push |
| Leadership 20 | wire_data + Claude AI + UCT KB | Daily (7:35 AM ET) |
| Morning Rundown | wire_data + Claude AI + UCT KB | Daily (7:35 AM ET) |
| UCT Exposure Rating (Breadth) | wire_data push from engine | Daily (7:35 AM ET) |
| MA Relationship Panel | Massive API live prices (SPY/QQQ) + engine push (MA %s) | 15s / Daily |
| Earnings | wire_data push from engine | Daily (7:35 AM ET) |
| Scanner Candidates | scanner_candidates.py → wire_data push | Daily (7:00 AM CT scanner + 7:35 AM ET engine push) |
| Breadth Monitor (40+ metrics) | breadth_collector.py → push to Railway | Daily (4:30 PM ET weekdays via Task Scheduler) |
| COT Data | CFTC public zips (cftc.gov) | Weekly (Friday 3:50 PM ET + retries 4:15, 4:45 if stale) |
| Sector Flow | Massive API 20-day bars for 11 SPDR ETFs | 15min cache |
| RS Rankings | Massive API 6-month bars for cap universe | 1hr cache |
| Correlation Matrix | Massive API 60-day bars (numpy corrcoef) | 1hr cache |
| Breadth Analogues | SQLite breadth_monitor history (pattern match) | 6hr cache |
| Insider Activity | Finnhub insider transactions API | 4hr per-ticker cache |
| Earnings Intel | Finnhub earnings/recommendation/price-target | 6hr per-ticker cache |

## Morning Wire CSS Architecture — CRITICAL

**`rundown_html` in wire_data contains NO `<style>` block.** It is a plain HTML fragment.
All CSS for Morning Wire rendered content MUST live in `app/src/pages/MorningWire.module.css` using `:global(.classname)` selectors.

The `ut_morning_wire_template.html` CSS only applies when the engine generates a standalone file — it does NOT reach the React dashboard.

**Key `:global()` classes already defined in MorningWire.module.css:**
`rd-regime-banner`, `rd-col`, `rd-stockbee`, `rd-exposure`, `rd-subsection-header`, `rd-subsection-label`, `rd-pick*` (all Top 5 cards)

Never add new rundown CSS classes to the template alone — always add them to MorningWire.module.css.

## Top 5 Picks — Design (2026-03-10)

- **Layout**: vertical list; each pick separated by gold `<hr class="rd-pick-hr">` lines flanking the ticker
- **Always exactly 5 picks** — AI mandated to fill all 5 slots; lower-conviction fills noted in narrative
- **No number labels** — removed from prompt template
- **Ticker** (`rd-pick-sym`): gold `#c9a84c`, 16px IBM Plex Mono, letter-spacing 2px
- **Fields** (`rd-pick-flabel`): gold — **Entry Type**, Entry, Stop, Target, Invalidation (5 fields)
  - `Entry Type`: one of `PREV DAY HIGH BREAK` / `PREV LOW RECLAIM` / `RED TO GREEN` / `BASE BREAKOUT`
  - `Entry`: exact dollar trigger — e.g. "above $47.83 (prev day high) on volume"
- **Fields**: flex row, gap 10px, label `min-width: 80px`
- **Narrative** (`rd-pick-narrative`): 12px, line-height 1.65
- **Prev day OHLC data pipeline**: scanner candidates carry `prev_day_high/low/close` from Massive API; non-scanner candidates (UCT20, gappers) filled via `yf.download()` batch in `generate_top_picks()`

CSS: `MorningWire.module.css` lines ~192–280

## Breadth Monitor — Visual System (2026-03-15)

### Files
- `app/src/pages/Breadth.jsx` — full breadth monitor + Heatmap + COT Data + Data Charts tabs
- `app/src/pages/Breadth.module.css` — all styles
- `app/src/pages/BreadthCharts.jsx` — Data Charts tab (ECharts line chart, metric selector, date range)
- `app/src/pages/BreadthCharts.module.css` — Data Charts styles
- `api/services/breadth_monitor.py` — SQLite service (get_history, store_snapshot, patch_field, delete_snapshot)
- `api/routers/breadth_monitor.py` — REST endpoints

### Color System — 8-tier background heat-map
Dark ink = extreme signal. Light tint = mild signal. Text stays uniform white.
```
.bgG3  rgba(10,50,22,0.97)    — extreme bullish (near-black green)
.bgG2  rgba(22,100,48,0.80)   — bullish (dark forest green)
.bgG1  rgba(74,222,128,0.16)  — mild bullish (light mint tint)
.bgA   rgba(180,130,20,0.32)  — caution (dark amber)
.bgR1  rgba(248,113,113,0.16) — mild bearish (light red tint)
.bgR2  rgba(160,25,25,0.80)   — bearish (dark crimson)
.bgR3  rgba(55,6,6,0.97)      — extreme bearish (near-black red)
```
`cellClass(col, val, row)` maps colorFn/rowColorFn return values ('g3'–'r3') to these classes.

### UCT Exposure Rating — 0-150 Scale (updated 2026-03-22)
Exposure lives in `wire_data["exposure"]` dict. Two fields:
- `score` — full 0-150 value (IS the recommended exposure %). Use this everywhere.
- `exposure` — legacy capped field (`min(score, 100)`). Do NOT write to DB or use in new code.

**Thresholds (colorFn in Breadth.jsx, getTier/expTier in Heatmap, scoreColor in MarketBreadth):**
`>=110 → g3 | >=90 → g2 | >=70 → g1 | >=50 → amber | >=30 → r1 | >=15 → r2 | else → r3`

**Bonus tiers** (added to base score): 5/7 conditions met → +10, 6/7 → +25, 7/7 → +50. Ceiling: 150.

**Leveraged display** (score > 100): MarketBreadth tile shows gold bar + glow + "UCT EXPOSURE — LEVERAGED" label + ★ star.

**Daily rotating phrases**: `_exposure_note()` in `morning_wire_engine.py` — 8 tiers × 10 phrases, date-seeded via `hashlib.md5(date_str)` for stable-all-day but daily rotation.

**DB write**: `market_regimes.exposure_pct` ← `exposure.get("score")` — NOT `"exposure"` (the capped legacy key).

### Breadth Monitor — tbody Column Alignment (fixed 2026-03-22)
**Root cause**: `rowSpan` in `<thead>` does NOT reserve column positions in `<tbody>` — tbody rows start fresh at column 1 regardless.

**Fix**: tbody rows use `GROUP_SPANS.flatMap(gs => ...)` instead of `visibleCols.map(col => ...)`. For collapsed groups, emit one placeholder `<td>` to hold the column position. For expanded groups, emit normal cells. Without this, collapsing any group shifts all subsequent columns left by 1.

### Column Group Order
Score → Primary Breadth → MA Breadth → Regime → Highs/Lows → Sentiment

### Regime Group Contents
S&P 500 · QQQ · VIX · 10d VIX · McClellan · Phase · Stage 2 · Stage 4

### MA Stack Shading (SPY MA / QQQ MA)
50SMA is the dividing line between green and red:
- Above 50: all 4=g3, 50+200+1short=g2, 50+200=g1, 50 only=amber
- Below 50: above 200=r1, below 200+short bounce=r2, below all=r3
Header shows two lines: label + "10  20  50  200". Cells show ✓/✗ only, spread full width.

### Heatmap Tab — `BreadthHeatmap` component inside `Breadth.jsx`

ECharts treemap rendering curated breadth metrics as color-coded tiles. Clicking a tile opens the DrillModal (same as monitor table row clicks).

**Key structures in Breadth.jsx:**
- `HM_METRICS` — array of `{ key, label, getTier(val), getFmt(val), drillKey? }` entries. `drillKey` is required for drill-down to work (maps to `_list` field in API response, e.g. `"up_4pct_today_list"`). Entries without `drillKey` are display-only.
- `HM_METRICS_BY_KEY` — `Object.fromEntries(HM_METRICS.map(m => [m.key, m]))` — lookup map used in the ECharts click handler.
- `TREEMAP_DEF` — flat array of `{ key, weight }` objects that drive which tiles render and their relative sizes.
- ECharts click handler: `onEvents={{ click: params => { const metric = HM_METRICS_BY_KEY[params.data?.name]; if (metric?.drillKey) onDrill(currentRow.date, metric) } }}`
- Tile label vertical centering requires `position: 'inside'` on the series-level label config (not just `verticalAlign: 'middle'`).

**Current tiles (20+):** breadth_score, uct_exposure, up_4pct_today, down_4pct_today, up_25pct_quarter, down_25pct_quarter, up_50pct_month, down_50pct_month, magna_up ("Up 13%/34d"), magna_down ("Dn 13%/34d"), pct_above_5sma, pct_above_10sma, pct_above_20ema, pct_above_40sma, pct_above_50sma, pct_above_100sma, pct_above_200sma, sp500_close, qqq_close, new_52w_highs, new_52w_lows, new_20d_highs, new_20d_lows.

**Color functions:** `pairedUpColor(val, max)` / `pairedDnColor(val, max)` for paired bull/bear metrics; `pctColor(low, mid, high)` for percentage metrics.

### DrillModal — Chart Tabs (updated 2026-03-21)

`DrillModal` is rendered once at `Breadth` component level, used for both monitor table clicks and heatmap tile clicks. Three chart tabs: **Daily** / **Weekly** (Finviz static PNG) / **TradingView** (iframe). Default: `'tv'`.

- `chartPeriod` state initialized to `'tv'`
- Finviz URL: `https://finviz.com/chart.ashx?t=${sym}&ty=c&ta=1&p=${period}` (period = `d` or `w`)
- Finviz images use `object-fit: contain` (full chart visible, no zoom crop)
- Preloads ±5 neighbor Finviz images on selection change via `new window.Image()`
- CSS classes in `Breadth.module.css`: `.drillChartTabs`, `.drillChartTab`, `.drillChartTabActive`, `.drillChartImgWrap`, `.drillChartImg`

### API Endpoints
- `GET  /api/breadth-monitor?days=N` — history with rolling metrics computed server-side
- `POST /api/breadth-monitor/push` — store snapshot (auth required)
- `PATCH /api/breadth-monitor/{date}/field` — surgical single-field update
- `DELETE /api/breadth-monitor/{date}` — remove a snapshot row (auth required)

---

## Key Components Built (2026-03-07 — Scanner v2 "World-Class")

### Scanner Hub (`app/src/pages/Screener.jsx` + `Screener.module.css`)
- Three tabs: **Pullback MA** (30 max) | **Remount** (10 max) | **Gappers** (10 max)
- **Alert states** (priority order): BREAKING → READY → WATCH → PATTERN → NO_PATTERN → EXTENDED → NO_DATA
- **WATCH** = two paths: (a) pattern + score≥55 + EMA rising + ema_dist≤5.5% + tight bars, or (b) no pattern but score≥65 + EMA touch + ema_dist≤4% + pole≥15% + tight bars
- **EXTENDED** = ema_dist > 8% — shown muted at bottom, not actionable yet
- **LOW_ADR** (adr<4%) and **BUYOUT_PROXY** filtered entirely from display
- **Signal chips** on each row: ADR%, prior run%, MA↑↑, EMA↑, RS↑/RS↓, ACC/DIST, EARNS date
- **Regime bar**: shows UCT Intelligence regime phase · dist days · VIX · exposure% — color-coded (red=hostile, amber=neutral, green=healthy)
- **PremarketBar**: SPY/QQQ pre-market change
- **RemountRow**: AlertBadge + candle score + signal chips (upgraded from static SetupBadge)
- 30-min polling via useSWR

### API: `get_candidates()` (`api/services/engine.py`)
- Priority: cache → `wire_data["candidates"]` → local file (`uct-intelligence/data/candidates.json`) → empty structure
- Cache TTL: 1800s (30 min)
- `_EMPTY_CANDIDATES` sentinel returned via `copy.deepcopy()` as last fallback
- Endpoint: `GET /api/candidates` in `api/routers/screener.py`
- Tests: `tests/test_candidates.py` (4 tests)
- Output dict also contains: `regime_context`, `premarket_context`, `leading_sectors_used`, `generated_at`

### UCT Scanner (`C:\Users\Patrick\uct-intelligence\scripts\scanner_candidates.py`)
- Three Finviz scans: PULLBACK_MA (30 max) · REMOUNT (10 max) · GAPPER_NEWS (10 max)
- Dedup priority: PULLBACK_MA > REMOUNT > GAPPER_NEWS
- Leading sectors from `leading_sectors.json` (operator updates daily, ~30 seconds). Add 6-8 sectors to get 25-30 pullback candidates.
- Output: `data/candidates.json` — atomic write (tmp → rename)

**Signal intelligence computed per candidate:**
- `adr_pct` — Average Daily Range % (21 bars). Hard gate: <4% → LOW_ADR, filtered.
- `pole_pct` — prior momentum: max/min in last 22 bars (% gain from trough to peak)
- `rs_trend` — RS line vs SPY over 20 bars: "up"/"flat"/"down"
- `ema_distance_pct` — % above EMA20. >8% → EXTENDED.
- `ema_touch_count` — # bars in last 15 where low ≤ EMA20 × 1.005
- `vol_acc_ratio` — avg vol on up days / avg vol on down days (last 10 bars). >1.1 = ACC, <0.85 = DIST
- `avg_body_pct` — avg body% over last 5 bars. >0.45 blocks WATCH promotion ("no wide swings" — UCT KB rule)
- `close_cv_pct` — coefficient of variation of last 10 closes. <2.5% = tight band (+10 pts), <4% = +5 pts
- `volume_n_week_low` — 20/15/10 bar volume low (4/3/2 week)
- `ma_stack_intact` — close > EMA10 > EMA20, both slopes positive
- `earnings_date` / `earnings_tod` — from UCT Intelligence `earnings_analytics` DB (next 10 days)
- `prev_day_open` / `prev_day_high` / `prev_day_low` / `prev_day_close` — from `df.iloc[-1]` of Massive OHLCV fetch (scanner runs pre-market so last bar = previous trading day)

**7-criteria candle scoring (0–110):**
| Criterion | Points |
|-----------|--------|
| EMA proximity: kiss≤0.5% / ≤2% / ≤4% / ≤6% | +25/18/10/5 |
| Volume N-week low: 4wk/3wk/2wk | +20/13/8 |
| Multi-bar body tightness (5-bar avg): <0.30/<0.40 | +15/8 |
| Close quality (last bar): >60%/>50% | +15/8 |
| Close clustering (CV of 10 closes): <2.5%/<4% | +10/5 |
| Prior momentum (pole_pct): ≥40%/≥20%/≥10% | +15/10/5 |
| Volume accumulation ratio: >1.1/>0.9 | +10/5 |

**Pattern detection (`_detect_wedge_flag`):**
- Window: last 30 bars (6 weeks), catches GFS-type long consolidations
- Requires: declining upper trendline, lows not falling faster than highs, depth 2.5-20%
- Orderliness gate: rejects patterns with any bar >2.5× avg range (no spike/panic bars)
- Returns: `pattern_type` (wedge/flag/pennant), `days_in_pattern`, `pattern_depth_pct`, `apex_days_remaining`, `orderly_pullback`

**OHLCV fetch:** 60 calendar days (~42 trading days) via Massive REST API

**UCT Intelligence integration:**
- `_fetch_earnings_risk()` — queries `earnings_analytics` DB for earnings within 10 days
- `_fetch_regime_context()` — pulls latest `market_regimes` row for dashboard regime bar

### Morning Wire Integration (`C:\Users\Patrick\morning-wire\morning_wire_engine.py`)
- Scanner block runs before `analyst.generate_rundown()` (~line 3759)
- `scanner_candidates.run_scanner()` return value stored as `_uct_candidates`
- `"candidates": _uct_candidates` added to `_wire_data` dict pushed to Railway
- Fully wrapped in try/except — never crashes the pipeline
- Engine takes ~10-11 min total (scanner adds ~5-6 min to prior ~5 min runtime)

### News Feed — RSS Fallback (`api/services/engine.py` → `get_news()`)
- Primary: AlphaVantage NEWS_SENTIMENT API (25 req/day free tier)
- Fallback: RSS feeds (CNBC, MarketWatch, Yahoo Finance, Benzinga, SeekingAlpha, PRNewswire, MotleyFool)
- AV rate-limit detection: checks for `"Information"` / `"Note"` keys in AV response
- Cache TTL: 1800s when AV works, 600s on RSS fallback (was 300s — was burning quota)
- RSS items mapped to standard news format (title→headline, time_published→time, category mapping)
- **NEVER do a partial `/api/push`** — always push full wire_data or the cache gets clobbered

## Key Components Built (2026-02-23 — session 2)

### MarketBreadth (`app/src/components/tiles/MarketBreadth.jsx`)
- Premium SVG gauge (R=72, gradient + glow), phase label with dot, 3 MA progress bars
- **% Above 5MA** (amber) — computed from yfinance S&P 500 bulk download
- **% Above 50MA** (green) + **% Above 200MA** (blue) — Finviz Elite screener
- Stat row: Dist. Days · Adv · Dec · **NH** · **NL**
- NH and NL are clickable buttons (dotted underline) → opens `NHNLModal`

### NHNLModal (`app/src/components/tiles/NHNLModal.jsx`)
- Opens on click of NH or NL count in MarketBreadth tile
- Shows full list of S&P 500 stocks at 52W highs or lows as TickerPopup chips
- Escape key closes; backdrop click closes
- Data: `new_highs_list` / `new_lows_list` arrays from `/api/breadth`

### LeadershipTile (`app/src/components/tiles/LeadershipTile.jsx`)
- Replaced EpisodicPivots on Dashboard
- Fetches `/api/leadership`, scrollable compact list: rank · TickerPopup · cap badge · RS score · thesis

### EarningsModal (`app/src/components/tiles/EarningsModal.jsx`)
- Opens on ticker click in CatalystFlow or Calendar
- Shows: sym header, BMO/AMC badge, METRIC/EXPECTED/REPORTED/SURPRISE table
- Live gap % from `/api/snapshot/{sym}`, analyst consensus + price targets from `/api/earnings/intel/{sym}`
- **Pending entries**: gold-accent preview box with `preview_text` + 3 "Things to Watch" bullets (Claude Haiku, 350 tokens)
- **Reported entries**: gold-accent analysis box with `analysis_headline` + 5 "Key Takeaways" bullets (Claude Haiku, 450 tokens JSON)
  - Covers: business health, trend consistency, market reaction, guidance, risk
  - Old paragraph `analysis` field kept for backwards compat (12h cache transition)
- **Transcript section** (reported only, collapsible): fetches `/api/transcripts/{sym}`, shows AI summary headline + sentiment pill + 5-7 bullets
  - `api/services/transcripts.py` — Finnhub transcript fetch + Claude Haiku 800-token summarization
  - Smart truncation: first 3K (CEO/CFO remarks) + last 4K (analyst Q&A), 24h cache
  - Requires Finnhub premium — section hides when unavailable
- Cache keys: `earnings_preview_{sym}` / `earnings_analysis_{sym}` / `transcript_summary_{sym}`

### Calendar — Dominant Feed + EarningsHub Competitor (rebuilt 2026-06-01/02)
`/calendar` was rebuilt from the old 2-panel table into a personalized, logo-forward
earnings hub. Full detail: `docs/superpowers/specs/2026-06-01-calendar-dominant-feed-design.md`
+ `…-calendar-phase2-competitor-design.md` (+ matching plans). Memory:
`project_calendar_dominant_feed_2026_06_01` + `project_calendar_phase2_competitor_2026_06_02`.

- **Views:** Feed (default) / Week / Month (`app/src/pages/calendar/*` + `Calendar.jsx`), view persisted via `usePreferences('calendar_view')`. Month uses `/api/calendar/month` (Finnhub range).
- **Personalization:** "My Stocks" = customizable union of watchlists + flagged + J2 positions + UCT20 (`/api/calendar/my-sets`, `calendar_personalization.py`); ⚙ source picker; audience + vol/price/mcap filters + sort (`filterLogic.js`).
- **Logos:** `CompanyLogo.jsx` → `/api/ticker-logo/{sym}` proxy-and-cache on /data volume; **logo.dev primary** source (publishable token in `ticker_logos.py`, env `LOGODEV_TOKEN`), then Parqet/FMP/Finnhub/Clearbit. ~99.5% coverage; monogram fallback (detected via `naturalWidth<=2`). Prewarmer + `POST /api/logos/prewarm[?misses=1]`, coverage in `/api/logos/status`.
- **Enrichment overlay** (`/api/calendar/enrichment`): per-sym expected move (`get_implied_move`), 4Q beat history, `hist_stats` — fetched via single `useWeekEnrichment` hook (NEVER hooks-in-loop). Live reactions per DayGroup; extended-hours via Massive `lastTrade.p`.
- **Per-ticker depth (EarningsModal):** fundamentals/fwd-PE (`/api/fundamentals`), SEC filings (`/api/filings`, free EDGAR), AI call recap + sentiment + guidance + rating changes (`call_recap.py`, Opus+Perplexity, cost-guarded), **free verbatim transcripts** (`av_transcripts.py` via AlphaVantage `EARNINGS_CALL_TRANSCRIPT`, lazy/25-day-budgeted) + keyword search + 🔊 TTS Listen.
- **Pluggable live/recorded audio** (`earnings_audio.py`): env `EARNINGS_AUDIO_PROVIDER`(`none`|`earningsapi`|`earningscall`|`quartr`) + `EARNINGS_AUDIO_API_KEY`. EarningsAPI adapter concrete (URL assumed-verify); **Quartr/EarningsCall = stubs** (Quartr needs real wiring + hls.js when contracted).
- **IPO + dividends/splits** event calendars (`ipo_calendar.py` Finnhub, `dividends_calendar.py` yfinance) as event-type chips/cards. **My Stocks hub** at `/calendar/mystocks` (Earnings/News/Calls/Filings/Insights + read-unseen via `calendar_seen.py`).
- **Alerts:** pre-report (`calendar_alerts.py`, APScheduler 7am=today / 6pm=tomorrow ET, dedup table) — gated `CALENDAR_ALERTS_ENABLED=1`. **iCal/webcal export** `/api/calendar/export.ics` + `/export-token` (HMAC(PUSH_SECRET,user_id)).
- Routers: `calendar.py` (refresh is admin-gated), `earnings_intel.py` (recap/sentiment/transcript/audio — auth-required), `fundamentals.py`, `filings.py`, `ticker_logos.py`. EarningsModal still the click-through detail.
- LOCKED invariants: enrichment endpoint must `return out` (cold-cache bug 2026-06-02); LLM features cost-guarded+cached; AV transcripts lazy-only (25/day free tier); never fetch per-card fundamentals (60-req storm — batch via enrichment if needed).

### API: Breadth (`api/services/engine.py` → `_normalize_breadth()`)
- Fields: `pct_above_5ma`, `pct_above_50ma`, `pct_above_200ma`, `advancing`, `declining`, `new_highs`, `new_lows`, `new_highs_list`, `new_lows_list`, `breadth_score`, `distribution_days`, `market_phase`

### FuturesStrip (`app/src/components/tiles/FuturesStrip.jsx`)
- Each index tile has a background sparkline SVG: linearGradient stroke, feGaussianBlur glow, fog fill polygon, last-point circle marker
- Static SPARK point arrays per symbol (pos/neg/neu variants)
- **Layout**: left 50% = index grid (QQQ/SPY/IWM/DIA/BTC/VIX), right 50% = Quote of the Day panel
- **Quote of the Day**: 392-quote library (ported from morning-wire `ut_morning_wire_template.html`) — legendary traders, stoics, UCT KB voices. Date-seeded (`seed * 97 % 392`) so quote is stable all day and jumps ~97 positions each day for variety. No backend needed — pure client-side.
- Mobile (<900px): stacks index grid above quote panel, border flips left→top

## Key Components Built (2026-02-23)

### CatalystFlow (`app/src/components/tiles/CatalystFlow.jsx`)
- 7 columns: Ticker · Verdict (BEAT/MISS pill) · EPS Est · EPS Act · EPS Surp · Rev Act · Rev Surp
- `fmtRev()` formats revenue in millions/billions: `$121M`, `$1.2B`
- Surprise % colored green (pos) / red (neg)
- BMO label: "▲ Before Market Open" — today's reporters
- AMC label: "▼ After Close · Yesterday" — yesterday's AMC reporters (already in wire_data)
- Data shape: `{ bmo: [{sym, reported_eps, eps_estimate, surprise_pct, rev_actual, rev_surprise_pct, verdict}], amc: [...] }`

### API: `_normalize_earnings()` + `_fmt_surprise()` (`api/services/engine.py`)
- `_fmt_surprise(actual, estimate)` → `"+2.7%"` / `"-5.3%"` / `None`
- Output fields: `sym`, `reported_eps`, `eps_estimate`, `surprise_pct`, `rev_actual`, `rev_surprise_pct`, `verdict`
- Max 8 entries per bucket (bmo/amc)

## Key Components Built (2026-02-22)

### TickerPopup (`app/src/components/TickerPopup.jsx`)
- Hover → Finviz daily chart preview
- Click → 5-tab chart modal:
  - `Daily` / `Weekly` → Finviz image (`chart.ashx?t={sym}&p=d|w`)
  - `5min` / `30min` / `1hr` → TradingView iframe (interval=5|30|60)
- Footer: "Open in FinViz →" + "Open in TradingView →"
- Escape key closes modal; `role="dialog"` on inner panel (not backdrop)
- Used by: ThemeTracker chips, anywhere a clickable ticker is needed

### ThemeTracker (`app/src/components/tiles/ThemeTracker.jsx`)
- Period tabs: 1W / 1M / 3M
- Leaders (green) + Laggards (red) columns
- Each row is a `ThemeRow` — click to expand (`▸` → `▾`)
- Expanded: shows ETF ticker + full name, stock chips (via TickerPopup), `+N intl` badge
- Data shape: `{ leaders: [{ticker, name, etf_name, pct, bar, holdings: [...syms], intl_count}], laggards: [...] }`

### UCT 20 (`app/src/pages/UCT20.jsx`)
- Ranked list of Leadership 20 stocks from `/api/leadership`
- Also fetches `/api/uct20/portfolio` to cross-reference open position data per card
- Card row shows: rank · NEW badge · setup badge · ticker · company · days held · current return % · UCT Rating
- **NEW badge** (green) — appears when `pos.entry_date === latestEntry` (most recent wire run date)
- **Days held / current return** — pulled from `open_positions` in portfolio data, keyed by symbol
- Expanded row: company desc · catalyst · price action · trade bar (entry/stop/target); constrained to `max-width: 50%`
- **No Refresh button** (removed 2026-03-21)

### UCT20 Portfolio Tracker (`app/src/components/tiles/UCT20Performance.jsx`)
- Fetches `/api/uct20/portfolio` (1hr refresh); shows equity curve vs QQQ, stats grid, open positions, trade history
- **Open positions row**: symbol · entry price · `stop $XX.XX` (muted red) · return % · days held
- `stop_price = entry_price * 0.94` — computed in `get_uct20_portfolio()` in `uct_intelligence/api.py`
- Subtitle: "buys/sells at market open" — all transaction prices use open price on event date
- Entry/exit events are set-difference only — stocks staying on list never re-trigger buy/sell
- Data only updates when morning wire pushes fresh `wire_data["uct20_portfolio"]`; UI gracefully hides `stop_price` if absent (null guard)

### API: _normalize_themes() (`api/services/engine.py`)
- Returns `holdings` (list of US-listed ticker strings), `intl_count` (int), `etf_name` (str)
- International tickers (e.g. FRES.L) are counted but not passed (Finviz/TV don't support them)

### MoversSidebar (`app/src/components/MoversSidebar.jsx`)
- Right sidebar showing "MOVERS AT THE OPEN"
- Fetches `/api/movers` every 30s (live, no engine push needed)
- **Gap filter:** only stocks with `abs(change_pct) >= 3.0%` are shown (filtered in backend)
- Each ticker wrapped in `TickerPopup` — hover = Finviz preview, click = 5-tab chart modal
- Data shape: `{ ripping: [{sym, pct}], drilling: [{sym, pct}] }`

### Gap Filter + Massive REST (`api/services/massive.py` → `get_movers()`)
- Calls Massive REST API directly (`https://api.massive.com`) — no local uct-intelligence dependency
- `_fmt_mover()` returns `None` for stocks below 3% threshold
- Fallback: serves movers from wire_data cache when Massive API unavailable
- Futures (NQ, ES, RTY, BTC): yfinance fallback (not in equities API)
- Cache TTL: 30s movers / 15s snapshot

### Massive.com API (`api/services/massive.py`)
- **NOT** a local package import — calls `https://api.massive.com` (Polygon.io-compatible) directly
- Uses `MASSIVE_API_KEY` env var (set in Railway + local `.env`)
- Endpoints used:
  - `/v2/snapshot/locale/us/markets/stocks/gainers|losers` — top movers
  - `/v2/snapshot/locale/us/markets/stocks/tickers/{ticker}` — single ticker snapshot
- `_MassiveRestClient` is the internal wrapper (replaces old uct_intelligence import)
- **ETFs (SPY, QQQ, IWM, DIA) are supported** — treated as equities, no special handling needed
- `MARelationship` panel (`app/src/components/tiles/MARelationship.jsx`) fetches `/api/snapshot` every 15s for live SPY/QQQ prices; MA % distances (9EMA/20EMA/50SMA/200SMA) come from daily engine push

## COT Data Tab (Breadth → COT Data tab) — Built 2026-03-14, moved under Breadth 2026-03-15

COT Data lives as the second tab on the Breadth page (`/breadth`). There is NO standalone `/screener/cot` route — it was removed. `Breadth.jsx` imports `CotData` directly and renders it when `activeTab === 'cot'`. The tab bar (Monitor | COT Data) is in the Breadth page header using `.tabs` / `.tab` / `.tabActive` classes in `Breadth.module.css`. When COT tab is active, Breadth uses `.pageCot` (padding: 0) so CotData's own padding (`20px 24px 40px`) takes over cleanly.

### Architecture
- **Database:** SQLite at `/data/cot.db` (Railway persistent volume — survives redeploys)
- **Source:** CFTC public zips — `https://www.cftc.gov/files/dea/history/deacot{YEAR}.zip`
- **Seed:** 10 years of history downloaded on first startup (background thread, daemon=True)
- **Refresh:** APScheduler CronTrigger — Friday 3:50 PM ET (`refresh_from_current()`), retries at 4:15 and 4:45 PM via `refresh_if_stale()` (skips if latest record <7 days old). Daily 6 PM ET catch-up runs if `days_old >= 8`.
- **Startup catch-up:** On boot, computes `expected = cot_service.expected_latest_report_date(now_et)` and compares against `get_latest_date()`. If `latest < expected`, fires `refresh_from_current()` in a background thread. Replaces the older `already_ran_today` heuristic — a failed early-day refresh no longer suppresses later catch-ups.
- **Request-driven self-heal:** `get_status()` invokes `_maybe_auto_refresh_if_stale()` on every call. If DB latest is older than the calendar-expected report date and we haven't auto-refreshed in 30 min (module-level `_LAST_AUTO_REFRESH_AT` cooldown), kicks off a background refresh. Any visit to the COT tab self-heals — no scheduler required. Added 2026-05-22 after the Friday scheduler silently missed its window.
- **Expected report date logic:** `expected_latest_report_date(now_et)` returns the most recent Tuesday whose following Friday has passed **4:30 PM ET** (conservative buffer past CFTC's typical 3:30 PM publish). Verified against 12 boundary cases.
- **Manual reseed:** `POST /api/cot/reseed` — triggers full 10-year re-download in background
- **Force reseed via curl:** `curl -X POST https://web-production-05cb6.up.railway.app/api/cot/reseed`

### Key Files
- `api/services/cot_service.py` — CFTC pipeline, SQLite schema, SYMBOL_MAP, seed/refresh
- `api/routers/cot.py` — 4 routes: GET /symbols, GET /status, POST /refresh, POST /reseed, GET /{symbol}
- `app/src/pages/CotData.jsx` — Chart.js mixed bar+line chart, symbol dropdown, lookback buttons (rendered inside Breadth.jsx)
- `app/src/pages/CotData.module.css` — page styles

### SYMBOL_MAP — Critical Notes
CFTC renamed many contracts around 2021–2022. The map uses OLD names (pre-2022) as primary entries for historical coverage. New names are handled via `_CFTC_ALIASES` dict which merges into `_NAME_TO_SYMBOL`. Both old and new names map to the same symbol, so all 10 years of history parse correctly.

Key renames handled by aliases:
- CL: "CRUDE OIL, LIGHT SWEET" → "WTI-PHYSICAL"
- HO: "#2 HEATING OIL- NY HARBOR-ULSD" → "NY HARBOR ULSD"
- RB: "GASOLINE BLENDSTOCK (RBOB)" → "GASOLINE RBOB"
- NG: "NATURAL GAS" → "NAT GAS NYME"
- BZ: "BRENT CRUDE OIL LAST DAY" → "BRENT LAST DAY"
- ZB/ZN/ZF/ZT/UD: old treasury note/bond names → "UST BOND", "UST 10Y NOTE", etc.
- DX: "U.S. DOLLAR INDEX" → "USD INDEX"
- B6: "BRITISH POUND STERLING" → "BRITISH POUND"
- N6: "NEW ZEALAND DOLLAR" → "NZ DOLLAR"

### Chart Scaling
- **Left Y-axis (y):** symmetric ±leftBound — computed from max absolute net position value, rounded via `roundUpNice()`
- **Right Y-axis (y2, OI line):** uses `afterDataLimits` callback — forces `min = roundDownNice(max / 4)` so OI line occupies the upper portion of the chart. Do NOT use explicit `min`/`max` props or `beginAtZero` — they get overridden by Chart.js internals.
- **Chart.js registration:** Must register BOTH `BarController` AND `BarElement` (and `LineController`/`LineElement`) for mixed charts — omitting the Controller causes "bar is not a registered controller" error.
- **ChartErrorBoundary:** Class component wrapping Chart — prevents React tree crash on chart errors.

### Symbols Available (62 total, removed: ET, NM, T6, TA, BA, RS, DL, BD)
INDICES: ES, NQ, YM, QR, EW, VI, NK
METALS: GC, SI, HG, PL, PA, AL
ENERGIES: CL, HO, RB, NG, FL, BZ
GRAINS: ZW, ZC, ZS, ZM, ZL, ZR, KE, MW, OA
SOFTS: CT, OJ, KC, SB, CC, LB
LIVESTOCK & DAIRY: LE, GF, HE, DF, BJ
FINANCIALS: ZB, UD, ZN, ZF, ZT, ZQ, SR3
CURRENCIES: DX, B6, D6, J6, S6, E6, A6, M6, N6, L6, BTC, ETH

### Data Sources Table Addition
| COT Data | CFTC public zips (cftc.gov) | Weekly (Friday 3:50 PM ET + retries 4:15, 4:45 if stale) |

---

## Theme Tracker Page — Taxonomy Redesign (updated 2026-04-15)

### Files
- `app/src/pages/ThemeTrackerPage.jsx` — full-page with sector grouping + tier filters
- `app/src/pages/ThemeTrackerPage.module.css` — styles
- `app/src/components/tiles/ThemeTracker.jsx` — dashboard tile
- `api/services/theme_performance.py` — background compute + live overlay + taxonomy enrichment
- `api/services/theme_db.py` — SQLite schema + seed from JSON
- `api/services/realtime_stream.py` — Massive/Polygon WebSocket tick-by-tick streaming
- `api/routers/stream.py` — SSE endpoint for real-time price push to browser
- `themes_taxonomy.json` — source of truth: 111 themes, 2049 holdings, 12 sectors (v4.16.0; curated + 12 new narrow themes)
- `morning-wire/morning_wire_engine.py` — reads taxonomy, fetches holdings, pushes to Railway

### Architecture
- **Hybrid taxonomy**: JSON seed file → SQLite DB on startup → API enrichment with sector/tier/sub_themes
- **111 themes across 12 sectors**: Technology, Innovation, Clean Energy, Traditional Energy, Materials, Defense & Industrials, Financials, Healthcare, Consumer, Real Estate & Utilities, Crypto, Global
- **Holdings cap**: 50 per theme (was 15), filtered by $300M market cap
- **Non-blocking compute**: memory cache → disk → `{status: "computing"}`
- **Workers**: `_MAX_WORKERS = 2` (reduced for Railway 512MB scalability)

### Theme Membership Engine (self-improving overlay · flag-gated `THEME_ENGINE_ENABLED=1` · LIVE 2026-07-20)
Autonomous AI overlay that absorbs orphan stocks (in no theme) and refines memberships as stories/RS develop. **`themes_taxonomy.json` is the inviolable owner baseline — the engine NEVER edits it.** Files: `api/services/theme_engine/` (store/orphans/improve/comovement/invalidate), `api/routers/theme_engine.py`, crons in `main.py`.
- **Writes ONLY to `engine_memberships`** (+ `engine_decisions`/`engine_membership_events`/`engine_runs`/`engine_cost_log`) in **auth.db** — a separate overlay. It physically cannot touch `theme_memberships`.
- **Merge lives inside `theme_db`'s 3 read fns** (`get_all_themes`/`get_themes_for_ticker`/`get_theme_holdings`): SQL UNION owner+engine, **owner-precedence** (owner row wins on conflict via `NOT EXISTS`), dangling-theme + suppression filters, and a `source` tag (`'owner'`|`'engine'`) on every row. ⚠️ **Aggregates are owner-only** — `groups.py` `_theme_size`/`resolve_primary_theme` and `theme_performance` §4b returns must NEVER count engine rows (they'd move sizes/returns off the owner's honest baseline).
- **Loops** (gated by the flag): Loop 1 orphans **Mon–Fri 11 PM ET** (`orphans.run_orphan_batch` — 1 grounded `claude-opus-4-8` call/orphan, visibility-scaled write gate + beat-incumbent test, 35d decision-memory re-eval, **$5/day ET-day cost cap**); Loop 2 self-improve + 30d co-movement audit **Sat 10 AM ET** (`improve.run_improve`).
- **Notifications → admin Discord** (`DISCORD_WEBHOOK_URL`, same channel as signups): DAILY digest after each nightly run (`orphans.daily_report_text` — absorbed names by theme + counts + spend) + WEEKLY report Sat (`improve.weekly_report_text`).
- **Ops** (`api/routers/theme_engine.py`, all `require_admin`): `GET /api/theme-engine/status` (run ledger + day cost), `POST .../rollback/{run_id}` (inverse-event replay), `.../dry-run`, `.../suppress/dismiss`, `.../clear-decisions` (**MANDATORY between a validation dry-run and go-live** — see router docstring).
- **Provenance in UI**: dim dot on engine-sourced Multi-Chart grid cell badges + Theme Tracker holding chips. The engine overlay survives version-gated taxonomy reseeds (separate tables).

### Real-Time Streaming
- **WebSocket**: `wss://socket.polygon.io/stocks` via `MASSIVE_API_KEY`
- **Channels**: `T.*` (tick-by-tick trades) + `AM.*` (per-minute aggregates)
- **SSE endpoint**: `GET /api/stream/prices?tickers=X,Y,Z` — pushes to browser every 100ms
- **Frontend hook**: `useRealtimePrices` — EventSource client, falls back to REST polling
- **Live candles**: `StockChart.jsx` calls `series.update()` on every tick — close/high/low/volume update in real-time
- **Coverage**: ALL components except OptionsFlow and DarkPool

### UI Features
- **Sector grouping toggle** — nest themes under sector headers
- **Tier filter** — Core / Relevant / Peripheral checkboxes
- **Search** — by theme name, ticker, sector, or holding symbol
- **Right-click TickerActions** on all holding rows (tag, flag, alert, add to list)

### Live Returns Overlay (`_apply_live_returns` in theme_performance.py)
Runs on every request (30s SWR polling). Updates all 6 periods using intraday price:
- `live_map` = `get_etf_snapshots()` → `todaysChangePerc` (a %, e.g. 1.5 = +1.5%) — cached 30s
- **1d**: uses `live_pct` directly (it IS the 1d return)
- **1w/1m/3m/1y/ytd**: derives `current_price = prev_close * (1 + live_pct/100)` where `prev_close = ref_prices["1d"]` (yesterday's official close), then `(current_price - ref) / ref * 100`
- `ref_prices` stored per holding per period during daily bar computation — no re-fetch needed
- **CRITICAL**: `live_map` values are percentages, NOT dollar prices. Computing `(live - ref_price)/ref_price` directly = -99% bug. Always derive current_price first.

### UCT20 Portfolio NAV (`api/services/uct20_nav.py`)
- Each wire push records current UCT20 holdings to `/data/uct20_compositions.json` (persists forever)
- `compute_portfolio_returns()` — loads composition history, fetches bars for ALL ever-held symbols, builds equal-weight NAV time series by chaining daily returns using PREVIOUS day's composition, returns 1d/1w/1m/3m/1y/ytd
- **Composition-aware**: stocks that rotated out still contribute their return during holding period
- Returns `None` for periods without enough history (shows "—" — fills in over ~3 weeks for 1M, ~63 days for 3M)
- `group_return` on UCT20 theme object — frontend uses it over simple avg for 1w/1m/3m/1y/ytd
- **Live 1d**: average of CURRENT holdings' `todaysChangePerc` (intraday approximation only — NAV not recomputed intraday)

### UI Features
- Period tabs: **Today/1W/1M/3M/1Y/YTD** on full page; same 6 on dashboard tile — click active tab to toggle ↑/↓ sort
- Search bar — filters by theme name, ETF ticker, or individual holding symbol; auto-expands matching groups
- Holdings sorted within each group by active period in same direction as theme list
- Arrow key navigation — moves in visual sort order, auto-expands groups, auto-scrolls
- UCT 20 shows gold ★ badge on both dashboard tile and full page (managed portfolio, not ETF-tracked)
- Right panel chart header: Daily/Weekly/TradingView tabs centered in header bar (`position: absolute; left: 50%`)

### Right Panel Chart System (2026-03-21)
Three chart modes toggled via tabs centered in the chart header. **Default: TradingView.**

- **TradingView** — full interactive iframe, no `key` prop (avoids destroy/recreate flash), src updates in place
  - `chartFrame`: `flex: 1; border: none; min-height: 0`
- **Daily / Weekly** — Finviz static PNG images (`chart.ashx?t={sym}&ty=c&ta=1&p=d|w`)
  - Instant switching: preloads ±5 neighbors on every selection change via `new window.Image()`
  - CSS: `object-fit: contain` — shows full chart image without zoom crop
  - `chartImgWrap`: `flex: 1; overflow: hidden; display: flex; align-items: center; justify-content: center`
  - `chartImg`: `width: 100%; height: 100%; object-fit: contain`

### Data Charts Tab — `BreadthCharts.jsx` (built 2026-03-21)

`app/src/pages/BreadthCharts.jsx` + `BreadthCharts.module.css`. Fetches `/api/breadth-monitor?days=365`.

**Metric picker:** `CHART_GROUPS` array — groups with `{ group, metrics: [{ key, label }] }`. Users click category buttons to expand/collapse groups and check/uncheck individual metrics. Multiple metrics overlay as line series on a shared ECharts chart.

**State:** `selected` (array of keys, default `['breadth_score', 'pct_above_50sma']`), `fromDate`/`toDate` (date range inputs), `expanded` (per-group open state).

**Dual Y-axis:** `sp500_close` and `qqq_close` → `yAxisIndex: 1` (right axis, auto-scale). All other metrics → `yAxisIndex: 0` (left axis). Color palette: 8-color array cycling via `palette[i % 8]`.

**ECharts features:** `dataZoom` (inside + slider), `tooltip` with crosshair, `connectNulls: false`, `symbol: 'none'` (no dots on line).

**Groups:** Score · Primary Breadth · MA Breadth · Regime · Highs/Lows · Sentiment

### BreadthCharts Notable Extremes (2026-03-21)
`app/src/pages/BreadthCharts.jsx` + `BreadthCharts.module.css`
- Every expanded group panel has a **⚡ Notable Extremes** button (amber, toggleable)
- `notableExtremes` state object keyed by group name; `toggleExtremes(group)` handler
- **MA Breadth only** (so far): when active, injects a markLine series into ECharts with 7 dashed reference lines:
  - Red overbought: 70 (`#fca5a5`), 80 (`#ef4444`), 90 (`#b91c1c`) — ascending intensity
  - Green oversold: 20 (`#bbf7d0`), 15 (`#4ade80`), 10 (`#22c55e`), 5 (`#15803d`) — ascending intensity
  - Series name `__ma_extremes__` excluded from legend via explicit `legend.data` array
- Other groups (Score, Primary Breadth, Regime, Highs/Lows, Sentiment): buttons are no-op placeholders pending readings to be defined later
- Active button style: amber glow (`.extremesBtnActive`)

## Model Book — Curated Library of Top Stocks (rebuilt 2026-06-02)

`/model-book` is a **curated library of the best stocks in history**, organized
by year, where clicking a stock opens its chart with the firm's playbook setups
labeled on it (markers + entry/stop/target price lines + grade + teaching notes).
Global single library (like UCT20), admin-curated, viewable by all logged-in
users (FREE_PAGE). **Replaced the old personal trade-log** (see retirement note).

### Files
- `app/src/pages/ModelBook.jsx` — year pills → stock gallery (left) → stock detail (right: StockChart + labeled setups)
- `app/src/pages/ModelBook.module.css` — two-pane styles (mirrors SetupLibrary)
- `app/src/constants/setupGroups.js` — shared `SETUP_GROUPS` / `SETUPS` / `GRADES` (lifted out of the old page)
- `api/routers/modelbook.py` — REST API (reads = `get_current_user`, writes = `require_admin`)
- `api/services/modelbook_service.py` — dashboard-OWNED SQLite store
- `/data/modelbook.db` — Railway persistent volume (NOT the uct_intelligence `model_examples` table, which is unreachable on Railway). Mirrors the cot.db / catalysts.db pattern.

### Data model (`/data/modelbook.db`)
- `modelbook_stocks(id, year, symbol, company, sector, industry, sort_order, thesis, gain_pct, created_at, updated_at, UNIQUE(year, symbol))`
  - **`sector`/`industry`** are curated watermark fields for renamed/delisted tickers. The chart watermark normally reads sector/industry from the live `/api/ticker-meta/{sym}` lookup, but for a REUSED ticker (SQ=Square→Block, WTW=Weight Watchers→Willis Towers Watson, delisted WWE) that lookup returns the WRONG company (or nothing), so `StockChart.watermarkMeta` drops it. These columns supply the historical sector/industry instead. Filled automatically by the one-shot AI description pass (`_generate_descriptions` now also returns `sector`/`industry`; `_needs_desc` fires when they're missing so existing stocks backfill on next view) using `COALESCE(NULLIF(...))` so a manual admin entry is never clobbered; also settable in the Add-Stock form. `StockChart` props: `watermarkSector`/`watermarkIndustry` (curated wins only when the curated name doesn't token-match the live company; normal stocks keep their accurate live GICS).
- `modelbook_setups(id, stock_id→stocks ON DELETE CASCADE, setup_type, label_date 'YYYY-MM-DD', timeframe, entry_price, stop_price, target_price, grade, notes, marker_side, marker_shape, created_at)`
- `label_date` is ISO TEXT so it maps 1:1 to lightweight-charts daily marker `time` (no conversion). `PRAGMA foreign_keys=ON` on every connection (cascade).

### Endpoints (`/api/modelbook/*`)
- `GET /years`, `GET /stocks?year=`, `GET /stock/{id}` (stock + setups[]) — any logged-in user
- `POST /stocks`, `PUT|DELETE /stock/{id}`, `POST /stock/{id}/setups`, `PUT|DELETE /setup/{id}` — `require_admin`
- Validation: grade∈{A+,A,B,C,F}, timeframe∈{D,W}, label_date=YYYY-MM-DD, marker enums.

### Chart integration
- Reuses `StockChart` (`tf="D"`, `liveUpdates={false}`, `entryDate=year-01-01` / `exitDate=year-12-31` to frame the calendar year).
- `markers` from setups (`{time: label_date, position: marker_side, color by grade, shape, text: "Setup Grade"}`); `priceLines` (entry/stop/target dashed) rendered for the **selected** setup only (click a setup row to switch).

### Setup taxonomy (now in `app/src/constants/setupGroups.js`)
**Swing:** High Tight Flag (Powerplay), Classic Flag/Pullback, VCP, Flat Base Breakout, IPO Base, Parabolic Short, Parabolic Long, Wedge Pop, Wedge Drop, Episodic Pivot, 2B Reversal, Kicker Candle, Power Earnings Gap, News Gappers, 4B Setup (Stan Weinstein), Failed H&S/Rounded Top, Classic U&R, Launchpad, Go Signal, HVC, Wick Play, Slingshot, Oops Reversal, News Failure, Remount, Red to Green
**Intraday:** Opening Range Breakout, Opening Range Breakdown, Red to Green (Intraday), Green to Red, 30min Pivot, Mean Reversion L/S

### Catalysts (AI-generated, marker + gold candle) — added 2026-06-03; auto-gen + bullish-only 2026-06-04
A second tab beside Setups in the right panel: the year's **top 3-5 BULLISH, stock-specific
catalysts** that ignited an UP move — earnings beats, products, partnerships, customer wins,
approvals, upgrades, M&A, guidance raises, index inclusion (NO negative/bearish events, NO
macro/market-wide catalysts). **Auto-generated once per stock, then kept forever** (no manual
click). Still admin-editable.
- **Table `modelbook_catalysts`**: `(id, stock_id→stocks ON DELETE CASCADE, catalyst_date 'YYYY-MM-DD', title, description, move_pct, sort_order, source 'ai'|'manual', created_at)`. `modelbook_stocks` gained `catalysts_at` (last generation attempt epoch — the "already attempted, don't loop" marker). Included in `get_stock_detail` as `catalysts[]`.
- **Auto-generation:** `GET /stock/{id}` fires `_gen_catalysts_async()` on first view when `_needs_catalysts()` (none yet + `catalysts_at` null-or-stale); `warm_all_stats` also pre-warms closed-year stocks via `get_stocks_needing_catalysts()`. Each stock generates **once** (success → `catalysts[]` filled; empty/fail → `mark_catalysts_attempt()` stamps `catalysts_at` so it won't retry except after the 1-day window). Frontend polls (`refreshInterval`) while `catalysts` empty + `catalysts_at` null, showing "Finding bullish catalysts…".
- **The LLM call:** `_big_up_days()` ranks the year's daily bars by **% GAIN vs prior close** (down days excluded) → top 12 up-days → Claude (`MODELBOOK_LLM_MODEL`), prompted for bullish company-specific catalysts only (explicit "no bearish, no macro" rules). Dates `_snap_trading_day()`'d to a real session (≤5d). `replace_catalysts()` swaps the set + stamps `catalysts_at`. Gated by `MODELBOOK_CATALYSTS_ENABLED`.
- **One-time policy reset:** `regen_catalysts("bullish_v1")` at startup (flag-gated, `main.py`) drops old AI catalysts + resets `catalysts_at` so everything regenerates under the bullish-only rules; manual (`source='manual'`) catalysts are preserved.
- **UI:** catalyst rows are an **accordion** — collapsed to just the headline (chevron · title · fixed-width move% column · fixed-width date column); clicking a row drops down the description AND focus-zooms the chart to that catalyst (`expandedCatalystId`, single-open). There is **no Regenerate button** (removed — generation is automatic); admins keep only **+ Add** for manual entries.
- **On the chart (Catalysts tab):** setup AND catalyst candles render **white** (Model Book passes `highlightColor="#ffffff"`; `StockChart`'s `highlightColor` default is gold, kept for other uses). A **"Show all" toggle** mirrors the setups one (`showAllCatalysts`, persisted `modelbook_show_all_catalysts`, default OFF): off → catalysts appear only when a row is clicked (focus-zoom to just that one — `focusedCatalyst`); on → all catalysts show on the zoomed-out chart. Catalyst **labels are leader-line callouts** (AmiBroker-style), NOT lightweight-charts markers: `app/src/components/chart/ChartCalloutOverlay.jsx` is a canvas overlay that places each label in the **nearest blank space** (8-direction search that tests against the visible candle pixels) with a diagonal line back to the candle, so labels never cover candles. Wired via `StockChart`'s `callouts` prop (`[{time, text}]`). Redraws via a rAF loop that samples the price→pixel mapping, so labels track smoothly during **vertical price-scale drags** too (not just horizontal pan).
- **Backend manual override:** `POST /stock/{id}/catalysts/generate` still exists and is **idempotent** (returns existing without an LLM call unless `?force=true`) but is no longer wired to any button. Plus `POST /stock/{id}/catalysts`, `PUT /catalyst/{id}`, `DELETE /catalyst/{id}`.
- **Chart**: on the Catalysts tab the chart shows gold ⚡ `markers` (StockChart `markers` prop) at each catalyst + ALL catalyst candles gold (`highlightBarTime` array) + setup overlays hidden; clicking a catalyst row focus-zooms to it. Switching tabs zooms back out to the year. Tab choice persists (`modelbook_panel_tab`) and survives stock switches.

### Earnings table — per-quarter EPS + revenue vs estimate (added 2026-06-03)
A compact table **in the info panel, top-right beside the year stats** (`styles.statsRow`: stats
column + `styles.earnPanel`; the panel is widened to 450px so the trailing % column isn't clipped),
for every stock/year. Columns: **Quarter (Q1–Q4 yr) · EPS · % Chg · Revenue ·
% Chg**, where each % Chg is the surprise vs estimate (colored green/red). (Originally a chart
overlay — `styles.earnOverlay`, removed 2026-06-03 — moved into the panel.)
- **Source:** **FMP `stable/earnings`** (`_fmp_get`; `FMP_API_KEY`) — the only live FMP earnings endpoint on this plan (legacy v3 ones 403 after Aug-2025; AlphaVantage is rate-limited 25/day; Finnhub `/calendar/earnings` symbol filter is unreliable for history). One symbol-specific call returns EPS + revenue (actual + estimated) per report. `_fiscal_q_from_report` maps each report DATE to its fiscal quarter (calendar-fiscal assumption: Jan–Mar→Q4 prev yr, Apr–Jun→Q1, Jul–Sep→Q2, Oct–Dec→Q3), keeping the book year's 4 quarters. **Deduped by (year, quarter)** via `_earn_row_preferred` — FMP sometimes has two rows for one report (e.g. SNDK 2025-11-06: consensus row + alternate figure); the estimate-bearing one wins. Falls back to Finnhub `/stock/earnings` (EPS only) if FMP is empty. Cached per (ticker, year), 30d for closed years. `earnings_estimates.get_year_earnings(ticker, year)`. **History window scales with the book year's age** (`_history_limit`): `stable/earnings` returns newest-first, so a fixed `limit` only covered recent years — an old year fell off the end (the 2016 bug: `limit=40`≈10y reached only Q3/Q4 2016 when viewed in 2026, dropping Q1/Q2). The limit is now `min(400, (now−year+2)*4 + 16)`, so every quarter of a decade-old year is reachable.
- **Diagnose:** unauthenticated `GET /api/debug/earnings-sources/{sym}` probes every FMP/AV/Finnhub earnings endpoint + dumps `stable/earnings` rows — use it to see what data actually comes back for a ticker.
- **Endpoint:** `GET /api/modelbook/year-earnings?symbol=&year=` (any logged-in user). Frontend fetches it (SWR) for every stock view; the table renders only when rows exist + the info panel is open. Read-only. The right panel stays a 2-tab Setups | Catalysts.

### Year-recap hover (added 2026-06-05)
Hovering a **year tab** pops up an AI recap of that market year — broad-market behavior, leadership themes (chips), and a 1-10 "momentum swing-trader climate" meter — so you can scan what each year was like (e.g. 1999 dot-com euphoria, 2022 rate-driven bear). Generated once, then kept forever (mirrors the catalyst/description pattern).
- **Table `modelbook_year_recaps`**: `(year PK, headline, recap, themes_json, trader_score 1-10, market_tone, recap_at, model)`. New table in `_SCHEMA` (no migration). Service: `get_year_recap` / `save_year_recap` / `mark_recap_attempt`.
- **Generation** (`modelbook.py::_generate_year_recap`): Claude (`MODELBOOK_LLM_MODEL`, temp 0.85) grounded with the year's curated leaders (symbol/company/gain/sector) + best-effort Nasdaq (^IXIC) year return & max-drawdown (`_nasdaq_year_stats`; provider history only reaches ~2006, older years lean on the model's knowledge). Prompt mandates VARIED openings/structure (no "YYYY was…", no template) and forbids naming any specific trading methodology. Returns `{headline, market_tone, trader_score, themes[], recap}`. Gated by `MODELBOOK_RECAP_ENABLED`.
- **Endpoint:** `GET /api/modelbook/year-recap?year=YYYY` (any logged-in user, 1990..current+1). Returns the recap, or `{status:'generating'}` (fires a deduped background job) on first hover, or `{status:'unavailable'}` if a recent attempt failed (client stops polling). Frontend polls every 2.5s while generating.
- **Warm:** `warm_all_stats` pre-generates recaps for curated closed years (`list_years()`); all other years generate on first hover.
- **Frontend** (`ModelBook.jsx`): `YearRecapPopover` (fixed-position, `pointer-events:none`, 220ms hover debounce) + `TraderMeter` (10 dots). Styles `.recapPop`/`.recap*`/`.meter*` in `ModelBook.module.css`.

### Tests
- Backend: `tests/test_modelbook_service.py` (create/list/detail, upsert, setup CRUD, FK cascade, catalyst CRUD + `replace_catalysts` ordering/stamp + cascade).
- Frontend: `app/src/pages/ModelBook.test.jsx` (heading, year tab + card, admin-gated add button, click→chart+setup, Catalysts tab switch + row, admin-gated Generate, permanent earnings overlay table).

### Setup Library — hub "Setups" section (starting screen shipped 2026-06-10)
The hub's **Setups** card is live: a field-guide of the firm's curated setup list
(the "ultimate setup library"). Frontend-only so far — no backend/DB yet.
- **Files:** `app/src/pages/modelbook/SetupsView.jsx` + `.module.css` (library grid +
  per-setup detail scaffold), `app/src/pages/modelbook/setupCatalog.js` (catalog data).
- **Catalog (v1, user-provided 2026-06-10):** 24 swing setups grouped into 4 families
  (Bases & Breakouts · Momentum & Trend · Gaps & Catalysts · Reversals & Reclaims).
  Most names match `constants/setupGroups.js` (the Throughout-the-Years labeling
  taxonomy); a few use fuller display names (e.g. 'U&R (Undercut & Rally)' vs
  'Classic U&R') — normalize when wiring examples to the DB. New-to-taxonomy setups:
  20 EMA Pullback, EMA Crossback, Delayed Episodic Pivot, Gap Support. Each entry:
  family, direction, one-line `essence`, hand-authored `candles` array rendered by
  `<SetupGlyph/>` as an idealized mini candlestick sketch (pure SVG; optional `pivot`
  dashed trigger line + optional `ema` period drawing a smoothed MA curve).
- **Library screen:** hero + family pills (All + 4 families) + search + grouped
  card grid (staggered cascade-in mirroring the hub cards).
- **Detail page (split view, 2026-06-11):** LEFT half = glyph hero (intro = the
  playbook's full lede when authored, else the card essence) + "The Playbook"
  dossier (`setupPlaybooks.js` — per-setup {intro, sections[{label, body, accent}],
  mistakes[]}; HTF authored first; missing setups show a placeholder). RIGHT half =
  scrollable **Charted Examples**: real `StockChart`s (year-framed, same prop recipe
  as Throughout the Years minus the index pane), gold setup candle, entry/stop/target
  lines, focus-zoom toggle, per-example admin annotate (drawings_json) / edit /
  delete + "+ Add Example" form with predictive ticker search (/api/ticker-search).
- **Examples backend:** table `modelbook_setup_examples` (in `_SCHEMA`, no
  migration; keyed by `setup_name` = frontend catalog name) + service CRUD
  (`list/get/create/update/delete_setup_example`) + endpoints `GET
  /api/modelbook/setup-examples?setup=`, `POST /setup-examples`, `PUT|DELETE
  /setup-example/{id}` (reads any user, writes admin).

### Trade-log retirement (2026-06-02)
The old personal trade log (`/api/trades` + `data/trades.json`) is **retired** —
Model Book is no longer a trade log. Following the j2_playbook deprecation idiom:
`api/routers/trades.py` + `data/trades.json` are KEPT as a rollback backup, but
`app.include_router(trades.router)` in `api/main.py` is **commented out** (the
import is left in place). No UI references `/api/trades`. Schedule the file +
data removal after ~30d of green prod.

---

## Watchlists Page — TradingView-Tier Feature Set (updated 2026-04-13)

### Files
- `app/src/pages/Watchlists.jsx` — main page (~960 lines, split-panel)
- `app/src/pages/Watchlists.module.css` — all styles (~900 lines)
- `api/routers/watchlists.py` — REST endpoints (all require auth)
- `api/services/watchlist_service.py` — SQLite CRUD + flagged shadow sync
- `api/services/watchlist_performance.py` — batch multi-period returns (ThreadPool 2 workers, 5-min cache)
- `api/services/ticker_tag_service.py` — 7-color tag CRUD + sharing
- `api/services/watchlist_alert_service.py` — price alerts + multi-channel delivery
- `api/services/watchlist_digest.py` — daily/weekly email digests
- `app/src/hooks/useWatchlistPerformance.js` — SWR hook for perf columns
- `app/src/hooks/useTickerTags.js` — SWR hook for tags + sharing
- `app/src/hooks/useWatchlistAlerts.js` — SWR hook for alerts
- `app/src/components/TickerActions.jsx` — universal right-click context menu
- `app/src/utils/alertSound.js` — 10 synthesized notification tones
- `app/src/constants/tagColors.js` — 7 color definitions

### Architecture
- **Split panel**: left 260px list panel + right StockChart panel
- **Two tabs**: My Lists | Community
- **My Lists tab**: Flagged (renameable, shareable) → Color tag auto-lists (7 colors, shareable) → User watchlists
- **Community tab**: Shared tag lists + shared watchlists + shared flagged lists
- **All lists start collapsed** — user clicks to expand

### Feature Set
- **Per-symbol notes**: pencil icon, inline textarea, auto-save on blur, read-only in community
- **Drag-and-drop reorder**: grip handle, native HTML5, `sort_order` column
- **CSV import/export**: context menu export (Symbol,Notes CSV), import modal with paste textarea
- **Performance columns**: 1D/1W/1M/3M/YTD via gear toggle, `POST /api/watchlist-performance`
- **Conditional cell colors**: deep green >5%, green >0%, red <0%, deep red <-5%
- **Sort by column**: click headers (Sym, Price, Chg%, perf periods), ▲/▼ indicators, reset button
- **Filter within list**: text search input in column header row
- **Column presets**: Price View / Performance / Short-Term one-click buttons
- **7-color tags**: Green/Blue/Orange/Red/Purple/Gold/Teal with auto-lists, shareable to community
- **Star selection + bulk remove**: star icon per row, right-click "Remove starred (N)"
- **Right-click context menu**: rename, copy list, export CSV, import tickers, remove starred
- **Per-symbol alerts**: bell icon → popover (above/below + price), multi-channel delivery
- **Flagged list**: renameable, shareable, server shadow sync with debounced localStorage

### Universal Ticker Actions (TickerActions.jsx)
Right-click any ticker ANYWHERE in the dashboard → context menu with:
- Flag/Unflag
- 7-color tag swatches
- Add to any watchlist
- Set price alert (above/below + price)
Covered surfaces: TickerPopup (12+ components), OptionsFlow, DarkPool, TradeDrawer, TradeLog

### Alert System
- **Multi-channel**: AlertBell (in-app) + email (Resend) + Discord webhook + browser notification + sound
- **Alert checker**: piggybacks on 15s live price polling, non-blocking lock
- **10 alert sounds**: Chime, Bell, Ding, Double Tap, Triple Pop, Radar, Urgent, Soft, Pulse, Major Chord
- **Browser notifications**: Notification API, permission requested on first bell click
- **Settings**: sound on/off, sound type selector with preview, browser notification enable

### API Endpoints
- `GET/POST/PUT /api/watchlists/flagged/*` — flagged shadow CRUD + share + rename + sync
- `GET/POST/PUT/DELETE /api/watchlists/{id}/*` — watchlist CRUD + items + notes + reorder + bulk
- `POST /api/watchlist-performance` — batch returns `{tickers: [...]}` → `{SYM: {1d,1w,1m,3m,ytd}}`
- `GET/POST/DELETE /api/ticker-tags` — tag CRUD + batch + shared + public
- `GET/POST/DELETE /api/watchlist-alerts` — price alert CRUD
- `GET/PUT /api/watchlists/digest-settings` — email digest frequency

### DB Tables
- `watchlists` — id, user_id, name, description, is_public, is_flagged_list, created_at, updated_at
- `watchlist_items` — id, watchlist_id, sym, notes, sort_order, added_at
- `ticker_tags` — id, user_id, sym, color, created_at (UNIQUE user_id+sym)
- `watchlist_alerts` — id, user_id, sym, target_price, direction, is_active, triggered_at, created_at

### Scalability (tested for 100s of concurrent users)
- TTLCache bounded with LRU eviction (max 500 entries)
- ThreadPoolExecutor reduced to 2 workers
- Alert checker: direct call with non-blocking lock (no thread spawn per request)
- Flagged sync: batch SQL via executemany()
- Hooks: defensive fetchers (check r.ok before r.json())

### Flag Support — Coverage
Right-click context menu (TickerActions) on every ticker surface across entire dashboard.
Tag dots visible on: TickerPopup, ThemeTracker, CustomScan, Screener, OptionsFlow, DarkPool, Journal.

## Trade Journal — Elite Review System (2026-03-28)

### Files
- `app/src/pages/journal/Journal.jsx` — main page with 7-tab interior navigation
- `app/src/pages/journal/Journal.module.css` — all journal styles
- `app/src/pages/journal/TradeDrawer.jsx` — 480px right-side trade detail drawer (6 tabs)
- `app/src/pages/journal/OverviewTab.jsx` — KPI dashboard + review shortcuts
- `app/src/pages/journal/TradeLogTab.jsx` — filterable trade table
- `app/src/pages/journal/DailyNotesTab.jsx` — per-day structured journal entries
- `app/src/pages/journal/CalendarTab.jsx` — visual calendar with daily P&L heatmap
- `app/src/pages/journal/AnalyticsTab.jsx` — breakdowns by setup, symbol, day, session, etc.
- `app/src/pages/journal/PlaybooksTab.jsx` — setup definitions + linked performance
- `app/src/pages/journal/ReviewQueueTab.jsx` — guided incomplete-work surface
- `api/services/journal_service.py` — SQLite service (CRUD, stats, analytics, insights)
- `api/services/journal_screenshots.py` — WebP upload/serve (Pillow, same as avatar system)
- `api/routers/journal.py` — REST endpoints (all require auth)

### Architecture
- **7-tab interior navigation** (horizontal tab bar inside `/journal` page): Overview | Trade Log | Daily Notes | Calendar | Analytics | Playbooks | Review Queue
- **Trade detail drawer**: 480px right-side slide-over (full height), preserves log context. 6 interior tabs: Summary+Chart | Executions | Process | Notes+Screenshots | Mistakes | Related
- **Review status state machine**: `draft → logged → partial → reviewed → flagged/follow_up`. Auto-computed on save based on field completeness. Users can manually flag/unflag.
- **Screenshots**: stored at `/data/journal_screenshots/` on Railway volume. Named `{user_id}_{trade_id}_{slot}_{uuid}.webp`. Pillow converts to WebP. Max 5 per trade, max 2MB per upload. Slots: pre_entry, in_trade, exit, higher_tf, lower_tf.
- **Guided review**: progress indicators + smart prompts (not modal wizards). Review queue surfaces incomplete trades/days. Trade drawer shows completion checklist. Daily notes use structured template.

### Data Model
- **Expanded `journal_entries`** (25+ new columns): account, asset_class, strategy, playbook_id, tags, mistake_tags, emotion_tags, entry_time, exit_time, fees, shares, risk_dollars, planned_r, realized_r, thesis, market_context, confidence (1-5), process_score (0-100), outcome_score, ps_setup/ps_entry/ps_exit/ps_sizing/ps_stop (each 0-20), lesson, follow_up, review_status, review_date, session, day_of_week, holding_minutes
- **`trade_executions`**: scale-in/out events per trade. Types: entry, add, trim, exit, stop. Parent entry_price/exit_price computed as VWAP when executions exist.
- **`journal_screenshots`**: per-trade image uploads with slot labels and sort order
- **`daily_journals`**: per-day structured entries — premarket_thesis, focus_list, a_plus_setups, risk_plan, market_regime, emotional_state, midday_notes, eod_recap, did_well, did_poorly, learned, tomorrow_focus, energy_rating (1-5), discipline_score (0-100)
- **`weekly_reviews`**: per-week summaries — best/worst trade, top setup, worst mistake, wins/losses, net P&L, avg process score, reflection, key lessons, next week focus
- **`playbooks`**: setup definitions with trigger criteria, entry/exit models, sizing rules, common mistakes, best practices. Denormalized trade_count, win_rate, avg_r.
- **`journal_resources`**: checklists, rules, templates, psychology notes, plans. Categories: checklist, rule, template, psychology, plan.
- **Process scoring**: 5 dimensions × 0-20 = 0-100 composite (setup quality, entry quality, exit quality, sizing discipline, stop discipline)
- **Mistake taxonomy**: 17 default mistakes (overtrading, FOMO, chasing, early_exit, late_entry, no_stop, oversized, countertrend, revenge, ignored_thesis, added_to_loser, cut_winner, broke_loss_rule, broke_size_rule, broke_checklist, boredom, hesitation) + custom tags via comma-separated field
- **Emotion tags**: 15 options (confident, anxious, greedy, fearful, calm, frustrated, euphoric, bored, disciplined, impulsive, patient, rushed, focused, distracted, revenge-driven)

### API Endpoints
- `GET /api/journal` — list trades with expanded filtering (status, review_status, symbol, setup, playbook_id, direction, asset_class, date range, tags, mistake_tags, session, day_of_week, has_screenshots, has_notes, has_process_score, min/max R, min/max P&L, sort, pagination)
- `GET /api/journal/stats` — aggregate stats (enhanced)
- `GET /api/journal/calendar?month=YYYY-MM` — per-day trade_count, wins, losses, net P&L, avg process score, review statuses, mistake/screenshot counts
- `GET /api/journal/review-queue` — trades/days needing review
- `GET /api/journal/analytics?group_by={dimension}` — breakdowns by setup, playbook, symbol, direction, asset_class, day_of_week, session, mistake_tag, emotion_tag, holding_period_bucket, process_score_bucket, month, week. Returns per-bucket: trade_count, win_rate, avg_pnl_pct, total_pnl_pct, avg_r, profit_factor, avg_process_score
- `GET /api/journal/insights?limit=N` — up to 12 pattern-derived coaching statements; each has `category` (performance/process/psychology/risk), `trend` (improving/worsening/stable/null), `priority`, `statement`, `evidence`, `action_label`, `action_type`
- `GET /api/journal/psychology?days=N` — psychology time-series data: `process_trend` (date→avg_process), `emotion_by_week` (week→emotion counts), `emotion_outcomes` (emotion→avg_pnl/win_rate/trade_count), `mistake_trend`. Route registered BEFORE the `/{entry_id}` wildcard to avoid shadowing. `days` bounded: `Query(default=90, ge=1, le=730)`.
- `GET /api/journal/taxonomy` — mistake + emotion tag libraries
- `POST/PUT/DELETE /api/journal/{id}` — trade CRUD
- `POST/GET/DELETE /api/journal/{id}/screenshots` — screenshot management
- `GET/PUT /api/journal/daily/{date}` — daily journal (auto-creates on first access)
- `GET/PUT /api/journal/weekly/{week_start}` — weekly review (auto-populates computed fields)
- `GET/POST/PUT/DELETE /api/journal/playbooks` — playbook CRUD
- `GET /api/journal/playbooks/{id}/trades` — trades linked to playbook
- `GET/POST/PUT/DELETE /api/journal/resources` — resource CRUD (by category)

### Psychology Timeline (Analytics tab — 2026-05-04)

- **Trigger**: selecting the "Psychology" dimension chip in Analytics tab renders `PsychologyTimeline` instead of the standard dimension results
- **Component**: `app/src/pages/journal/tabs/PsychologyTimeline.jsx` + `PsychologyTimeline.module.css`
- **Service**: `api/services/journal_psychology.py` — `get_psychology_data(user_id, days)` returns dict with `process_trend`, `emotion_by_week`, `emotion_outcomes`, `mistake_trend`. Uses project TTLCache; returns shallow copies to prevent cache mutation.
- **3 panels**: (1) Process Score Trend — line chart with visualMap piecewise colouring (≤30=red, 30-70=amber, >70=green) + markLines at 30/70; (2) Emotional State by Week — stacked bar, top 8 emotions by frequency; (3) Avg P&L by Emotional State — horizontal bar, emotions with ≥3 trades only
- **Period selector**: 30D / 90D / 180D / All (independent from the outer Analytics period)
- Analytics.jsx period selector is hidden when Psychology dimension is active (avoids dead UI + spurious API calls)

### Coaching Feed — Category-Grouped Insights (Overview tab — 2026-05-04)

- **InsightCard** (`app/src/pages/journal/components/InsightCard.jsx`): now shows a coloured category badge (performance=blue, process=amber, psychology=purple, risk=red) and a `TrendArrow` component (▲ Improving / ▼ Worsening / → Stable — only renders for known values, null for unrecognized)
- **Overview.jsx**: fetches `/api/journal/insights?limit=12`; renders insights grouped by category with `.insightGroupHeader` labels. Uncategorized/unknown-category insights fall through to a backward-compat section. `handleInsightAction` is a single `useCallback` mapping `action_type` → tab name via lookup object.
- **`journal_insights.py`**: 12 insight functions total — 8 existing (now with `category`/`trend` fields) + 4 new: `_insight_emotion_outcome` (psychology), `_insight_process_trend` (process, detects improving/worsening), `_insight_discipline_consistency` (psychology), `_insight_mistake_recurrence` (process). `collections.Counter/defaultdict` imported at module level. `daily_journals` query runs after early-return guard.

### StockChart Integration
- Trade detail Summary tab embeds `StockChart` component (Lightweight Charts v5)
- **Entry marker** (green BUY arrow) at entry price/date
- **Exit marker** (red SELL arrow) at exit price/date (if closed)
- **Stop price line** (dashed red horizontal) + **target price line** (dashed green horizontal)
- **Scale-in/out markers** (smaller arrows at execution prices) for all `trade_executions` events
- Default zoom: centers on holding period with 20 bars context each side
- Reuses existing `StockChart` component + `/api/bars/{ticker}` endpoint + same `markers`/`priceLines` props as UCT20

### Design Tokens
- Follows existing CSS variable token system
- **Review status pills**: draft=`--color-text-muted`, logged=`--color-info` (blue), partial=`--color-warning` (amber), reviewed=`--color-success` (green), flagged=`--color-danger` (red), follow_up=purple
- **Process score gradient**: red (0-30) → amber (31-60) → green (61-100)
- **Mistake tags**: red-tinted chips
- **Emotion tags**: blue-tinted chips

---

## FeedbackWidget — Top-Right ? Button (2026-03-27)

- **Location**: `app/src/components/FeedbackWidget.jsx`
- **Position**: fixed top-right (top: 10, right: 14), 24×24px (was 48×48 bottom-right)
- **Click → dropdown menu** with two options:
  - 💬 Send Feedback → opens existing star-rating + message form (posts to `/api/auth/feedback`)
  - 🎫 Support Ticket → navigates to `/support`
- Backdrop click closes menu/form; Escape not wired (backdrop handles it)

## Morning Wire — Per-Segment Feedback (votes + notes)

Owner/users rate the brief on the MorningWire tab. **The rundown is
`dangerouslySetInnerHTML`, so feedback controls are DOM-injected into the rendered
HTML (NOT React components)** via a `useEffect` + one delegated click handler in
`app/src/pages/MorningWire.jsx`.

- **Surfaces:** 👍/👎 **and** a `✎` note button on each `section.rd-seg` label, plus an
  overall "Feedback on the whole brief" bar appended after the monologue. Clicking `✎`
  opens an inline `<textarea>` → **Save note**. Notes can be left with or without a thumb.
- **Hydration:** on load, `GET /api/wire-feedback/mine?date=` pre-fills the user's existing
  votes + notes; the `✎` glows gold (`.rd-fb-note-has`) when a segment has a note. CSS lives
  in `MorningWire.module.css` (`:global(.rd-fb*)`, `.rd-overall-fb`, `.rd-note-*`).
- **Backend:** `api/routers/wire_feedback.py` + `api/services/wire_feedback_store.py`
  (`/data/wire_feedback.db`). `POST /api/wire-feedback` takes optional `verdict`
  (`up`/`down`) and/or optional `note` (≤2000 chars; **partial-merge upsert** — a note never
  clobbers an earlier thumb and vice-versa; note-only rows store verdict `''`). Segment text is
  snapshotted at write time. `GET /api/wire-feedback/recent-internal` (PUSH_SECRET bearer)
  returns admin votes **+ notes** to the engine.
- **Consumption:** the morning-wire nightly `wire_critic.py` pulls admin feedback; **notes are
  explicit owner directives that bypass the min-votes gate and outweigh the thumbs** → distilled
  into `wire_prompt_config` that `generate_rundown` reads back. Round-trip: a note shifts the
  next morning's brief. (See morning-wire CLAUDE.md "Wire-Critic — owner notes".)
- **Deferred:** voice dictation in the note box (mounting React `VoiceInputButton` into
  injected innerHTML is disproportionate; textarea-only for v1).

## Support Chat — UX (2026-03-27)
- **Enter** sends reply in the reply textarea
- **Shift+Enter** inserts newline
- File: `app/src/pages/Support.jsx` line ~340

## Twitter News Ingestion (built 2026-05-25)

Single-stock catalyst news from a curated set of TwitterAPI.io accounts, surfaced inline on MoversSidebar (🐦 icon + new "ON THE TAPE" section) and inside EarningsModal (Recent tweets card). Designed for morning watchlist building from overnight + pre-market catalysts.

### Architecture
- **Database:** SQLite at `/data/tweets.db` (web service Railway volume, WAL mode). 7-day rolling retention.
- **Source:** TwitterAPI.io REST. Single `x-api-key` header, `$0.15 / 1K tweets` pay-as-you-go pricing, `since_id` pagination minimizes spend.
- **Scheduler:** APScheduler in `api/main.py` next to COT — burst (every 2min Mon–Fri 4–9:30am ET + 3:30–7pm ET), regular (every 15min 10am–3:15pm), slow safety-net (every hour always), cleanup (3am ET daily). All gated by `TWITTERAPI_IO_ENABLED=1`.
- **No worker/R2 bridge** — bars uses one because of write-side cost; tweets are small enough to run inline on the web service.

### Files
- `api/services/twitterapi_io.py` — HTTP client with structured exceptions (`TwitterApiAuthError` · `PaymentRequired` · `RateLimited` · `TransientError`).
- `api/services/tweet_ticker_extract.py` — cashtag regex (`\$[A-Z]{1,5}\b`) + forex exclude.
- `api/services/tweet_store.py` — SQLite CRUD (tweets, ticker links, accounts, poll-state). Uses `contextlib.closing` on every connection so Windows teardown doesn't hold WAL sidecars open.
- `api/services/tweet_poller.py` — per-account fetch + extract + store. Defensive against every TwitterApi* exception class so one bad account never kills the cron tick.
- `api/services/tweet_cleanup.py` — retention sweep (TWEET_RETENTION_DAYS env, default 7).
- `api/routers/tweets.py` — `GET /api/tweets/ticker/{sym}`, `GET /api/tweets/tape` (excludes current movers), `GET /api/tweets/has-tweets-batch`. All logged-in via `get_current_user`.
- `api/routers/admin_twitter.py` — admin CRUD on accounts + `GET /api/admin/twitter-stats` with `_maybe_auto_refresh_if_stale` self-heal mirroring COT (30-min cooldown).
- `app/src/components/MoversSidebar.jsx` — 2-col RIPPING/DRILLING grid + new full-width ON THE TAPE section + 🐦 icon on rows with tweets.
- `app/src/components/tiles/EarningsModal.jsx` — Recent tweets section between AI analysis and transcript.
- `app/src/components/admin/TwitterAccountsPanel.jsx` — admin-only panel on `/admin` page (slotted between Section 6b Admin Tools and Section 7 System Health).
- `app/src/utils/timeAgo.js` — shared relative-time helper (extracted from `AlertBell.jsx`; AlertBell now imports `timeAgoShort` for backward-compatible "now/5m/2h" output).
- `app/src/hooks/{useTickerTweets,useTapeFeed,useBatchTweetCounts}.js` — SWR fetchers.
- `tools/twitterapi_io_smoke_test.py` — pre-flight key validation script (manual run).
- `tools/seed_twitter_accounts.py` — one-shot to insert the initial curated list.

### Env vars
- `TWITTERAPI_IO_API_KEY` — required for polling.
- `TWITTERAPI_IO_ENABLED=1` — master switch for the scheduler block AND the lifespan DB-init. Set to enable polling.
- `VITE_TWITTER_UI_ENABLED=1` — frontend kill-switch (default ON; "0" hides 🐦 icons + ON THE TAPE + EarningsModal tweets section).
- `TWEET_RETENTION_DAYS=7` (default 7).
- `TWEET_POLL_TIMEOUT_SECONDS=10` (default 10).
- `TWEET_DB_PATH=/data/tweets.db` (override for local testing).

### Cashtag extraction
v1: regex-only on `\$[A-Z]{1,5}\b`, minus forex pairs (USD/EUR/GBP/JPY/CAD/AUD/CHF/CNY/HKD/NZD). Crypto kept (BTC/ETH/SOL). No universe validation — source accounts are professional. False positives surface nothing because they don't join to any movers/earnings ticker.

### Curated accounts (v1)
`@DeItaone`, `@FinancialJuice`, `@Benzinga`, `@WallStEngine` — admin-editable via the Twitter Accounts panel on `/admin`. Confirm `WallStEngine` vs `WallStreetEngine` via the smoke test before seeding production.

### Spec + plan
- Spec: `docs/superpowers/specs/2026-05-25-twitter-news-ingestion-design.md`
- Plan: `docs/superpowers/plans/2026-05-25-twitter-news-ingestion.md`

### Cost forecast
$13–22/mo at the curated 4-account list × burst cadence. `since_id` filtering keeps each poll's billable count to "what's new since last poll." Live MTD cost surfaces in `/api/admin/twitter-stats`.

## Stock Catalysts (built 2026-05-25 → 2026-05-26, multi-tier expansion)

Pre-market intelligence engine: pulls candidates from 8 sources, composite-scores them, picks the top 20 with a forced 10/5/3/2 category mix, uses Claude Opus 4.7 to synthesize 2–3 sentence catalyst descriptions, surfaces as a full-width tile titled "🎯 STOCK CATALYSTS" at the top of Dashboard. Multi-channel alerts when watchlist tickers surface. Full historical browser at `/catalysts/history`.

Originally spec'd as "Morning Catalyst Table"; renamed to "Stock Catalysts" since it stays useful throughout the trading day.

### Architecture
- **Primary DB:** `/data/catalysts.db` (web service Railway volume). Indefinite retention. Tables: `catalysts` (one row per ticker per day with rank/score/tag/price/gap_pct/vol_x/sector/market_cap/thesis_*/catalyst_at/raw_signals), `catalyst_cost_log` (per-call cost telemetry), `catalyst_alerts_fired` (alert dedup, PK on user_id+ticker+market_date).
- **Metadata cache DB:** `/data/catalyst_metadata.db` — yfinance-backed sector/market_cap/avg_volume_30d cache, 24h TTL, lazy-init via `_ensure_init()` on first use.
- **Synthesis:** Claude Opus 4.7 via `api/services/engine._get_anthropic_client()`. Haiku fallback on Opus 5xx. SHA1 skip-if-stable hash of source signals reuses prior thesis when inputs unchanged (~$0 on quiet days).
- **Scheduler:** APScheduler in `api/main.py` next to COT + Twitter — 5min burst pre-market (4–9:30 AM ET) + open + close + AMC, 30min midday, hourly safety net. Gated on `CATALYST_ENGINE_ENABLED=1`.
- **Cost cap:** $8/day soft (logs warning), $15/day hard (disables synthesis for remainder of day). Per-call USD recorded in `catalyst_cost_log`.

### Sources (8 parallel pulls)
1. Massive movers (gainers/losers) — `massive.get_movers()`
2. Massive batch snapshot (price, today_volume, prev_close, day_open, change_pct) — `_get_client().get_batch_rich_snapshots()`
3. yfinance ticker metadata (sector, market_cap, avg_volume_30d) — `ticker_metadata.get_metadata_batch()`, cached 24h
4. Earnings (EW + Finnhub today BMO + yesterday AMC) — `engine.get_earnings()`
5. Tweet store (curated 4 accounts + Twitter advanced_search per top-20) — `tweet_store.tape()` + `twitterapi_io.search_tweets()`
6. RSS news (CNBC, MarketWatch, Yahoo, Benzinga, etc.) — `news_aggregator.fetch_rss_news()`
7. UCT scanner candidates — `engine.get_candidates()`
8. **Perplexity discovery** — three query variants in `_pull_perplexity_discovery()`:
   - **A1 (always-on):** "top 15 catalyst movers right now" — runs every refresh
   - **D1 (4–9:30 AM ET):** "biggest pre-market movers + why"
   - **F1 (4–8 PM ET):** "what catalysts are setting up for tomorrow's open"

### Per-candidate enrichment (after top-20 selection, before synthesis)
- **Twitter advanced_search** per top-20 — broadens beyond curated 4 accounts. Skipped when candidate already has ≥5 curated-account tweets.
- **Perplexity fallback** for zero-signal candidates ("what's the catalyst for $XYZ today?") — `engine._enrich_with_perplexity`
- **Perplexity earnings deep-dive** for Earnings-tagged rows (guidance + sell-side reaction + PT changes) — `engine._enrich_earnings_with_perplexity`
- **Perplexity top-3 deep context** for highest-scored rows (peer reaction + historical comparables + key levels) — `engine._enrich_top_3_with_deep_context`. Skipped when row already source-rich (>5 tweets + >2 RSS).
- **Perplexity sector framing** when 3+ selected candidates share a sector — `engine._compute_sector_context`, results in module-level cache `_SECTOR_CONTEXT_BY_DATE`, exposed via `get_sector_contexts()`, surfaced as banner in tile

### Scoring + tagging + selection
- **Score** (`scoring.py`): `gap_pct + log(vol_x)*15 + tweets*5 + rss*8 + earnings_reported*20 + scanner_setup*12 + sector_momentum*5 − penny_penalty`. All weights env-overridable via `CATALYST_SCORE_W_*`.
- **Tag** (`tagging.py`): deterministic Earnings > Catalyst (2+ tweets or 1+ rss) > Gapper (5%+ abs gap + 3+ vol_x) > News.
- **Selection** (`selection.py`): forced quotas 10 Catalyst / 5 Earnings / 3 Gapper / 2 News = 20 rows. Redistributes empty buckets to next-highest leftovers. Env-overridable via `CATALYST_QUOTA_*`.
- **gap_pct** preference: snapshot change_pct (live intraday) → movers feed → 0.0. (Frontend overlays live tick-by-tick from useLivePrices, so stored gap_pct is mostly synthesis-time fallback.)

### Alerts (catalyst-triggered)
- After each refresh, `_fire_catalyst_alerts(top_20, market_date)` reads all user watchlists from auth.db (watchlists + watchlist_items joined on user_id).
- Intersection of top-20 tickers × user watchlist tickers → fires multi-channel alert via existing `watchlist_alert_service.deliver_alert_payload` (AlertBell + email + Discord).
- Dedup via `store.try_record_alert(user_id, ticker, market_date)` — atomic INSERT OR IntegrityError pattern, one alert per (user, ticker, day) max.
- Gated on `CATALYST_ALERTS_ENABLED=1` (default ON).

### Files (backend)
- `api/services/catalyst/sources.py` — parallel pulls + Perplexity discovery (3 queries)
- `api/services/catalyst/scoring.py` — composite formula, env-tunable
- `api/services/catalyst/tagging.py` — deterministic tag assignment
- `api/services/catalyst/selection.py` — 10/5/3/2 quota selector (function name still `select_top_12` for backwards compat)
- `api/services/catalyst/cost_guard.py` — Opus/Haiku pricing + daily caps
- `api/services/catalyst/synthesize.py` — Opus call + skip-if-stable + Haiku fallback + JSON validation + "no clear catalyst" enforcement
- `api/services/catalyst/store.py` — SQLite CRUD (catalysts + catalyst_cost_log + catalyst_alerts_fired)
- `api/services/catalyst/ticker_metadata.py` — yfinance-backed sector/cap/ADV cache (own SQLite at /data/catalyst_metadata.db)
- `api/services/catalyst/engine.py` — orchestrator + Perplexity enrichment functions + alert firing + sector context cache
- `api/services/twitterapi_io.py` — adds `search_tweets()` for advanced_search endpoint
- `api/routers/catalysts.py` — `GET /api/catalysts/today` (includes sector_contexts), `GET /api/catalysts/by-date/{ymd}`, `GET /api/catalysts/explain/{sym}`, `POST /api/catalysts/refresh` (admin), `GET /api/admin/catalyst-stats`

### Files (frontend)
- `app/src/components/tiles/CatalystTable.{jsx,module.css}` — 7-col table (Sym/Price/%Change/Vol×/Tag/Catalyst/When) with sortable headers, tag chip filter, ★ watchlist highlight, ⓘ citations popover, 🔎 Why-isn't-X widget, sector context banners
- `app/src/utils/highlightThesis.jsx` — renders **bold** markdown + gold cashtags + colored ± pct + bold $amounts
- `app/src/utils/timeAgo.js` — adds `formatET(ts)` for absolute ET timestamps ("9:32 AM EDT" same-day, "May 25, 9:32 AM EDT" earlier days)
- `app/src/hooks/useCatalysts.js` — SWR poll /api/catalysts/today every 30s
- `app/src/hooks/useUserTickerSet.js` — combines useFlagged + /api/watchlists into a Set for ★ highlight matching
- `app/src/pages/CatalystsHistory.{jsx,module.css}` — `/catalysts/history` route, date picker + quick-jump (Today / Yesterday / 1 week / 30 days), reads `GET /api/catalysts/by-date/{ymd}`
- Live data overlay via existing `useLivePrices` (2s SWR poll); falls back to stored values when live data loading or ticker outside live-prices universe

### Env vars
- `CATALYST_ENGINE_ENABLED=1` — master switch for scheduler
- `CATALYST_OPUS_MODEL=claude-opus-4-7` (default)
- `CATALYST_HAIKU_FALLBACK_MODEL=claude-haiku-4-5` (default)
- `CATALYST_COST_CAP_DAILY=8.00` (USD; soft cap)
- `CATALYST_COST_HARD_CAP=15.00` (USD; hard cutoff)
- `CATALYST_PRICE_FLOOR=2.00` (below this, score penalty)
- `CATALYST_QUOTA_CATALYST=10` / `_EARNINGS=5` / `_GAPPER=3` / `_NEWS=2` — forced 20-row mix
- `CATALYST_SCORE_W_*` — scoring weight overrides
- `CATALYST_TWITTER_SEARCH_ENABLED=1` — toggle Twitter advanced_search enrichment per top-20
- `CATALYST_PERPLEXITY_ENABLED=1` — toggle all 6 Perplexity uses (discovery + pre-market + EOD + fallback + earnings + top-3 + sector)
- `CATALYST_ALERTS_ENABLED=1` — toggle watchlist-match alert firing
- `CATALYST_METADATA_DB_PATH=/data/catalyst_metadata.db` (override for local)
- `VITE_CATALYST_UI_ENABLED=1` — frontend kill-switch

### Cost forecast (with all Perplexity enrichments active)
- Synthesis (Opus 4.7): ~$2-4/day (skip-if-stable keeps quiet days near $0)
- Perplexity (~10–15 queries/refresh average): ~$60-70/mo
- Twitter advanced_search: ~$10-20/mo
- All-in: ~$80-100/mo at full activity. Hard cap stops Opus at $15/day.

### Schema (catalysts.db)
```sql
CREATE TABLE catalysts (
  market_date, ticker, rank, score, tag, price, gap_pct, vol_x, market_cap, sector,
  thesis_text, thesis_model, thesis_at, thesis_sources, signals_hash,
  catalyst_at,           -- earliest source-signal time (true "when did the catalyst occur")
  raw_signals,           -- full JSON of source inputs at synthesis time
  PRIMARY KEY (market_date, ticker)
);
CREATE TABLE catalyst_cost_log (ts, market_date, ticker, model, input_tokens, output_tokens, cost_usd, was_cached);
CREATE TABLE catalyst_alerts_fired (user_id, ticker, market_date, fired_at, PRIMARY KEY (user_id, ticker, market_date));
```

### Spec + plan
- Spec: `docs/superpowers/specs/2026-05-25-morning-catalyst-table-design.md`
- Plan: `docs/superpowers/plans/2026-05-25-morning-catalyst-table-phase-1.md`

### What's deferred to a future session
- **Compass 🧭 per-row** — needs careful AddPositionModal coupling design (deeply tied to J2 account selection, discipline state, stop-prefill logic, intervention banners). Two paths: (a) new catalyst-context verdict endpoint, or (b) refactor AddPositionModal for prefill. Both ~3-4h done right.
- **Dashboard restyle** — user explicitly deferred until they've used the system for several mornings.
- **Finviz Elite per-ticker news scraping** — Perplexity discovery already covers what Finviz would surface. Re-evaluate after morning use.
- **AlphaVantage NEWS_SENTIMENT per ticker** — needs paid tier ($50/mo); free quota already exhausted by existing news_aggregator.
- **Settings UI for env-tunable knobs** — tuning currently via Railway env vars; UI is nice-to-have.
- **Admin stats visualization** — raw JSON at /api/admin/catalyst-stats; UI is polish.
- **Audio briefing at 6 AM ET** — voice infra exists, just not wired.
- **Backtesting tool** — apply current scoring to historical catalyst data to validate setup quality.

### LOCKED invariants (don't regress)
- **gap_pct preference order:** snapshot.change_pct → movers feed → 0.0. Frontend overlays useLivePrices on top — do NOT use stored gap_pct as the primary display value.
- **Skip-if-stable hash** is on raw_signals JSON; bumping the hash function invalidates all cached theses (forces re-synthesis = cost spike). Don't change without intentional opt-in.
- **catalyst_alerts_fired PRIMARY KEY** is (user_id, ticker, market_date) — three-column. Removing market_date would create perma-dedup; removing user_id would silence other users.
- **catalyst_at field** is computed as min(source timestamps) by `_compute_catalyst_at()`. Empty when all sources are Perplexity-synthetic. Frontend falls back to thesis_at with dimmed italics in that case.

## The Desk — Live Trading Sessions auto-publish (built 2026-06-24/25, LIVE)

The firm's daily Zoom **webinar** (new paywalled link each day from a template, NOT
recurring) is auto-recorded and published into **The Desk → Videos → "Live Trading
Sessions"** with **zero per-session effort**. Fully hands-off + proven end-to-end.

**Flow:** Zoom **Automatic Cloud Recording** → Zoom fires `recording.completed`
webhook → engine downloads the MP4 (streamed to a temp file) → uploads to YouTube
**unlisted** (resumable) → sets a **branded thumbnail** → publishes an `edu_videos`
record (reuses the existing Educational Videos store + player) → **trashes the Zoom
cloud copy** (storage-cap safe) → **alerts the owner (email via Resend + Discord)**.
**Routing by webinar name:** `_route(topic)` maps the Zoom webinar name → `(section,
title_prefix, eyebrow)`. `_RULES` pins `"live trading*"` → Live Trading Sessions (back-compat,
since the template is literally named "live trading today"); any other named topic
**auto-derives** section = title = the name + thumbnail eyebrow = NAME.upper() (e.g. a
"Post Market Recap" webinar → "Post Market Recap — {date}" in a "Post Market Recap"
section); empty topic → default. So new content types = just name a Zoom template.
Title `{type} — {Month D, YYYY}` (ET). `_notify_published` fires once per
genuinely-new publish (not on idempotent re-runs); recipients = `DESK_DAILY_SESSION_ALERT_EMAILS`
or `ADMIN_EMAILS`; best-effort (never breaks publish). **⚠️ NO allowlist — EVERY cloud
recording on the account auto-posts (titled by its webinar name); add a skip rule in
`_route` if private/internal recordings ever need excluding.**

### Files
- `api/routers/desk_zoom_webhook.py` — `POST /api/desk/zoom-webhook` (HMAC-validate +
  url_validation challenge + enqueue). `GET /api/desk/sessions-status` (PUSH_SECRET
  bearer) = diagnostics: recent `desk_session_jobs` rows incl. status/error/youtube_id/
  download_url/token.
- `api/services/desk_session_jobs.py` — SQLite queue `/data/desk_session_jobs.db`, PK
  `meeting_uuid` (idempotent vs dup webhooks); `claim_next` reclaims stale `processing`
  rows past `_STALE_SECS` (crash recovery); `mark_uploaded`/`mark_done`/`mark_error`.
- `api/services/zoom_client.py` — Zoom S2S OAuth + `stream_download` (Bearer header,
  content-type+min-size GUARD → rejects HTML/JSON error pages) + `delete_recording`.
- `api/services/youtube_client.py` — OAuth refresh + `upload_unlisted` (resumable,
  streamed from disk) + `set_thumbnail` (thumbnails.set) + `list_completed_broadcasts`
  (v1 poll, retired).
- `api/services/desk_daily_session.py` — `process_pending_jobs` (drain → download →
  upload → set_thumbnail [non-fatal] → publish → trash → done), `_session_title`,
  `_session_date_text`, `check_missing_session_alert` (weekday EOD safety net, Discord).
- `api/services/desk_thumbnail.py` + `api/services/desk_assets/` (compass-mark.png,
  DejaVuSans-Bold/Regular .ttf) — 1280×720 branded card (Pillow).
- `api/main.py` — webhook `include_router` + scheduler `*/5` queue-drain + weekday-18:00
  safety, gated by `DESK_DAILY_SESSION_ENABLED`; `desk_session_jobs._init_db()` at startup.

### Env (web pod)
`DESK_DAILY_SESSION_ENABLED=1` · `ZOOM_S2S_ACCOUNT_ID/_CLIENT_ID/_CLIENT_SECRET` ·
`ZOOM_WEBHOOK_SECRET_TOKEN` · `YT_OAUTH_CLIENT_ID/_CLIENT_SECRET/_REFRESH_TOKEN`
(upload scope, OAuth app published→prod so the token doesn't expire) ·
`DESK_DAILY_SESSION_CATEGORY="Live Trading Sessions"` · optional `_START_DATE`,
`_STALE_SECS`, `_MAX_ATTEMPTS`. Webhook URL: `https://uctintelligence.com/api/desk/zoom-webhook`.

### LOCKED invariants / gotchas (do NOT regress)
- **Zoom `download_token` is at the TOP LEVEL of the `recording.completed` event body**
  (sibling of `payload`), NOT inside `payload`. Reading the wrong place → empty token →
  unauthenticated download → 200 HTML error page → YouTube "Processing abandoned". The
  content-type/size guard in `stream_download` is the backstop.
- **`thumbnails.set` is covered by the `youtube.upload` scope** (no extra scope needed);
  channel must be custom-thumbnail-eligible (phone-verified).
- **Thumbnail + Zoom delete are NON-FATAL** — wrapped in try/except; never break publish.
- **Idempotent**: queue PK on `meeting_uuid` + `edu_videos` dedup on `youtube_id`;
  reclaimed job with a stored `youtube_id` skips re-upload (no duplicate YouTube video).
- **Diagnose via `GET /api/desk/sessions-status`** (PUSH_SECRET), NOT logs — engine logs
  are flooded by yfinance/theme noise. **Cloudflare 1010-blocks raw curl/python UAs** to
  uctintelligence.com → send a browser `User-Agent` when curling.
- Setup walkthrough (one-time Zoom + YouTube + GCP OAuth) + design/plan specs in
  `docs/superpowers/specs/2026-06-24-desk-daily-sessions-*` + `…-thumbnails-design.md`.

### Session insights — chapters/transcripts/auto-trash (repaired 2026-07-02)

`desk_session_insights.process_pending_session_insights` backfills published
videos (education.db rows with a `meeting_uuid`, 7-day window): Zoom VTT
transcript → Opus chapters + ticker-moments + recap poster → **then trashes
the Zoom cloud recording** (deletes are DEFERRED to this pass whenever
`DESK_SESSION_CHAPTERS_ENABLED=1`). Scheduled in `main.py` every 15 min
(`CronTrigger(minute="7/15")`, id `desk_session_insights`), offset from the
`*/5` publish drain.

**It was triple-broken until 2026-07-02 — each layer masked the next; keep all
three fixed:**
1. Zoom S2S app lacked `cloud_recording:read:list_recording_files:admin`
   (added in Marketplace → "UCT Desk Sessions" → Scopes) → every
   `get_recording_files` 400'd.
2. The pass was **never wired into any scheduler** — defined, zero callers —
   so deferred deletes had no collector and recordings accumulated in Zoom.
3. The 2026-07-01 launch-hardening's shared Anthropic client `timeout=60`
   made every `generate_insights` call time out (600k-char transcript +
   2400 Opus tokens ≠ 60s). The insights call now uses
   `_get_anthropic_client().with_options(timeout=...)` —
   `DESK_CHAPTERS_LLM_TIMEOUT_SECS`, default 300 — safe because it runs on a
   scheduler thread, never the request path. Regression test:
   `test_generate_insights_overrides_short_shared_client_timeout`.

**Diagnosis gotchas:** a failing pass is INVISIBLE in the DB — per-video
exceptions only print (log flood buries them) and stamp nothing, so "never
ran" and "always fails" look identical. Ground truth = `insights_at` /
`zoom_cleaned` / `chapters` columns in `/data/education.db` (probe via
`railway ssh`). **`railway ssh` probes must use `/opt/venv/bin/python`** —
bare `python3` is the Nix system python with no app deps (httpx missing).
Pass args as `echo <b64> "|" base64 -d "|" /opt/venv/bin/python` (railway
joins argv into one sh string; quotes/parens/stdin all break).

### Thumbnails — per-show designs + per-day variation (2026-07-01/02)

`desk_thumbnail.py` layouts: **classic** = candlestick-skyline (default +
plate fallback; arbitrary eyebrows auto-fit via `_fit_tracked` with an
ellipsis floor — never clips), **editorial** = leather-journal (Thoughts),
**evening** = city-lights-on-water (Evening Update, host-aware `FROM <host>`),
**plate** = ChartMaster artwork (`desk_assets/chartmaster-workshop.png`,
ChartMaster-only by owner decision). Every card is **date-seeded**
(`_episode_seed` = crc32 of `date_text|eyebrow_label`): classic's chart
pattern (`_gen_trend` — every step bounded incl. the final anchor; 10k-seed
regression rail), evening's skyline/windows/water-glitter, and editorial's
grain vary per episode, deterministically (same inputs = byte-identical
render; the plate-fallback byte-equality test depends on this). Webhook picks
the **largest** MP4 (multi-segment recordings; a 2-min stub once shipped
instead of the 1:23 workshop). Specs/plans:
`docs/superpowers/{specs,plans}/2026-07-0{1,2}-*thumbnail*`.

### Community announcement → TSDR Discord (2026-07-27)

`api/services/desk_session_announce.py` posts ONE rich embed to the public TSDR
community channel (`DISCORD_TSDR_WEBHOOK_URL`) the moment a session publishes —
branded thumbnail attached, YouTube link, and the uctintelligence.com
coming-soon tease — then **EDITS that same message** to fold in the brief recap
once the insights pass produces a headline + takeaways. Post-then-edit because
the Zoom transcript lands 15-40 min later and sometimes never: the drop is never
held hostage, and the pre-recap copy reads complete on its own (it deliberately
promises no recap it might not deliver).

- **⚠️ SHOW ALLOWLIST is the load-bearing safety rail.** The publish pipeline has
  NO allowlist by design (every cloud recording auto-publishes), this channel is
  PUBLIC, and most shows are PAYWALLED. Announcing is opt-IN per show via
  `DESK_TSDR_ANNOUNCE_SHOWS` (default `evening update`). **A blank value
  announces NOTHING** — the failure direction is silence, never a leak.
  Regression rail: `test_announce_refuses_a_paywalled_show_and_posts_nothing`
  (mutation-checked — deleting the guard fails it).
- **The recap costs no LLM call**: it reuses the editor-polished
  `headline`/`summary`/`ticker_moments` the insights pass already stored, so it
  is the same text the Desk player shows and adds no new failure mode.
- **On edit, `attachments: [{id}]` MUST be sent** or Discord drops the uploaded
  thumbnail — that's why `attachment_id` is stored alongside `message_id` in
  `/data/desk_announce.db`. A rejected edit falls back to a follow-up post.
- Hooks: `maybe_announce(video_row_id)` on the `created_now` publish path in
  `desk_daily_session.process_pending_jobs`; `maybe_attach_recap(vid)` on the
  insights `'generated'` path (runs once — `has_chapters` flips). Both gated by
  `DESK_TSDR_ANNOUNCE_ENABLED` and never raise into the pipeline.
- **Manual/backfill:** `POST /api/desk/announce/{video_id}` (PUSH_SECRET bearer)
  runs the same path with the flag off; `?force=1` bypasses BOTH the allowlist
  and the already-posted guard (the only way to announce a non-allowlisted show
  — deliberately manual).
- **Evening card redesign (same commit):** `_render_evening`'s skyline **IS the
  day's candle chart** — every tower is a candlestick (body waterline→close,
  antenna spire = upper wick, edge green on an up-close / red on a down-close,
  a few windows lit in the candle's colour), threaded by a close-line and a
  faint dashed price ladder. `_skyline` was replaced by `_candle_skyline`;
  still `_episode_seed`-deterministic (same inputs = byte-identical).

## Performance & Scale — 2026-07-01 launch-hardening (do NOT regress)

Big perf/scale pass ahead of the ~200-user launch. Full detail + remaining backlog
in user memory `project_launch_readiness_2026_07_01` + `project_perf_pass_2026_07_01`
+ `incident_524_single_process_overload_2026_07_01`. **Architecture reality: the web
pod is ONE uvicorn process = ONE event loop + ONE anyio threadpool (64) shared by all
users. Do NOT multi-worker the web pod (SSE live-price state is in-process).** So every
scale win is about not fanning out per-user work.

- **The 524 outage (2026-07-01):** anyio-threadpool exhaustion + SQLite write contention
  on the single loop (a bare 401 took 24s). Fixed by throttling the per-request
  `validate_session` last_login write (`auth_service._should_write_last_login`, 300s) +
  offloading cold work. **Keystone: never do an unthrottled per-request DB write on the
  universal auth path.**
- **Unbounded external calls pin threadpool workers** → the outage class. All fixed:
  Anthropic client `timeout=60` (`engine.py`); yfinance is bounded everywhere —
  `massive._bounded_yf` + the shared `api/services/yf_util.bounded_call` (used by
  `fundamentals.get_fundamentals` `.info`, `dividends_calendar.get_events`). **Any NEW
  blocking external call on the request path MUST have a timeout.**
- **`/api/live-prices` is two-tier (`live_prices.py`):** a whole-set fast path over a
  SHARED per-ticker cache (`live_px1_{TK}`, 15s) + a `Semaphore(6)` valve with a
  herd-collapse re-check. This kills per-user cache-key fragmentation (the post-deploy
  cold-herd = the launch-day 524 risk). Don't revert to caching by the whole ticker set.
- **Cold-start warm-on-boot (`main.py::_start_dashboard_warm_background`, ~20s post-boot):**
  warms movers/themes/news/breadth/calendar so the first users after a deploy hit warm
  caches (verified: movers 5s→161ms, breadth 2.9s→137ms, calendar 3.7s→51ms). Sits next
  to the hot-tier + RS warmers. **A warm target only helps if the underlying fn caches** —
  e.g. `breadth_monitor.get_history` was uncached (recomputed every request, spiked 28s);
  now 5-min cached keyed by `days` + invalidated on store_snapshot/patch_field/delete.
- **RS rankings (`rs_ranking.py`):** `get_rs_for_ticker` is a pure cache lookup (never
  rebuilds the ~3,685-ticker universe); `main.py`'s RS warmer RE-warms every 50min (under
  the 1h TTL) via `compute_rs_scores(force=True)` so the ~17s recompute never lands on a user.
- **`insider.get_recent_insider_buys`** parallelizes its ~55 Finnhub fetches (10-wide pool).
  **`fundamentals.compare_fundamentals`** parallelizes its ≤6 tickers.
- **Calendar enrichment is batched:** `GET /api/calendar/enrichment-batch?dates=` returns a
  whole week in ONE request (helper `_compute_enrichment_for_date`; `useWeekEnrichment` calls
  it once) — was one request PER day. Single-date endpoint kept for back-compat.
- **Journal auto broker-sync is fire-and-return:** `POST /api/j2/broker/sync?background=1`
  runs the SnapTrade sync as a detached `asyncio.create_task` + returns immediately (11.5s→
  762ms). `useBrokerSync` uses it + an 8s delayed refresh. Explicit "Sync now" buttons stay
  blocking (they surface the result). (broker_sync merge invariant unaffected: `grep -c
  broker_sync api/main.py` still ≥ 7.)
- **Frontend:** global `<SWRConfig>` in `App.jsx` (revalidateOnFocus off, dedup 8s) — don't
  remove. `useMobileSWR` pauses polling on hidden tabs; JournalSnapshotTile + the discipline
  poll (20s) use it. Model Book no longer prefetches every stock's detail/earnings across ALL
  years on load (168→144 requests).
- **SSE connection pooling (2026-07-02):** all `useRealtimePrices` instances share
  ONE browser-wide EventSource pool (`app/src/lib/priceStreamManager.js` — ticker
  union, ≤50/bucket mirroring `stream.py MAX_SSE_TICKERS`, 400ms debounced
  reconnect on union change, per-bucket backoff+watchdog, candle events applied
  once). Was 4-8 connections/user (dashboard mounts desktop+mobile layouts
  simultaneously) = 4-8 server stream loops each. KILL-SWITCH: in DevTools run
  `localStorage.setItem('uct.ssePool.disabled','1')` + refresh → legacy
  per-instance connections (kept verbatim in `useRealtimePrices.js`). Remove the
  legacy path only after weeks of green prod.
- **WAL** is on for auth.db / bars.db / cot.db / breadth_monitor.db. Web `busy_timeout` is
  deliberately LOW (2s on bars; auth.db still 10s — a KNOWN remaining risk, see memory).
- **Down-alert monitor** (`worker_main._down_alert_decision`): worker keep-warm pings the
  web origin + posts 🔴/🟢 to Discord (`DISCORD_WEBHOOK_URL` + `DOWN_ALERT_ENABLED=1`).
- **Known remaining (NOT yet done — memory has the ranked list):** auth.db 10s busy_timeout,
  SSE event-loop 100ms→250ms + lock-free candle snapshot, alert-check delivery offload,
  Finnhub sub cap, table virtualization (react-virtual installed/unused), 1.1MB echarts shrink,
  eventual multi-instance architecture for scale beyond a few hundred users.

## Fundamentals Accuracy Monitor (dark, flag-gated · 2026-07-03)

Continuous detect → self-heal → alert safety net for the fundamentals widget's
earnings-table endpoint — the analog of `bars_reconciliation` for fundamentals
data. The per-request pipeline is correct + self-freshening + NaN-sanitized, but
nothing actively CATCHES a future regression (a code change reintroducing the
forward-quarter off-by-one, a provider silently going bad, a per-ticker drift);
this closes that gap.

- **`api/services/fundamentals_monitor.py`** — every cycle samples ~30 tickers
  (priority liquid + WARM cache entries + a small bounded COLD long-tail),
  runs invariant checks on `get_earnings_table()` output (what users SEE),
  self-heals a stale cache entry (invalidate + recheck), and alerts on a defect
  that survives the heal. **Runs WEB-side** (started in `main.py` lifespan next
  to bars_reconciliation) — the heal is a cache invalidation and the cache users
  read is web-local, so healing must run there.
- **Invariants** (`check_ticker`): NaN/inf present · dup reported quarter · dup
  forward quarter · reported/forward label overlap · label↔period_end
  consistency · **forward strip contiguous & continuing the newest reported
  quarter** (the independent oracle that actually catches the off-by-one SHIFT —
  the naive "label == _label_from_period_end(period_end)" check is TAUTOLOGICAL
  because the label is DERIVED from period_end, so it can't catch a dropped
  quarter). Blank revenue (pre-revenue names) is TALLIED, never flagged.
  Validated false-positive-safe across 608 live tickers (only genuine anomalies
  fire; e.g. HUBG surfaced a real stale-forward-quarter data gap).
- **Self-heal:** `cache.invalidate(f"earnings_table::{S}")` (EXACT key — the
  earnings_table:: key has no trailing separator, so `delete_prefix` would
  over-match, e.g. 'A' wiping AAPL) + `cache.delete_prefix(f"mb_year_earnings_{S}_")`
  (separator-anchored, safe).
- **Alert-on-change:** Discord + in-app (`chart_health_alerts`) fire ONLY on
  newly-flagged tickers, so a persistent upstream anomaly (self-heal can't fix a
  bad SOURCE) stays visible in the status endpoint without re-spamming hourly.
- **Cold-tail bounded** (`_COLD_TAIL`, default 6/cycle) — a cold check can fire
  the scarce AlphaVantage 25/day deep-history budget the widget itself uses;
  warm+priority sampling keeps external-quota cost tiny (near-zero on Railway,
  where FMP Ultimate rarely falls through to AV).
- **Status:** `GET /api/admin/fundamentals-health` (no-auth read-only, mirrors
  reconciliation-status): cycles/checked/healed, blank-sales rate, currently
  `flagged_current`.
- **Env (web pod, default OFF):** `FUNDAMENTALS_MONITOR_ENABLED=1` +
  `_CYCLE_SECONDS` (7200) · `_SAMPLE` (30) · `_COLD_TAIL` (6) · `_STARTUP_DELAY`.
- **Known day-1 flag:** HUBG (its 2026 Q1 actual is missing from FMP's
  stable/earnings but lingers as a stale forward estimate card) — a real
  surfaced anomaly, not a false positive. Grace-window tightening in
  `earnings_table._UNREPORTED_GRACE_DAYS` (130d) is a possible follow-up.

## Live Options Flow — Deploy Survival (2026-07-06 · LOCKED invariants; P5 CUTOVER DONE 2026-07-13)

**P5 cutover complete (2026-07-13):** the Massive OPRA WS consumer (`api/massive_ws_worker.py`,
partner-owned) + flow.db + ALL flow.db-owning jobs (T+1 flat-files ingest, gap-fill, R2 backup,
nightly prune) run on the **FLOW-WORKER service**. Web serves every flow-family read/write via
`api/flow_proxy.py` (registered in main.py BEFORE the local flow routers; active under
`FLOW_READS_PROXY_ENABLED=1` + `WORKER_INTERNAL_URL`; HMAC-vouched auth, SSE passthrough).
Env: flow-worker `MASSIVE_WS_ENABLED=1` + `MASSIVE_S3_*` + backup/gap-fill flags; web
`MASSIVE_WS_ENABLED=0`, `FLOW_BACKUP_ENABLED=0`, `FLOW_GAP_AUTOFILL_ENABLED=0`,
`MASSIVE_FLATFILES_ENABLED=0`. **Web deploys no longer touch the options tape.** flow-worker
deploys still cost a ~15-60s single-slot WS handoff — they are RARE (manual `railway up
--detach -s flow-worker` from a CURRENT worktree; NO GitHub trigger until deliberately
reconnected with narrow watch paths) and ship after-hours. Rollback = flip the env sets back
(web consumer on, proxy off; flow-worker consumer off) + redeploy flow-worker-then-web.
Web's `/data/flow.db` is a FROZEN pre-cutover copy — retire after ~30d green. Massive OPRA
does NOT replay — every feed gap is permanent until the T+1 flat file. Full design:
`docs/superpowers/specs/2026-07-06-liveflow-worker-deploy-survival-design.md` · cutover plan:
`docs/superpowers/plans/2026-07-13-flow-worker-cutover.md` · outage runbook:
`docs/runbooks/liveflow-unstick.md`.

- **`api/main.py` uses `FastAPI(lifespan=lifespan)` — `@app.on_event` handlers are SILENTLY IGNORED.**
  Register any shutdown hook inside the lifespan context manager AFTER the `yield`, next to
  `_scheduler.shutdown(wait=False)`, defensively (`fn = getattr(module, "stop", None)`).
- **railway.json startCommand must keep `exec`** in both branches (without it `sh` is PID 1 and
  swallows SIGTERM — no graceful shutdown can ever run) plus `--timeout-graceful-shutdown 5` (bounds
  the never-ending SSE streams so lifespan shutdown is reached) and `deploy.drainingSeconds: 30`.
  These three are a unit — never remove one alone.
- **`watchPatterns` are set per-service in the Railway dashboard ONLY — NEVER in railway.json**
  (the file is shared by web + worker; an api-only list there would stop web frontend deploys).
  Worker patterns: `/api/**` + build files.
- **Shipping window (post-cutover):** web swaps no longer gap the tape, but the market-hours
  push freeze (Mon-Fri 9:15a-4:20p ET, enforced by `.git/hooks/pre-push`) STAYS — web deploys
  still blip /api/* ~1 min for members, and pushes also rebuild the bars worker. Anything that
  deploys FLOW-WORKER (api flow-path changes via `railway up`) ships strictly after-hours.
- **`MASSIVE_WS_DRY_RUN=1` does NOT protect the prod connection slot** — any local run with the prod
  key kicks production off the feed (Massive allows ~1 conn/key). Local tests use a localhost mock WS.
- Consumer shutdown contract (P1): `massive_ws_worker.stop()` (no args). The main.py hook uses
  defensive getattr so it merges safely before/after the partner's patch.

## Known Issues / Gotchas

- **Cache resets on redeploy** — FIXED (2026-02-23). Railway volume at `/data` persists wire_data.json. Startup event seeds cache automatically. First boot after volume creation still requires one engine run.
- **Claude timeout** — thesis generation can timeout on first engine run; second run succeeds.
- **`config` vs `CONFIG`** — morning_wire_engine.py push code uses `CONFIG` (uppercase). Bug was fixed 2026-02-22.
- **Railway env vars are case-sensitive** — `PUSH_SECRET` must be all-caps (not `Push_Secret`).
- **Movers wire_data fallback** — if Massive API fails at open, movers fall back to engine push (engine captures pre-market Finviz movers at 7:35 AM ET).
- **Railway healthcheck timeout** — set to 600s in `railway.json` (default 300s was too tight for startup with COT seed + DB migrations + scheduler init).
- **Breadth collector Task Scheduler** — runs 4:30 PM ET weekdays (`UCT Breadth Collector`). Battery settings disabled (was killing the job on unplug). Logs: `uct-intelligence/data/breadth_collector.log` (Python) + `breadth_collector_stdout.log` (OS-level stdout/stderr capture).
- **COT refresh timing** — CFTC publishes after 3:30 PM ET on Fridays (publish time varies; `last-modified` on `deacot{YEAR}.zip` reveals the exact timestamp). Three independent defense layers: (1) APScheduler — Fri 3:50/4:15/4:45 PM ET + daily 6 PM catch-up; (2) Startup catch-up — calendar-aware (uses `expected_latest_report_date()`, NOT `already_ran_today`); (3) Request-driven self-heal — `get_status()` triggers background refresh with 30-min cooldown if data is stale. The 2026-05-22 incident: Railway redeployed at 2 PM ET before CFTC published; startup catch-up downloaded the not-yet-updated zip and marked `last_updated=today`; later scheduler jobs silently failed (likely lost `acquire_scheduler_lock()`); the misleading `already_ran_today` flag would have blocked future startup catch-ups. Hardening in commit `12851ef`. Check `/api/cot/status` to self-heal; `POST /api/cot/refresh` to force.
