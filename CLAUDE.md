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

## Journal 2.0 — parallel rebuild (beta)

A full side-by-side rebuild of the Journal tab lives at `/journal` → "Journal 2.0 beta" (last sub-tab). **Additive only** — the existing Journal's code, data, and UI are unchanged. The two Journals share no code, no components, and no database tables.

- **Source:** `app/src/pages/journal-2-0/`, `api/routers/journal_two.py`, `api/services/journal_two/`
- **Tables (all `j2_` prefix, migration from `auth_db.init_db()`):**
  - `j2_settings` — legacy pre-accounts global settings (fallback path)
  - `j2_accounts` — multi-account model (per-account sizing/setups/goals/fees)
  - `j2_positions`, `j2_trades` — open + closed equity trades
  - `j2_day_notes` — prep/mid-day/recap reflection + attachments + rules checklist
  - `j2_playbook_entries` — stock observation library (Prep → Plan → Trade → Recap)
  - `j2_option_strategies`, `j2_option_legs` — Pattern C multi-leg options
- **Phases shipped:** 1 (Calendar) · 2 (Accounts) · 3 (Analytics 14 charts + Edge Scorecard) · 4 (Goals + Report) · 5 (Fees, Daily Notes, Playbook, **Options multi-leg**)
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

J2 is now a full coaching product: Journal + Playbook + AI Coach. **10 distinct coaching surfaces** powered by Anthropic Sonnet 4.6 with server-side hallucination audit + sample-size confidence + regime awareness.

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
- **Surfaces wired:** `CompassChat` (already had both); `DayReflection` (4 sections, date threaded into hint); `TradeDrawer` (🎙️ Talk about this trade — hint includes ticker/side/entry/exit/P&L/setup); `AddPositionModal` (Notes); `PlaybookEntryModal` (Thesis + Additional Notes); `CompassReview` (Weekly Review — 🎙️ Discuss).
- **Page hints**: every CompassAssistButton passes a rich `pageHint` describing the surface + record context. `setVoicePageHint` is called on click so the Realtime session-token mint includes it. Compass's existing P4-B mechanism turns the hint into a "=== CURRENT PAGE ===" block in its system prompt.
- **Cleanup mode (2026-05-15):** `cleanup_transcript()` in `voice_openai.py` — gpt-4o-mini pass that strips fillers, fixes ticker mishears ("in video"→NVDA), adds punctuation. Best-effort: returns original text on ANY error so dictation is never lost. `/api/voice/transcribe` takes optional `cleanup` form param; `VoiceInputButton` sends `cleanup=true` by default (overridable via `cleanup={false}` prop).
- **Settings (2026-05-15):** "Ways to talk to Compass" section in the Compass TileCard (`Settings.jsx`) — read-only list of all 6 voice access paths (dictate, assist/talk, orb, push-to-talk hotkey, wake word, read-aloud).
- **First-run hint (2026-05-15):** one-time discoverability popover in `VoiceInputButton`. Single localStorage flag `voice.dictation.hintSeen` gates it across ALL surfaces (not per-surface). Dismissed by ✕ button OR first voice use. `VoiceInputButton.test.jsx` `beforeEach` defaults the flag to seen so behavioral tests are unaffected; 4 hint tests opt out explicitly.
- **Tests**: backend 8 tests in `tests/test_voice_router.py` (auth, paid-gate, happy path, empty audio, usage tracking, cap exceeded, cleanup applied, cleanup skipped by default) + 3 in `test_voice_openai.py` (cleanup happy/empty/error-passthrough). Frontend 4 in `CompassAssistButton.test.jsx` + 6 in `VoiceInputButton.test.jsx` (Whisper path, fallback, cleanup param). All 51 backend voice + 547 frontend tests pass.

## Mobile Navigation

Hamburger + slide-out drawer (hidden on desktop). Fixed header with page title + AlertBell. Body scroll locked when drawer open. User avatar + name in drawer header.

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
const greetingName = user?.name?.split(' ')[0] || user?.email?.split('@')[0] || 'TRADER'
```

### Spec
`docs/superpowers/specs/2026-05-08-uct-intelligence-intro-animation-design.md`

### Tech notes
- Pure CSS keyframes + SVG SMIL motion, **zero new dependencies**
- ~70KB image assets, ~12KB CSS
- Uses `Georgia, 'Times New Roman', serif` for cartographer/map decoration ONLY (explicit exception to font-unification rule because these are graphic decoration, not UI text). Welcome line + product wordmark + pills all use Instrument Sans

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
- **Full universe pre-cache**: background thread on startup fetches 3,685 tickers (`api/data/cap_universe.json`) × 5 TFs = 18,425 entries. Also pulls tickers from wire_data (UCT20, candidates, earnings), theme taxonomy (all tiers), watchlists, and tagged tickers. Continuous refresh loop cycles permanently.
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
- **Free tier**: Dashboard, Breadth, Theme Tracker, Calendar, Watchlists accessible without payment
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

### Calendar Page (`app/src/pages/Calendar.jsx`)
- Two panels: Earnings (left) + Macro Events (right, ForexFactory)
- Earnings: HTML `<table>` layout, 5 day tabs (Mon–Fri), BMO/AMC sections
- Data: live EW+Finviz primary, wire_data fallback, cap_universe server-side filter ($300M+)
- No-data entries filtered client-side (no estimates AND no actuals = noise)
- 10min cache TTL, 2min SWR poll, Finnhub actuals patch on every cache rebuild
- Click ticker → EarningsModal (same component as dashboard CatalystFlow)

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
- `themes_taxonomy.json` — source of truth: 99 themes, 1928 holdings, 12 sectors
- `morning-wire/morning_wire_engine.py` — reads taxonomy, fetches holdings, pushes to Railway

### Architecture
- **Hybrid taxonomy**: JSON seed file → SQLite DB on startup → API enrichment with sector/tier/sub_themes
- **99 themes across 12 sectors**: Technology, Innovation, Clean Energy, Traditional Energy, Materials, Defense & Industrials, Financials, Healthcare, Consumer, Real Estate & Utilities, Crypto, Global
- **Holdings cap**: 50 per theme (was 15), filtered by $300M market cap
- **Non-blocking compute**: memory cache → disk → `{status: "computing"}`
- **Workers**: `_MAX_WORKERS = 2` (reduced for Railway 512MB scalability)

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

## Model Book — Setup Taxonomy (2026-03-21)

### Files
- `app/src/pages/ModelBook.jsx` — full-page trade log
- `app/src/pages/ModelBook.module.css` — styles
- `api/routers/trades.py` — GET/POST /api/trades (JSON file storage)
- `data/trades.json` — Railway persistent volume

### Setup Groups
Setups are organized into two groups (`SETUP_GROUPS` in `ModelBook.jsx`):

**Swing:**
High Tight Flag (Powerplay), Classic Flag/Pullback, VCP, Flat Base Breakout, IPO Base, Parabolic Short, Parabolic Long, Wedge Pop, Wedge Drop, Episodic Pivot, 2B Reversal, Kicker Candle, Power Earnings Gap, News Gappers, 4B Setup (Stan Weinstein), Failed H&S/Rounded Top, Classic U&R, Launchpad, Go Signal, HVC, Wick Play, Slingshot, Oops Reversal, News Failure, Remount, Red to Green

**Intraday:**
Opening Range Breakout, Opening Range Breakdown, Red to Green (Intraday), Green to Red, 30min Pivot, Mean Reversion L/S

### Architecture Notes
- `SETUP_GROUPS` array drives both the nav sidebar (group headers + buttons) and the form select (`<optgroup>`)
- `SETUPS` flat array derived via `SETUP_GROUPS.flatMap(g => g.setups)` — used for filtering logic
- Nav renders `.navGroupLabel` header (muted caps) before each group's buttons
- Trade data shape: `{ sym, entry, stop, target, size_pct, notes, setup, date, id, status }`
- Status: "open" only (close/exit tracking not yet implemented)

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

## Support Chat — UX (2026-03-27)
- **Enter** sends reply in the reply textarea
- **Shift+Enter** inserts newline
- File: `app/src/pages/Support.jsx` line ~340

## Known Issues / Gotchas

- **Cache resets on redeploy** — FIXED (2026-02-23). Railway volume at `/data` persists wire_data.json. Startup event seeds cache automatically. First boot after volume creation still requires one engine run.
- **Claude timeout** — thesis generation can timeout on first engine run; second run succeeds.
- **`config` vs `CONFIG`** — morning_wire_engine.py push code uses `CONFIG` (uppercase). Bug was fixed 2026-02-22.
- **Railway env vars are case-sensitive** — `PUSH_SECRET` must be all-caps (not `Push_Secret`).
- **Movers wire_data fallback** — if Massive API fails at open, movers fall back to engine push (engine captures pre-market Finviz movers at 7:35 AM ET).
- **Railway healthcheck timeout** — set to 600s in `railway.json` (default 300s was too tight for startup with COT seed + DB migrations + scheduler init).
- **Breadth collector Task Scheduler** — runs 4:30 PM ET weekdays (`UCT Breadth Collector`). Battery settings disabled (was killing the job on unplug). Logs: `uct-intelligence/data/breadth_collector.log` (Python) + `breadth_collector_stdout.log` (OS-level stdout/stderr capture).
- **COT refresh timing** — CFTC publishes after 3:30 PM ET on Fridays (publish time varies; `last-modified` on `deacot{YEAR}.zip` reveals the exact timestamp). Three independent defense layers: (1) APScheduler — Fri 3:50/4:15/4:45 PM ET + daily 6 PM catch-up; (2) Startup catch-up — calendar-aware (uses `expected_latest_report_date()`, NOT `already_ran_today`); (3) Request-driven self-heal — `get_status()` triggers background refresh with 30-min cooldown if data is stale. The 2026-05-22 incident: Railway redeployed at 2 PM ET before CFTC published; startup catch-up downloaded the not-yet-updated zip and marked `last_updated=today`; later scheduler jobs silently failed (likely lost `acquire_scheduler_lock()`); the misleading `already_ran_today` flag would have blocked future startup catch-ups. Hardening in commit `12851ef`. Check `/api/cot/status` to self-heal; `POST /api/cot/refresh` to force.
