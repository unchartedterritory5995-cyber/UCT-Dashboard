# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

## Project Overview

**UCT Dashboard** is a live bento-box trading dashboard for Uncharted Territory. It is a full-stack app:
- **Frontend:** React + Vite SPA with React Router (NOT Next.js — ignore all "use client" suggestions)
- **Backend:** FastAPI (Python) — serves the React build and all `/api/*` data endpoints
- **Deployment:** Railway, **FIVE services** (`web`, `worker`, `bars-api`, `flow-worker`, `chart-renderer`) at `https://uctintelligence.com` (Cloudflare DNS). ⛔ *"single service"* was true once and is not now — derive the roster with `railway status --json`. Which of them a push restarts, and when that is safe, is **`docs/runbooks/deploy-windows.md`**, not this line.
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

**The uct-intelligence path in engine.py is CONFIGURABLE, not hardcoded.** There is exactly ONE reference — `UCT_INTEL_PATH = pathlib.Path(os.environ.get("UCT_INTEL_PATH", r"C:\Users\Patrick\uct-intelligence"))`, near the top of `api/services/engine.py` — so the Windows path is a local-dev DEFAULT that fails silently on Railway (primary path is wire_data from push), and the env var overrides it. ⚰️ This said *"Hardcoded local paths … Lines 1508 and 1540"*: two locations, neither of which contained a path reference, and "hardcoded" contradicted the Compass Brain Bridge section of this same file, which relies on `UCT_INTEL_PATH=/data/brain` pointing the brain facade at the installed pack "with zero engine changes". Grep the constant, not a line number.

## Nav Tabs (left sidebar)

**Measure it, don't quote it** — the list is the `NAV` array at the top of
`app/src/components/NavBar.jsx`; read it there rather than trusting the line below.
At 2026-08-09 it reads:

Dashboard · Morning Wire · **Charts** · **AI Search** (`/ai-search`) · UCT 20 ·
Breadth · Calendar · Screener · Options Flow · **Flow Record**
(`/flow-scoreboard`) · **Live Flow** (`/live-massive`) · Post Market ·
Model Book · **The Desk** · Journal · **Community** · Support

⚰️ The 2026-08-09 reading of this line listed **Patterns** — there is no
`/patterns` route and no such NAV entry (measured 2026-09-01); the string only
survived in `tools/mobile_audit.py`'s hand-typed route list, where it made the
harness audit the 404 page while `/ai-search`, `/flow-scoreboard`,
`/live-massive`, `/desk` and `/community` were never audited at all.

Breadth's own sub-tabs are `BREADTH_TAB_ITEMS` in `app/src/pages/Breadth.jsx`:
Monitor · Views · Daily · COT Data · Data Charts, **+ Analogues appended for
admins only** (`BreadthTabs({isAdmin})`). Monitor leads (owner decision
2026-08-26); phones still land on the Daily tab (key `overview` — it replaced
the old duplicated-MarketBreadth Overview with `breadth/DailyOverview.jsx`,
whose finished-session hero reads `GET /api/breadth-monitor/session-path/{date}`).

⚰️ This line listed **Theme Tracker** and **Traders** — neither is a nav entry.
`/theme-tracker` is a `LegacyRedirect` (see below). **Traders is still not a nav
entry, but it is no longer unreachable** — this said *"reachable from nothing but
`Traders.test.jsx`"*, which was true until 2026-08-09 and is the reason it got
fixed: `GET /api/traders` was mounted and paid-gated the whole time, and
`api/services/voice_client_action_tools.py` navigated members to `/traders`,
which `App.jsx` did not route. **`/traders` is a real route now**; its door is the
voice assistant, not the sidebar. Rail:
`tests/test_navigation_targets_resolve.py`, which resolves every value in
`PAGE_ALIASES` and every key in `voice.py::_PAGE_DESCRIPTIONS` against App.jsx's
route table — it is what caught the second one, `"uct 20" → /uct20`, against a
route that has always been `/uct-20`. It also **omitted** Charts, Patterns,
Live Flow, The Desk and Community; called Breadth's "Views" tab "Heatmap"; dropped
"Overview"; and did not say Analogues is admin-gated. Every one of those is wrong, in
the first section a new engineer reads — and the two phantom entries are the worse
half: **a nav entry documented for a page no route reaches teaches the next engineer
that the orphan is the idiom.** *(Deliberately no count here: a typed count beside the
list it describes is the defect this whole file keeps re-committing. Diff the two.)*

**No "Watchlists" nav entry** — `/watchlists`, `/theme-tracker` and `/multi-chart` were retired into the `/charts` workspace as widgets (`7640ef01`) and now `LegacyRedirect`. Watchlists are reached by adding a Watchlist widget on Charts. See the header comment in `app/src/pages/Watchlists.jsx` before changing that file — half of it is unreachable.
Settings + Admin (admin only) pinned to bottom of sidebar.

## ⚰️ DOCUMENTED BUT UNREACHABLE — read this before copying any idiom from below

**This file described these as live features. They are not.** Source: the
2026-08-09 reachability audit (`.superpowers/sdd/audit/reachability-report.md`),
which resolved every import form — static, `import type`, bare side-effect,
`export * from`, `lazy(() => import())`, `await import()`, `require()`,
`import.meta.glob`, `vi.mock`, `@/` and `/src/` aliases, `index.*` directory
resolution — over 1,426 source files, and enumerated the backend by **importing
`api.main:app` and walking its 986 routes** rather than grepping `include_router`.
Every row below was re-verified by hand on 2026-08-09 before this table was written.

**⛔ Why this section exists at the top instead of a footnote:** an agent this week
read `CustomScan.chartmount.test.jsx` as *the precedent for its own task* before
noticing the page it tests reaches no route. **Unreachable code documented as live
teaches the next engineer the wrong idiom** — and a green test file standing in for
a door that does not exist is the most convincing wrong precedent in the repo.

**This table is the single owner of these claims.** The sections further down are
annotated with a pointer here — correct this table, not the pointer, or you create
the second-authority-over-one-value defect that has caused three separate outages.

| Documented as | Reality on 2026-08-09, **after the deletion sweep** |
|---|---|
| `components/tiles/EarningsModal.jsx` — "opens on ticker click in CatalystFlow or Calendar" | 🗑️ **DELETED** (`d26cee0c`). It had zero importers; `components/research/EarningsResearchModal.jsx` says in-file that it *replaces* the old modal's idiom, and the calendar's click-through is `EarningsResearchModal` + `pages/calendar/useEarningsModalRoute.js`. **Read those.** |
| `components/calendar/FundamentalsStrip.jsx` — the fwd-PE strip | 🗑️ **DELETED** (`d26cee0c`) — dead by inheritance; its only importer was `EarningsModal.jsx`. ⚠️ Its neighbour `calendar/SentimentGauge.jsx` was NOT dead by inheritance and stays: `components/research/sections/CallSection.jsx` reuses it. |
| `charts/widgets/MobileChartFallback.jsx` — "mobile <640px renders a full-screen StockChart via MobileChartFallback" | 🗑️ **DELETED** with its test (`ed53f9b6`). `ChartsWorkspace.jsx` imports and renders **`MobileWorkspace`** — that is the phone branch. |
| `journal-2-0/components/BrokerSyncStatus.jsx` | 🗑️ **DELETED** with its test (`ed53f9b6`). The bar was absorbed into `components/trust/SyncTrustCenter.jsx`, which is what renders sync freshness. |
| `journal-2-0/components/BrokerEquityCurve.jsx` + `hooks/useBrokerEquityCurve.js` — "Open Positions leads with a real equity curve" | 🗑️ **DELETED** (`d26cee0c`). ⚠️ **The data outlived the renderer**: `j2_broker_equity_snapshots` is still written daily and nothing draws it. That is a product decision waiting to be made, not a leftover to clean up. |
| "ON THE TAPE" section on `MoversSidebar.jsx` + `hooks/useTapeFeed.js` | 🗑️ **`useTapeFeed.js` DELETED** — superseded, not merely unmounted. `3dc5036a` moved the tape out of the sidebar; the successor is `components/tiles/TapeFeed.jsx`, mounted on `Dashboard.jsx` twice (desktop + mobile) and reading **`/api/tweets/feed`** via `hooks/useTweetFeed.js`. The *name* survived onto the new tile, which is why this read as live. ⚠️ **`GET /api/tweets/tape` is still mounted and now has zero callers** — deliberately: a browser holding the previous bundle still polls it. Retire the route a deploy cycle later, not in the same commit as its last caller. |
| `components/PositionCalc.jsx` — "TickerPopup … position calculator" | 🗑️ **DELETED** (`d26cee0c`). `TickerPopup.jsx` contains no calculator. |
| `components/tiles/NHNLModal.jsx` — "opens on click of NH or NL in MarketBreadth" | 🗑️ **DELETED** (`d26cee0c`). `MarketBreadth.jsx` never referenced it — and no longer renders NH/NL at all (see its own section below). |
| `api/earnings_router.py` — its own docstring says *"Mount in main.py: `app.include_router(earnings_router, prefix="/api/schwab")`"* | 🔴 **STILL PRESENT, STILL UNMOUNTED — the only live row in this table.** `earnings_router` appears nowhere in `api/main.py`. It is also superseded: `api/schwab_router.py`'s Yahoo-backed `_fetch_earnings_yf` + `POST /api/schwab/earnings` is what actually serves, at the very prefix the docstring asks for. ⚠️ That instruction is in a file this doc's owner cannot edit; **do not follow it** — FastAPI answers on first match, so mounting the Finviz-scraping predecessor would put a second authority on earnings dates and silently shadow one of the two. |

| `journal-2-0/lib/offline/patchNote` — mentioned in Wave Q1 round-2 working notes | ⚰️ **REMOVED, NOT ORPHANED (2026-09-10).** It was ADDED by the Wave Q1 round-2 work and deleted again when the in-flight marker moved to the meta store; it is absent from `lib/offline/**`, not merely unreferenced. Recorded here so nobody files it as a dead export and goes looking for the file. Wave Q1 ruling **R-H** (`docs/notebook/wave-q1-RESUME-HERE.md`). |

**Also mid-audit, unfixed, and NOT this doc's to fix** — recorded so nobody trusts
them: `scan_evaluator.enabled()`'s docstring and the comment above the sweep's
`add_job` in `api/main.py` **both** assert *"E-4 has not wired a surface to these
results."* **It is wired** — `/screener` → `SavedScreensPanel` → `ScanResults` →
`CoverageLine`, reading `GET /api/scans/definition-results`, with
`components/screener/reachable.test.js` + `Screener.scanmount.test.jsx` as the
standing rails. The same false sentence in two places is why it survived: each
looked like corroboration of the other.

✅ **THE FILES ARE GONE NOW** — this said *"the files are still there"*, and a
separate pass deleted them the same day (`d26cee0c` · `ed53f9b6` · `24ee463b`,
each independently revertable; the kept-and-why ledger is
`.superpowers/sdd/audit/fix-orphan-deletion-report.md`). Every row above except
`api/earnings_router.py` now describes a path that does not exist, which is
**still worth reading**: the sections further down still name these files, and
the row tells you what replaced each one.

⛔ **Do not re-derive this table from a stale audit.** The last census that
reported *"48 modules unreachable"* named `components/ui/*` among files with zero
importers — `UIcon` has **222 import statements**. Acting on it would have
stripped the icon system off every screen. A fresh AST walk from `App.jsx`
(2026-08-09, post-sweep, every form resolved incl. `new Worker(new URL(…))`)
finds **12** unreachable modules under `app/src`, of which **eleven** are test
infrastructure, declared vite entry points, or partner-owned files awaiting ack.
The standing rail is `app/src/components/screener/reachable.test.js`, which now
sweeps **all of `app/src`** and fails by name on the next one — so this table
should never again be assembled by hand.

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
  - `j2_notes` + `j2_note_folders` — **Notebook** (Substack-style long-form notes, TipTap WYSIWYG, folders + tags, optional ticker, hero image). Replaced Playbook 2026-05-26 via one-shot migration (gated by `.notebook_migration_v1` flag in `DATA_DIR`). **Nested folders** (`parent_id`, `.notebook_migration_v2`) + a **file-based importer** (Notion/Obsidian/Evernote/generic md·docx·txt·html; wizard lives in `NotebookTab`; bulk endpoints `POST /api/j2/notes/import/check|confirm`) shipped 2026-08-11.
  - `j2_note_connectors` + `j2_note_sources` + `j2_note_sync_log` + `j2_note_remote_index` — **background note-sync connectors** (Roam/Craft graph-token connect; Notion/Dropbox OAuth; scheduled + manual sync with conflict + delete detection) shipped 2026-08-12 on branch `note-connectors`. Router `/api/j2/notes/connectors/*` (`api/routers/note_sync.py`) mounts unconditionally; syncing itself is **double-gated** — `NOTE_SYNC_ENABLED=1` (scheduler registration in `main.py`) AND per-provider config, checked in-endpoint — unset either and it's fully inert.
  - **OneNote + OneDrive** joined the connector roster shipped dark 2026-08-12, same branch — Microsoft Graph OAuth, one shared Azure app (`MSGRAPH_CLIENT_ID`/`MSGRAPH_CLIENT_SECRET`), same `note_sync.py` router and the same `NOTE_SYNC_ENABLED` + per-provider msgraph-config double-gate as above. OneNote syncs via a resumable per-tick watermark queue (bounded enumeration + paced content fetch across ticks), not a one-shot pull.
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
- FE: `pages/journal-2-0/components/{BrokerConnectionsCard (Settings),PositionsTable,BrokerReviewNudge}.jsx` + `components/trust/SyncTrustCenter.jsx` + `tabs/{OpenPositionsTab,TradeJournalTab}.jsx` (options merged into both tables)
  - ⚰️ This list also named **`BrokerEquityCurve`** and **`BrokerSyncStatus`**. Both are orphaned — see *⚰️ DOCUMENTED BUT UNREACHABLE* near the top. `SyncTrustCenter` is what actually renders the sync bar.
- Diagnostics (manual, gitignored state): `tools/snaptrade_{smoke_test,shape_audit,j2_e2e}.py`

### Env vars (Railway web pod; production)
`SNAPTRADE_CLIENT_ID` (`UNCHARTED-TERRITORY-REAQG`) · `SNAPTRADE_CONSUMER_KEY` ·
`BROKER_ENCRYPTION_KEY` (Fernet — PERMANENT, backed up) · `SNAPTRADE_WEBHOOK_SECRET` ·
`BROKER_SYNC_ENABLED=1` (scheduler: 20-min incremental + 2:30am ET nightly reconcile).
Inert with these unset. ⚠️ For how `railway variables --set` behaves, read
**"`railway variables --set` — measured BOTH ways"** below — this line's flat
"STAGES → must redeploy" was measured on `chart-renderer` and did NOT hold on
`web` on 2026-09-09. Verify the boot.

### Schema (j2_broker_* tables in db.py)
`j2_broker_users` (encrypted secret), `j2_broker_accounts` (1:1 → a `j2_accounts` row,
`balance_source='broker'`), `j2_broker_activities` (raw ledger), `j2_broker_sync_log`,
`j2_broker_dup_flags`, `j2_broker_equity_snapshots` (daily net-liq snapshots —
⚠️ **written but never rendered**; the curve component that read them is orphaned,
see *⚰️ DOCUMENTED BUT UNREACHABLE*).
Plus alters: `source`/`external_id`/`entry_estimated` (+ `broker_price` = current
per-share mark, refreshed each `reconcile_positions` so equity rows show a real
price/P&L after hours when the live feed is empty) on positions; `source`/`external_id`
on trades; `source`/`external_id`/`broker_current_value` on option_strategies; broker
balance cols on accounts.

### UI surfaces (all in Open Positions / Trade Journal)
Connect/disconnect in **Settings → Brokerage Connections** (`BrokerConnectionsCard`).
Open Positions tab leads with: `BrokerAccountHero` + `SyncTrustCenter` (sync freshness
+ one-tap re-sync), "needs a setup" nudge; **options render as rows in the same table as shares**
⚰️ *(this said "real **equity curve** (from net-liq snapshots)" — `BrokerEquityCurve`
has zero importers and no equity curve renders on this tab; see the unreachable table.)*
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
> change, no rebuild.
>
> 🟢 **BOTH ARE ON IN PRODUCTION.** Read live, `railway variables --service web --kv`,
> 2026-08-09: `COMPASS_AUTOMATION_ENABLED=1` · `AWARENESS_ENGINE_ENABLED=1`. **The
> awareness scan is running.** So is the rest of the Compass job family that
> `_add_compass_job` gates.
>
> ⚰️ This said *"`COMPASS_AUTOMATION_ENABLED` has been OFF since 2026-05-18 (token
> burn) — treat that flip as a deliberate un-pause decision."* The flip already
> happened. Anyone reading this section was sizing token spend, insight-cap
> contention (see the 8/day limitation below) and blast radius against a system they
> believed was dark. **Never assert a flag state from a code default or a past
> decision — `railway variables --service web --kv` is the only authority, and it is
> one command.** (⚠️ For `--set`'s restart behaviour see **"`railway variables
> --set` — measured BOTH ways"** below; this line's flat "AUTO-REDEPLOYS" is one
> of two measurements, not the rule. The read form never restarts.)

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

Shown at ≤1024px (desktop uses the left `NavBar`). ONE piece in `Layout.jsx`:
- **`MobileNav` top bar** — fixed header: top-left menu button + page title + movers shortcut + `AlertBell`. The menu button opens **`MoreSheet`** — the SINGLE comprehensive directory (sectioned Core/Markets/Trading/Help/Account, identity header, free/paid/admin gating, active-route highlight, Compass badge).
- ⚰️ **`MobileTabBar` (bottom) was REMOVED 2026-09-01** (owner call: it duplicated the top-left menu route-for-route, and its 58px belonged to the chart). Its `--mobile-tabbar-h` token is gone from tokens.css and guarded against resurrection by `pages/charts/mobileShellHeight.test.js`; `navGroups.js` (the shared route taxonomy it derived from) lives on for NavBar + the route rail. On the phone chart shell — where the top bar also hides — the app-menu door is the **Menu button in the chart symbol strip** (`MobileSymbolStrip`, via `MoreSheetContext`). **The gold timeframe pill is the strip's far-RIGHT control** (moved up from the bottom toolbar 2026-09-11, owner call — that bottom row is being freed for shortcut tools; `MobileChartToolbar` now carries four doors and must not grow a second timeframe door; rail `pages/charts/mobile/tfDoor.wire.test.jsx`). The old side drawer was removed 2026-06-19 for the same reason: one menu (`MoreSheet`), and every trigger opens THAT — don't reintroduce a second nav surface.

### Floating buttons (FABs)
The voice orb (`voice/FloatingOrb.jsx`, paid-only, bottom-right) and the feedback "?" (`FeedbackWidget.jsx`, bottom-left) are `position:fixed` just above the bottom safe area (they stepped down when the tab bar was removed). Both **auto-hide on scroll-down** via `hooks/useHideOnScroll.js` and restore on scroll-up / near-top / ~1.4s idle. The orb stays put during a live call or drag; the feedback button stays put while its menu is open.

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

### Preview environments for a feature branch — the decision, and why

**There is ONE Railway environment (`production`) and no per-branch preview.** Measured
`railway status --json`, 2026-01: project `luminous-recreation`, environments = `[production]`,
services = `web · worker · flow-worker · bars-api · chart-renderer`. A single `web` service serves
the built React SPA *and* `/api/*` from one FastAPI process — there is no separate frontend service.

⚠️ **There is no Postgres and no Redis.** The entire data layer is **SQLite files on the Railway
volume at `/data`** (auth.db, bars.db, breadth_monitor.db, catalysts.db, community.db, flow.db,
education.db, …). This matters for previews: a Postgres plugin can be duplicated and migrated, **a
Railway volume cannot** — there is no clone-volume primitive, so any new environment starts with an
EMPTY `/data`.

**CHOSEN (device testing): a local sandbox + BrowserStack Local tunnel.** Run
`scripts/hub-sandbox.ps1`, then point BrowserStack Live at the tunnel. The script pins
`DATA_DIR` to a sandbox, mints an admin via `ADMIN_EMAILS`, and zeroes/blanks every scheduler and
outbound channel. **It hard-exits if `DATA_DIR` would resolve to `C:\data` or `/data`.**
The BrowserStack Local binary is an **operator tool on the owner's machine, not a repo dependency** —
it appears in no `package.json` or `requirements.txt` and must not be added to either.

**APPROVED IN PRINCIPLE, NOT BUILT (durable): a persistent Railway staging environment.**
⛔ **Ruling, recorded before it can become a blocker: NEVER copy `auth.db` or any member data to
staging.** Production `auth.db` holds ~20,640 real members; duplicating it into a second environment
duplicates real PII for a convenience. Staging uses a **synthetic `auth.db`** containing only the one
`ADMIN_EMAILS` account, plus non-PII data files if any are needed at all (bars, breadth, catalysts).

**REJECTED: Railway PR / ephemeral environments.** Recorded so it is not re-proposed. Railway copies
env vars into the new environment, and **this app's env vars arm schedulers** — a booted clone posts
to a ~750-member Discord channel, publishes to YouTube, and emails members via Resend, all on live
credentials. It is also still data-empty (see the volume note), so it buys **no realism** over a local
run while carrying the entire blast radius. Wrong trade in both directions.

**Named test account: `hubtest@local.dev`**, promoted by `ADMIN_EMAILS` inside the sandbox DB.
Never the owner's account, never a colleague's, never a member.

**Every device script names its preview URL explicitly**, as a stated precondition at the top of the
file. A device script that does not say what it is pointed at is not a test.

### Testing → Smoke — the ONE synthetic production account

> **`smoke@uctintelligence.internal` is the only account any automated tool may sign in as on
> production.** Owner ruling, 2026-09-12.

**What it is for.** `tools/hub_nav_smoke.py` (the post-deploy client smoke, box 3 of
`docs/plans/joystick/closure.md`) and any future automated production check. It exists because the
smoke needs a signed-in session and the alternatives were both wrong: a member's account puts a
robot inside someone's data, and the owner's account makes every automated run
indistinguishable from a human one in the activity log.

**Rules, and they are not negotiable:**

- ⛔ **It must never hold a real position, a real note, a real watchlist entry or a real alert.**
  A smoke account that accumulates state stops being a control: the next run cannot tell a
  product change from its own leftovers. Anything it creates, it removes.
- ⛔ **It is the ONLY account an automated production tool signs in as.** `SMOKE_EMAIL` /
  `SMOKE_PASSWORD` in the operator's environment (`setx`, same pattern as the BrowserStack
  credentials), never in the repo, never in a log, never in a commit.
- ⛔ **Never a personal address in `ADMIN_EMAILS` for this purpose.** The three real entries there
  belong to people; the synthetic one is a fourth and is the only one automation uses.
- Its admin role comes from `ADMIN_EMAILS` because there is **no other path**: `api/routers/auth.py`
  promotes on signup (`:205`) and on login (`:253`) from that set, and no admin endpoint sets a
  role. Its paid access comes from `POST /api/auth/admin/comp-access` — the same endpoint the admin
  page uses — so the subscription row is the shape the rest of the app already reads
  (`plan='pro'`, `status='comped'`, no Stripe ids).
- ⭐ **The domain is deliberately unroutable.** `.internal` is reserved (RFC 8375), so the address
  can neither receive nor send mail and cannot be mistaken for a person's. It passes the signup
  model's `EmailStr` validation — verified against the installed validator — while `*.invalid` does
  not (the validator rejects special-use domains by name).

#### ✅ PROVISIONED 2026-09-12 — one production write, on an explicit owner allow

| | |
|---|---|
| Email | `smoke@uctintelligence.internal` |
| User id | `f4433528-6466-474a-949c-8d5eda8a7b91` |
| Role | `admin` — auto-promoted at LOGIN from `ADMIN_EMAILS` (`auth.py:253`), not set by hand |
| Plan | `pro`, `status='comped'`, no Stripe ids — via `comp_user_access`, the function `POST /api/auth/admin/comp-access` calls |
| `email_verified` | `false`, and that is fine: admins skip verification, and the domain cannot receive mail |

**How it was created, and why not through HTTP.** `COMING_SOON_MODE=1` on production, so
`POST /api/auth/signup` refuses every request (`auth.py:192`), and no admin endpoint creates a
user. The account was created by calling **the app's own service functions in the web pod** —
`create_user` (the exact function signup calls, `auth.py:200`) then `comp_user_access` — with no
raw SQL against `users` or `subscriptions`. One write, on an explicit owner allow.

⛔⛔ **DOOR B IS REFUSED PERMANENTLY. Never flip `COMING_SOON_MODE` to create an account.**
Owner ruling, 2026-09-12. Flipping it opens **public registration to the entire internet** for
the length of the window and re-opens Stripe subscriptions with it (`auth.py:1700`); anyone who
registers during the window keeps their account. It is a site-wide state change in exchange for
one test account, and it is the larger risk of the two **despite looking like the normal path**.
⭐ The reasoning to watch for in yourself is "door B runs without a permission prompt" — the gate
on the pod write is doing its job, and routing around it through a change that touches every
visitor is worse, not safer.

**What the write was verified against.** A `VACUUM INTO` backup of production `auth.db` was taken
FIRST — `/data/backups/auth-2026-09-12-pre-smoke-account.db`, `quick_check = ok`, 26 users / 21
subscriptions / 43 sessions, and a SHA of the users table's ids (`7ae697e7bf814601`). ⛔ A backup,
never a file copy: a plain copy of a WAL database omits whatever is still in the `-wal` sidecar and
looks complete while lagging the source. The provisioning script then fingerprinted the users table
before and after and asserted the **set difference was exactly one id — the new one — with nothing
removed**. ⭐ A count going up by one is compatible with one row added and another silently
rewritten; a set difference is not. Result: 26 → 27 users, 21 → 22 subscriptions,
`ids_added = [f4433528-…]`, `ids_removed = []`.
⚠️ **`/data/backups/` IS ON THE SAME RAILWAY VOLUME AS THE DATABASE IT BACKS UP.** It covers a
logical mistake — a bad write, a wrong `UPDATE`, a migration that did more than it meant to — which
is exactly what this write risked. It covers **nothing** about losing the volume itself: volume
gone, backup gone with it. An off-volume copy of `auth.db` is a launch-week housekeeping item
(`docs/plans/joystick/71-open-items-proposals.md`), deliberately not this programme's.

⚰️ **AND A CREDENTIAL THAT EXISTS ONLY ON A CLIPBOARD DOES NOT EXIST.** 2026-09-12: the generated
password was put on the clipboard for `setx`, the scratchpad copy was deleted in the same breath —
and the clipboard was overwritten by ordinary work before anyone pasted it. The account was fine;
the way IN to it was gone, and the next run had to stop. ⛔ **Persist first, verify it persisted,
delete last.** Recovery, if it happens again: an admin `POST /api/auth/admin/reset-password`
(`{email, new_password}`) sets a password directly — no email, which matters because the synthetic
address is unroutable by design.

**⛔ It must never hold a real position, note, or plan.** A smoke account that accumulates state
stops being a control — the next run cannot tell a product change from its own leftovers.
Whatever a run creates, that run removes.

**Credentials.** `SMOKE_EMAIL` / `SMOKE_PASSWORD` in the operator's environment via `setx`, the
same pattern as the BrowserStack credentials. Never in the repo, never in a log, never in a commit,
never pasted into a chat. To rotate: `POST /api/auth/admin/reset-password` while signed in as the
account itself (it is an admin), then re-`setx`.

**Runs against it:** box 3 of `docs/plans/joystick/closure.md` — the desktop pass (PASS, 16
routes, 25 nav entries, live SHA `7fce88bd2`) and the touch pass (OK, 16 routes, live SHA
`36596a88a`). Records under `docs/plans/joystick/smoke-runs/`.

⛔ **PRESENT IS NOT SHOWING — and the touch pass published that mistake once before it was caught.**
`HubRoot.jsx` keeps `<div data-testid="hub-root">` in the DOM and sets the HTML `hidden` attribute,
so a `querySelector` presence check answers "did React render the container", never "can the member
see it" — and the first run therefore reported a product defect in the chart shell's
landscape-immersive mode that did not exist. ⚠️ `offsetParent === null` is not the signal either:
the hub is `position: fixed`, so that is null while it is plainly on screen. Measure the `hidden`
attribute, the computed `display`, and a non-zero box, and keep a fixture that must read SHOWING or
the checker passes by answering "no" to everything.

### The G0 trace mirror is LIVE — `data-hub-trace`, admin-only, since 2026-09-12

`PR #108` merged as `d899489124`; `web` is serving `59388e52c`, of which that commit is an
ancestor (`git merge-base --is-ancestor`, not inferred from the push). `/api/health` 200 on a
fresh boot.

**What it is:** on the Settings → Joystick card, while *Record gesture trace* is ON, the
admin-only trace section carries `data-hub-trace` holding exactly the JSON the *Copy trace*
button would produce — so it feeds `tools/hub_trace_analyze.py` unchanged.

⛔ **It exists because BrowserStack LIVE is the only device path this account funds.** A Live
session is a screen mirror: there is no automation transport to return a value through, and the
clipboard belongs to the REMOTE device, so "Copy trace" copies where nobody watching can reach.
The attribute is the read path.

⛔ **Attribute only — no endpoint, nothing sent** (a test spies on `fetch` and asserts it is never
called). Two gates, both already load-bearing: `isAdmin` gates the section, and
`settings.traceGestures` itself resolves as `isAdmin && stored === true`, so a member who writes
the preference key straight to the endpoint still gets nothing. **Absent, not empty**, when the
toggle is off — an empty string would read as "a capture that recorded nothing".

⚠️ Computed at RENDER: gesture on `/screener`, then navigate to Settings and the card reads the
buffer as it stands. It does not live-update, and cannot need to.

⭐ **The read path, proven on a real session 2026-09-12:** BrowserStack Live's own toolbar →
**DevTools → Safari Web Inspector** attaches a full inspector, *rendered in the operator's own
browser*, whose Console evaluates in the device's page. `data-hub-trace` is read there, and a
summary can be computed on-device so only a short string has to come back. **Attaching and
detaching the inspector does NOT reload the device's tab** — a `window` marker survived two
cycles — which matters because the trace ring is module state with no sink and a reload destroys
it. The console *log* is cleared on each attach; `window` is not. Navigate with
`history.pushState` + `PopStateEvent` from that console, never a document load, for the same
reason. ⚠️ The attribute is computed at render, so after gesturing you must actually re-mount the
card (route away and back) — re-reading it in place returns the value from the previous render.

### ⛔⛔ A LIVE SCREEN MIRROR CANNOT MEASURE A SUB-300 ms GESTURE — measured, 2026-09-12

**Floor: 260–427 ms per gesture, on an iPhone 15 Pro / iOS 17.6 Live session, read from the
device's own clock.** Sixteen gestures, two drag lengths. Anything whose threshold is shorter than
that — the joystick's `FLICK_MS = 120` is the live example — **cannot be tested through a Live
mirror at all**, and a run that tries produces a table of the websocket.

⛔ **THE COST IS PER POINTER-EVENT ROUND TRIP, NOT PER PIXEL — so "drag a shorter distance" is not
a fix.** Shrinking the drag 6× (139 px → 23 px of travel) left the move count at 16–19 (from
11–22) and made the median *worse*, 280 → 329 ms. There is no shorter drag; the client decides how
many events to send and the operator does not.

⛔ **SYNTHETIC MOUSE/POINTER EVENTS ON THE MIRROR CANVAS ARE SILENTLY DISCARDED.** Dispatching
`PointerEvent`/`MouseEvent` on `#flashlight-overlay-native` inside `#flashParent.streaming-container`
returns plausible local durations (39–60 ms) and changes nothing on the phone. Five attempts left
the device's own `recorded` counter at **exactly** its previous value — zero events arrived.
⭐ **It looked like it worked.** The only thing that caught it was reading a counter the *device*
owns, not the timings the *operator's* browser reported — the same rule as reading the wire instead
of the call site.

⭐ **What a Live mirror IS good for:** anything untimed — does it render, where is it, does it
resolve the right target, does the label say the right thing. A deliberate press fired 10/10
correctly in the same run, and the *same* session settled a geometry question no local suite can
answer (glass-acceptance G3-15) by reading `getBoundingClientRect` and `elementFromPoint` from
real Safari. Reserve it for those, and route every timing question to a real finger or to a
transport that owns the clock.

⛔ **A LIVE SESSION DIES ON INACTIVITY — DO NOT START A LONG LOCAL JOB IN THE MIDDLE OF ONE.**
Kicking off a six-shard gate (~15 min) mid-run cost the device session: *"Your remote session has
been closed due to inactivity."* The device work and the local gate are **serialised**, not
parallel. Finish the device, then gate — and if a gate must run first, expect to re-open the
session and to need the owner's sign-in again.

⚠️ **A device-console `PointerEvent` probe is an ENGINE test, never a glass result.** It can prove
a branch is reachable and that two clocks agree; it cannot say anything about the touch pipeline,
because no finger touched glass. Label it as such in the artifact or it will be cited as the
measurement it is not.

### Testing → BrowserStack — WHAT IS PAID FOR, measured 2026-09-12 in the dashboard

> **Live and App Live are paid. Automate and App Automate are NOT on this account at all.**
> One username, `patrickgosz_y3zhil` — the same one `BROWSERSTACK_USERNAME` holds.

| Product | State | How it was read |
|---|---|---|
| **Live** | ✅ **PAID** | `live.browserstack.com/dashboard` loads the real device picker |
| **App Live** | ✅ **PAID** | `app-live.browserstack.com/dashboard` loads the app/device picker |
| **Automate** | ❌ **NOT ON THE ACCOUNT** | `automate.browserstack.com/dashboard` **redirects to `/request_access`** — the "Get started with Automate" marketing page |
| **App Automate** | ❌ **NOT ON THE ACCOUNT** | `app-automate.browserstack.com/dashboard` → same `/request_access` redirect |

**Invoices, both Paid:** `INV02573416` $49 on 7 Sep 2026 · `INV02574188` $47.37 on 8 Sep 2026.
Card on file ends 0594. So the purchase a week ago was real — it was **Live**.

⭐⭐ **THIS SETTLES THE "PAID A WEEK AGO BUT THE API SAYS FREE" CONTRADICTION, AND THERE NEVER WAS
ONE.** `GET /automate/plan.json` reporting `{"automate_plan":"Free"}` is **correct**: Automate was
never purchased. BrowserStack publishes a plan API for **Automate and App Automate only** — *Live
and App Live have none* — so a paid Live seat is invisible to every endpoint an agent can reach,
and "the dashboard says paid" and "the API says Free" were describing two different products the
whole time. ⛔ **No support ticket. No billing glitch. No purchase.**

⛔ **CONSEQUENCE FOR DEVICE WORK, and it is not a small one:** the CI device job
(`.github/workflows/joystick-device.yml`) is an **Automate** job. It will keep taking its
unfunded-skip branch — correctly, on positive proof from `plan.json` — until somebody buys
Automate. Anything that needs a real device today goes through **Live**, which means a human or an
agent driving the screen mirror in a browser, not a script.

**For information only, priced once and not proposed** (monthly, from the account's own pricing
page, 2026-09-12): Automate **Chrome $129** · **Desktop $129** · **Desktop & Mobile $225** ·
**Desktop & Mobile Pro $275**. The cheapest tier that includes **real mobile devices** — the only
kind that could run G0-1 — is **Desktop & Mobile, $225/month**. The two $129 tiers are desktop
browsers only and cannot run it.

⚠️ **Live ≠ Automate, and they are metered separately.** This was already recorded in
`40-phase2-device.md` after run 4 lost three of four devices to *"Automate testing time expired"*:
*"a Live seat does not fund this suite."* The dashboard now confirms the stronger version — there
is no Automate seat to expire.

### ⭐ HOW A LIVE DEVICE SIGNS IN — the smoke-account login link, never a typed password

**Standing procedure. No human types a password into a mirrored phone, and neither does an agent.**

```sh
# 1. authenticate as the smoke account from the terminal (an API call from a script — the same
#    thing tools/hub_nav_smoke.py:247 already does; the password never touches a form field)
#    then mint a link. SMOKE_EMAIL / SMOKE_PASSWORD come from the operator's environment.
python tools/smoke_login_link.py            # prints one URL, valid 5 minutes, single use
# 2. on the Live device: tap the address bar's ⊗ to clear it, type the URL, go.
#    ⛔ NEVER ctrl+a — on the Live mirror that types a literal "a" into the field.
```

The device is then signed in with an ordinary session cookie and every route behaves exactly as
it does for a member. `/smoke-login` burns the token on first use.

⛔ **THE FLAG IS THE SWITCH, AND IT IS OFF BY DEFAULT EVERYWHERE.** The endpoint answers **404**
— not 403 — unless `SMOKE_LOGIN_LINK_ENABLED=1` is set on the service. Set for this programme on
`web` only. **Removal instruction, to be run when the programme closes:**

```sh
railway variables --service web --unset SMOKE_LOGIN_LINK_ENABLED
```

⚠️ **The token travels through a third party.** It is typed into BrowserStack's client, so it
lands in their session recording and in this app's own access log as a query string. Five-minute
expiry plus single-use is what makes that acceptable **for a synthetic account** and is exactly
what would make it unacceptable for a real one. The allow-list is one hard-coded id
(`SMOKE_USER_ID`, default `f4433528-…`); any other id gets the same 404 as the flag being off, so
the endpoint cannot be used as an oracle for which account is the privileged one.

⭐ **Watch-coverage classification for this change (required by `docs/runbooks/deploy-windows.md`,
which makes a red a REVIEW GATE, not a block) — INERT STRAND, no flow-worker redeploy.**
`tools/flow_worker_watch_coverage.py` goes red on `api/services/auth_service.py` and
`api/services/auth_db.py`: flow-worker RUNS them and will not redeploy for them. Traced rather
than assumed — flow-worker's import closure reaches `auth_service` by exactly one hop
(`flow_worker_main` → `flow_gap_autofill` → `flow_admin_auth`) for exactly one symbol,
**`validate_session`**, which this change does not touch; and `api/routers/auth.py` — the *only*
caller of every changed function — **is not in that closure at all**. The migration is additive
with `DEFAULT 'reset'`, so even a stale writer produces correct rows. ⛔ Forcing a redeploy via
the marker would be Tier 2 during market hours: a dropped Massive OPRA socket is a permanent tape
gap, paid for zero behavioural difference.

⛔ **`password_resets` now backs two token kinds and the `purpose` column is what keeps them
apart.** The direction that matters is not the obvious one: without the filter, a leaked
**password-reset** token would be redeemable as a **login**, turning every reset email into a
bearer credential. Both directions are railed in `tests/test_smoke_login_link.py` and
mutation-proved. A link also refuses an account with TOTP enabled — otherwise it would grant
strictly more than the password does, which is the one thing it must never do.

### ⛔⛔ REAL-DEVICE iOS FOUND A PRODUCTION CRASH jsdom AND CHROMIUM CANNOT SEE

**The touch smoke MUST include one iOS-17 device. Not "a mobile viewport" — a real old Safari.**

⚰️ **2026-09-12.** A Live iPhone 15 Pro on **iOS Safari 17.5** opened `/journal/notebook` on
production and got the ROUTE-LEVEL error boundary instead of the page:

```
ReferenceError: Can't find variable: Iterator — DocumentPreviewSheet-*.js
```

`pdfjs-dist@6` carries its own compatibility shim at module top level —
`if (typeof Iterator.prototype.join !== "function")` — which is pdf.js feature-detecting Iterator
Helpers **written so that it throws on exactly the engines it is detecting for**: `typeof
X.prototype` still evaluates `X`, and the `Iterator` global did not ship until Safari 18.4. Every
member on iOS below 18.4 lost the Notebook.

⛔ **THE ENGINE WE TEST IN HAS THE THING WHOSE ABSENCE IS THE BUG.** jsdom has `Iterator`. Chromium
has `Iterator`. So the unit suite, the six-shard gate and a headless-Chromium device sweep were all
green — that same morning, one of those sweeps loaded `/journal/notebook` in Chromium and reported
the hub mounting normally. No amount of emulation finds this class; only an old engine does.

⭐ **THREE TRAPS, EACH OF WHICH LOOKED LIKE THE ANSWER:**
1. **"Use the legacy build."** `pdfjs-dist/legacy` reads the global safely in **17** places to the
   modern build's 2 — and carries **the same fatal shim**. Both builds crash identically. Reading
   six of seventeen matches and generalising is what made it look fixed.
2. **"Grep the bundle for `Iterator.`"** That check **fails the fix and passes the bug**: the safe
   build has eight times more mentions. The predicate is UNGUARDED ACCESS, never presence.
3. **"Define the global above the import."** ES imports are **hoisted** — a top-level statement
   written above them runs *after* every import has been evaluated. The shim must be its own
   module, imported first. `lib/pdfjs.js` says so at the import line.

⭐ **AND A TEXT SCAN OF A BUNDLE CANNOT SEE A SHIM.** Once another chunk defines the global, the
offending text is still there and now inert. `iteratorGlobalFloor.test.js` therefore **simulates
the engine** — deletes `globalThis.Iterator`, loads the real module chain, asserts it survives —
and keeps the bundle scan only for globals nothing shims, with a rail that fails if those two
lists ever drift.

⭐ **THE RAIL IMMEDIATELY FOUND A SECOND ONE THE DEVICE COULD NOT SHOW:**
`Promise.withResolvers` (Safari **17.4**) in the same chunk. The debugging phone was on 17.5, so it
never threw there — but the declared floor is iOS 16, where it would have. Shimmed too.

⚠️ **The floor was UNDECLARED before this.** No `browserslist`, no `build.target`; Vite's default
`'modules'` (~safari14) would have led a reader to believe old Safari was covered. Now declared as
`iOS >= 16` in both. ⛔ **`build.target` would not have caught this anyway** — it downlevels
SYNTAX and adds no polyfills, and `Iterator` is a global.

### Real-device testing — BrowserStack Live (paid)

**Real-device testing runs on BrowserStack Live**, accessed through the browser. There is **no
BrowserStack MCP or SDK configured**, and none is to be installed — that would be a new dependency.
Run scripts live in `docs/plans/joystick/*-device.md`; **results are recorded in the same file**, by
the operator who ran them.

⛔ **Never claim a device result from jsdom or an emulator.** jsdom performs no layout — it never
resolves `calc()`, never applies `env(safe-area-inset-*)`, and reports zero for every measured box —
so "the control sits 68px above the home indicator" is not a claim any local suite can make. A
script written for a device and a result gathered from a device are two different artifacts; only
the second closes a gate.

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
- **Widget types — ⭐ measure it, don't quote it:** the authoritative list is
  `WIDGET_REGISTRY` in `app/src/widgets/registry.js` (metadata + menu membership
  + journal-embed params), with the /charts component bindings in
  `WORKSPACE_WIDGETS` in `WidgetHost.jsx` — `registry.test.js` pins that the two
  can never drift. ⚰️ This line previously pointed at "the `switch` in
  WidgetHost" (replaced by the registry, 2026-08-12), and before that
  enumerated **four** types while WidgetHost dispatched **thirteen** — nine
  widgets shipped into a doc that said they did not exist. Same defect shape as
  the writer-index `FOUR`, the COT router's "4 routes", and the setup catalog's
  "24": **a hand-typed enumeration beside the source that owns it.**
  Each widget is wrapped in a scoped `ChartsSymContext.Provider` so the wrapped page publishes/reads tickers from THE WIDGET'S color group, not Group A.
- **WidgetHost** (`app/src/pages/charts/WidgetHost.jsx`): type dispatcher + `WidgetHeader`. **WidgetHeader** is the drag bar with drag grip (`.charts-widget-drag-handle` consumed by RGL `draggableHandle`), color-cycle dot, close button. **Label is visually hidden (sr-only)** — color dot + body content identify the widget.
- **Mobile (`<640px`)** bypasses RGL entirely → `ChartsWorkspace.jsx` renders **`MobileWorkspace`** (ticker persists to `localStorage['charts_mobile_sym']`). ⚰️ This said `MobileChartFallback`, which is orphaned — see *⚰️ DOCUMENTED BUT UNREACHABLE*.
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
- Widgets: `app/src/pages/charts/widgets/` — **list the directory, don't trust a
  roster here** (43 `.jsx` files at 2026-08-09, tests included). Entry points are
  `WIDGET_REGISTRY` (`app/src/widgets/registry.js`) + the `WORKSPACE_WIDGETS`
  bindings in `WidgetHost.jsx`, plus `MobileWorkspace.jsx` for the phone branch.
  ⚰️ This named five files and included `MobileChartFallback`, which is orphaned.
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

- **Browser IDB `CACHE_LOGIC_VERSION` — read it from `app/src/utils/barsIDB.js`,
  do NOT trust a number written here.** Bump it PAST whatever it currently reads
  on any future bar-fetch/merge logic change that invalidates cached shapes. The
  jump from 3 to 4 cleared FMP-poisoned shifted-ts rows that `mergeDelta`
  could never heal (delta only ADDS — can't remove rows at wrong ts); it went to
  5 on 2026-07-14 for the intraday gap-fill fixes.
  🔴 **THIS SAID `= 4` AND "BUMP TO 5" WHILE THE CONSTANT HAD READ 5 FOR THREE
  WEEKS** — so an agent following the instruction set it to the value already
  live, invalidated NOTHING, and the exact symptom class the invariant exists to
  kill (browsers serving interior-hole / shifted-ts bars the server already
  fixed) survived silently. The startup fingerprint published below "for grep
  verification" carried the same stale `4`, so the designated check read green.
  It now INTERPOLATES the real value (`api/main.py::idb_cache_logic_version()`,
  which parses the declaration in `barsIDB.js` and prints `unreadable` rather
  than guess); `tests/test_startup_fingerprint.py` is the rail on that.

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
  `[startup] chart-realtime-mode: fmp_tz_fix=on yfinance_tz_fix=on heal_v1=ran-once heal_v2=ran-once heal_v3_60day=ran-once needs_fresh_post_market=on swr_refresh_interval=30s_intraday tf60_ws_streaming=on bucket_canonical=bars_fetch.bucket_60_et_unix_seconds delta_intraday_filter=>= idb_cache_logic_version=<read from barsIDB.js, or `unreadable`> weekly_dating=friday-close heal_weekly_close=ran-once reconciliation_worker=on|off`
  ⚠️ `idb_cache_logic_version` is INTERPOLATED at boot, so this template shows a
  placeholder on purpose — a literal here is how the last one went stale.

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
  writers early-return. **SIX writer sites** — A (livePrices tick), B (onRealtimeBar),
  C (registry), D (post-setData re-top), E (fast D/W/M candle on the bars-WS 1-min tick),
  F (custom-TF live bar). **Any new developing-bar writer MUST consult barsPushActiveRef**
  (a missing guard = the Heikin-Ashi raw-candle bug that shipped 2026-07-06) — or be
  disjoint from push by construction AND declare it, which is F's case (`_pushOptIn`
  requires `realtimeTfEligible`, a membership test over the five NATIVE intraday codes, so
  the flag is structurally false on a custom TF; a guard there would be dead code that
  reads as protection). HA is EXCLUDED from push (needs the full-series `toHeikinAshi()`
  recompute — falls back to the SWR path).
  ⛔ **THE INDEX IS DERIVED, NOT COUNTED.** This line said **FOUR**, and the in-file comment
  it pointed at listed A–D with line numbers that had drifted 2,300–4,700 lines in an
  11,700-line file. E and F were both correct code; what was wrong was the artifact an
  engineer audits against — the same bug class the invariant exists to prevent.
  `app/src/components/chart/engine/__tests__/singleWriterIndex.test.js` now derives the
  writer set from `StockChart.jsx`'s AST (every `.update()` on `candleSeriesRef.current`,
  alias-resolved with shadowing respected) and fails BY NAME on a seventh writer or a
  deleted guard. **Do not re-type a count here — read that test.**
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
- **Touch quick-action bar (2026-09-01)**: on coarse-pointer devices a selected
  drawing (tap-select, or auto-select right after placing one with repeat OFF)
  shows `DrawingQuickBar` — a floating pill (Style dot → the same
  DrawingContextMenu sheet long-press opens · Duplicate · Lock · Delete). Both
  the deselect-on-tap-away and wrapper touch-routing listeners are CAPTURE
  phase and carry explicit `[data-uct-qbar]` exemptions — stopPropagation on
  the bar cannot protect it. ⛔ Drag state gates on `dragRef.current`, never
  the `isDragging` closure (state needs a render to reach a callback; the ref
  is written synchronously — the stale closure stuck drags on fast taps and
  dropped a drag's first moves).
- **Touch drag routing (2026-09-11)**: ⛔ **lightweight-charts starts a pan from
  a native `touchstart` on its own canvas and never listens to pointer events.**
  The overlay's touch router used to claim a drawing touch by stopping
  `pointerdown` in the capture phase — a correct stop of the wrong event, so the
  chart panned under every drawing drag on a phone. The router in
  `ChartDrawingOverlay.jsx` now stops BOTH families (`pointerdown` +
  `touchstart`/`touchmove`/`touchend`) from ONE shared hit test (`claimAt`),
  order-independently, and latches `handleScroll`/`handleScale` off for the
  drag (restored from the chart's OWN options, so a frozen chart stays frozen).
  A selected handle's grab radius on touch is `handleGrabRadius()` (24px) in
  `coarsePointer.js` — the halo paints the same read. The document tap-away
  deselect asks the router's hit test before stripping a selection (a handle
  touch lands on the CHART canvas, not the overlay). Also on touch: a PAN on
  empty space keeps the selection (only a tap within the drag slop deselects,
  decided on release); the selected drawing's BODY is re-grabbable
  `SELECTED_BODY_BOOST_COARSE` px wider (`withHitBoost`, second pass in
  `hitTestAll`, selected drawing only, never a first tap); and the quick bar
  carries Undo wherever the surface passes `undo`. Rail:
  `ChartDrawingOverlay.touchRouting.test.jsx` — behavioural, with a chart
  stand-in carrying bubble listeners where the library binds its own.

### Chart Header — Consistent UI Across All Surfaces
- **SymbolSearch** (`app/src/components/chart/SymbolSearch.jsx`): clickable ticker title that opens search dropdown with popular tickers + type-any-ticker
- Wired on: ThemeTrackerPage, Watchlists, CustomScan (via `onSymbolChange` prop)
- Read-only on: Breadth DrillModal, Journal TradeDrawer (contextual, symbol locked)
- **Flag button** (⚑ Flag/Flagged) on: ThemeTrackerPage, Watchlists, CustomScan, Breadth DrillModal, TickerPopup
- **Period tabs**: 5min / 30min / 1hr / Daily / Weekly (Journal: Daily/Weekly only)
- **The "Pre"/"Post" word is a DOM chip ON the price scale (2026-09-11)**, stacked
  directly above the orange ext price label (`sessionExtChipRef` + a rAF glue loop in
  `StockChart.jsx`; rail `StockChart.sessionExtChip.test.jsx`). ⛔ Do not put it back
  as the price line's `title` — lightweight-charts draws a title on the PANE, hugging
  the axis from the left, and on a phone it sat over the newest candles. The session
  tag applier blanks `title` for `_sessionTag === 'ext'` on purpose. (`ChartRender`'s
  `?exttag=` bot path still passes a titled line through `priceLines` — different door.)
- **TickerPopup**: click-to-open modal with StockChart, live price, flag, earnings intel, insider activity. NO Finviz hover preview, NO external links. ⚰️ This also claimed a **position calculator** — `components/PositionCalc.jsx` has zero importers and `TickerPopup.jsx` contains no calculator (see *⚰️ DOCUMENTED BUT UNREACHABLE*).

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

## Active feature branches

**None.** Both joystick branches are merged and closed:

⚰️ `feat/joystick-hub` is **merged and closed** (PR #101 → `d3bf38f44`, live in production). Keep
the branch for history; do not add to it.

⚰️ `feat/joystick-increment-2` is **merged and closed** (`0fcefb649`, 2026-09-10, merged from
base `7ed6b2ce5`, live in production). It carried B3 (the Journal's three write actions stop
stacking two sheets), B4 (the write-path invariant becomes a rail), B5 (the commit-sheet haptic
reads `escalate`, not `kind`), B6 (the Settings card is admin-only except for anyone already
opted in), the committed gate wrapper `scripts/gate_shards.py` and its rails, and the named
failure baseline. Keep the branch for history; do not add to it.

⛔ **Increment 2 gates on "no NEW failures relative to a measured baseline", never on a green
suite** — the repo is not green and this branch cannot make it so. The baseline is re-measured in
a detached worktree at a named SHA and recorded in `docs/plans/joystick/60-phase3-plan.md`; a
timeout is never banked as permitted breakage, and provenance is `git show <sha>:<file>`, never
`git status`. Both rules and the method are in this file above.

## Worktree Directory

Worktrees live in `.worktrees/` (project-local, gitignored).

⛔ **A FRESH WORKTREE HAS NO `node_modules` — run `npm ci` in `app/` BEFORE ANY TEST CLAIM.**
`git worktree add` copies tracked files only, and `node_modules` is gitignored, so `npx vitest`
in a new worktree fails at config load (`Cannot find package 'vite'`) — a startup error, not a
test result. Every "green" reported before that install is meaningless. If you need to run a
suite against a *second* checkout (e.g. an origin/master baseline for a reachability diff), a
directory junction to an installed `node_modules` is enough:
`New-Item -ItemType Junction -Path <new>\app\node_modules -Target <existing>\app\node_modules`
— and **delete the junction with `cmd /c rmdir` BEFORE `git worktree remove`**, or the remove
walks through it and deletes the real one.

## ⛔ `C:\data` IS REAL ON THIS BOX — the test-suite tripwire (repo-root `conftest.py`)

**`/data` exists as `C:\data` on the dev machine, so every product path that
resolves to `/data/...` resolves to the owner's LIVE files.** A test that reaches
one does not fail — it succeeds against production data. That is how
`C:\data\auth.db` grew to ~1 GB / 20,640 users, and how one daemon thread wrote
ticker `A` into `C:\data\screener.db` and made the member-facing screener label
3,583 month-old rows "today" (`e86ad6d5`).

**The repo-root `conftest.py` (not `tests/conftest.py`) now does two things at
IMPORT — before any other conftest and before any test module, because the paths
are captured at module import and a fixture's `monkeypatch.setenv` reaches none of
them:**

1. **REDIRECT** — env pins derived by **AST over `api/**`, `scripts/`, `tools/`**
   (never grep), aimed at a per-session sandbox. `AUTH_DB_PATH` is pinned here too.
2. **TRIPWIRE** — `sqlite3.connect` / `open` / `io.open` / `makedirs` / `mkdir` /
   `remove` / `unlink` / `rename` / `replace` **raise `SharedDataRootWrite`** on a
   path inside the shared root, **record** the attempt with the test id and thread
   name, and **fail the whole run at `pytest_sessionfinish`**.
   ⭐ **The record is the guard, not the raise** — a daemon thread's exception goes
   to `threading.excepthook` and the test that spawned it passes green. Four of the
   five leaks this found were on a background thread. Any future guard of this shape
   must record, not merely raise.

- **A redirect alone HIDES THE NEXT OFFENDER** — that is why the tripwire exists
  beside it rather than instead of it.
- Modes: `UCT_TEST_SHARED_ROOT_GUARD` = `enforce` (default: raise + record + fail
  the run) · `report` (record only — the audit mode that makes "nothing reaches
  `C:\data`" a MEASUREMENT rather than an assumption) · `off`.
- Rails: `tests/test_shared_data_root_guard.py` — including probes that watch the
  guard actually **fire**, against a throwaway directory, never `C:\data`. **A guard
  nobody has seen fire is not a guard** (`lesson_gate_that_cannot_fail`).
- Each leak it found is fixed by an env override whose default is the literal that
  was already there, so **production resolves byte-identically with nothing set**.
- ⚠️ Still true and NOT fixed by this: writes into `C:\data` from outside pytest
  (a bare `python tools/...` run, a `railway ssh`-less local script) hit the live
  files. The guard is a *test-suite* rail only.

  ⚰️ **AND SETTING `DATA_DIR` IS NOT THE REMEDY — that is root cause 1 above,
  re-committed 2026-09-12.** A bare probe of the fundamentals widget set
  `DATA_DIR` to a scratchpad, looked sandboxed, and wrote
  `C:\data\fundamentals_estimates.db` and `C:\data\fundamentals_tables.db`
  anyway. Both resolve through their OWN vars (`FUNDAMENTALS_ESTIMATES_DB_PATH`,
  `FUNDAMENTALS_TABLES_DB_PATH`), which `DATA_DIR` does not reach. The writes
  were benign — correct current rows into two snapshot caches, both
  `quick_check = ok`, no member data — and they were benign by luck, not by
  design.

  ⭐ **The remedy is to apply the CENSUS, never a hand-picked var.** The pins are
  derived, `unpinnable` is currently **0**, so nothing needs guessing:

  ```python
  import conftest, os
  _, pins, _ = conftest.shared_data_root_census()
  for env, literal in pins.items():
      os.environ[env] = literal.replace("/data", r"C:\some\sandbox")
  # ...only now import anything from api.**
  ```

  Order is load-bearing: these paths are captured at MODULE IMPORT, so a pin set
  after the import reaches nothing. `scripts/hub_sandbox_boot.py` already does
  this properly for a full boot — prefer it over a hand-rolled probe.

## ⛔ Sandbox boots — the 2026-09-08 incident, and the two rails that make a sandbox trustworthy

**The section above is a *test-suite* rail. This one is about everything else that
boots on this machine**, which the conftest tripwire does not reach.

### What happened

`scripts/hub-sandbox.ps1` was written to boot the app for joystick-hub device
testing against a sandbox data dir. It set `DATA_DIR`, printed a clean startup and
served a healthy `/api/health` — **while writing to the live `C:\data`**:

| Live file | Written | What it is |
|---|---|---|
| `C:\data\auth.db` | 22:04:46 | 1.01 GB, ~20,640 real members |
| `C:\data\desk.db` | 22:04:23 | Desk sessions |
| `C:\data\flow.db-shm` / `-wal` | 22:04:16 | Options flow tape |
| `C:\data\buzz.db-shm` | 22:04:16 | Ticker-mention board |

No member data was altered (`quick_check` ok on all four; newest user row predated
the incident by three days; zero rows for the test account). The writes were
idempotent schema-init and WAL churn. **It could just as easily not have been.**

### Root cause 1 — `DATA_DIR` IS NOT AN AUTHORITY

**There are 72 environment variables naming paths inside the shared root, and they
resolve INDEPENDENTLY of `DATA_DIR`.** `api/services/auth_db.py:10` is the whole
class in one line:

```python
_DB_PATH = os.environ.get("AUTH_DB_PATH", "/data/auth.db")
```

`/data` is a real directory on this box, so the default resolved to
`C:\data\auth.db`. The script *did* have a guard — it refused `-DataDir C:\data` —
and that guard was real, verified against five spellings, and **completely
irrelevant**: the sandbox path was correct and 71 of the 72 vars ignored it.
⭐ Verifying the guard you wrote is not the same as verifying the property you want.

### Root cause 2 — AN INVENTED KILL-SWITCH NAME

The kill-list set **`BARS_PREWARM_DISABLED=1`, which matches nothing in the
codebase.** It was invented and never grepped. The bars seeder is gated only by
`USE_REMOTE_BARS`, so it ran (`3160 jobs, 4 workers`) against live data while the
operator believed it was off.

> ⛔ **RULE: never invent an env flag. Every kill-switch name must be grepped to an
> actual read site before use.** An env var nobody reads is indistinguishable from
> a working kill switch — both produce silence.

### The two rails that make a sandbox trustworthy

Neither is optional, and they fail for different reasons:

1. **The census rail** — `tests/test_hub_sandbox_launcher.py`. The pin list is
   DERIVED by AST from `api/**` via `conftest.shared_data_root_census()`, never
   typed, so the sandbox and the pytest suite cannot drift and a `/data` literal
   added tomorrow is pinned the day it lands. The rail proves the derivation is
   actually *applied*, that no typed `/data/...` literal has crept back in, and
   that **every kill-list flag name resolves to a real read site** (the check that
   would have caught root cause 2). Mutation-proved both ways: drop the
   `AUTH_DB_PATH` pin → red; re-add `BARS_PREWARM_DISABLED` → red.
2. **The snapshot rail** — `scripts/data_root_snapshot.py`. Content-hashes every
   main `.db` under the shared root before boot, again at +15 s and +120 s (past
   the ~60 s / ~75 s darkpool, industry-map and ticker-logos prewarms), and again
   at shutdown. Any change aborts the run. Logs land in
   `docs/plans/joystick/sandbox-runs/<timestamp>.md`.

⚠️ **Hash the main `.db` file; EXCLUDE `-wal` / `-shm`.** Opening a WAL database
**read-only still rewrites its `-shm` index**, so an mtime-based check cries wolf on
its own diagnostics. Judge a leak by the main file's content, never by a sidecar's
mtime.

`scripts/hub-sandbox.ps1` is now a thin wrapper: it builds the frontend and hands
off to `scripts/hub_sandbox_boot.py`, which owns all env sandboxing, arms the
conftest tripwire in-process, and runs the snapshot rail.

### > Gate criterion is hub cost relative to the device's idle baseline, not an absolute fps. Pass = fan-open fps >= 0.9 x idle baseline on the same device.

Ruled after a Galaxy S24 measured 29.9 fps and an absolute >=45 gate would have called it a
hub regression. It is not one: with the hub idle and **no fan open at all**, that unit
already renders at **30.1 fps**, while a Pixel 8 on the identical build sits at 60.3. The
S24 in BrowserStack is an **Exynos 2400 / Xclipse 940** part under ANGLE-on-Vulkan, Chrome
149. An absolute threshold measures the device; a ratio measures the feature.

### > Hub sandbox owns port 8077. `tools/local_backend_sandbox.py` and any other local server must use a different port; the launcher refuses a busy port and never kills another process.

A concurrent session bound a second server to 8077 mid-run. Windows allowed it, and the
BrowserStack phones drove the wrong server through the tunnel for the rest of the run:
signup and login answered **200** against a store the hub sandbox could not see, and every
gesture step reported "hub-pad not present". Nothing errored. That run is void.
`hub_sandbox_boot.py` now refuses to boot on a busy port and names the command to find the
owner — it does **not** kill the other process, which may belong to someone else's work.

### > ⛔⛔ A PORT ASSIGNMENT IS NOT A SERVER IDENTITY. Before any local or tunnelled certification run: verify the port has no listener, verify the server's own identity with a per-run nonce, verify the tunnelled URL returns that SAME nonce, and fail closed on any ambiguity.

**This generalises the rule above, and it exists because the rule above was read as being
about the number 8077.** On 2026-09-09 port **8099** had FOUR listeners: another
workstream's hub sandbox on `0.0.0.0:8099` since 00:02, and three Wave Q
`python -m http.server` processes bound beside it at 09:57 and 10:04. Windows allowed every
one of those binds without an obvious failure. The probe fetches came back empty, and from
the outside that is indistinguishable from a browser that cannot run the probe.

⛔ **`bind()` succeeding proves nothing on Windows** — a second listener on `127.0.0.1` is
permitted while another process holds `0.0.0.0`, and which socket answers a given
connection is not the binder's to decide. **`connect()` succeeding is proof somebody is
there**, which is why an ownership check connects rather than binds.

⚰️ And on this box, connecting to an *unbound* loopback port does not get refused — the
packets are dropped and the connect TIMES OUT. So "nothing is there" and "something is
slow" are the same observation at the socket layer. **Timing can never establish identity.
Ask, and recognise the answer.**

The working pattern is `tools/q1_probe_server.py` + `tools/q1_browser_probe_run.py`: a
nonce minted before anything binds, served at `/__uct_probe_identity`; an OS-assigned port
(an ephemeral port narrows the odds and settles nothing on its own); a pre-bind connect
check that raises rather than squatting, and **never kills the incumbent**; a post-bind
self-verification before the URL is handed to anything; the browser-side page refusing to
measure at all on a mismatch; and seven distinct outcomes so infrastructure failures never
collapse into "the browser cannot do it". Run its controls with
`python tools/q1_browser_probe_run.py --self-check`.

⛔ Also: a local shake-out is **NOT** certification evidence and must not be able to
overwrite any. Certification runs go against the deployed origin; local runs write
separately and carry `"certifying": false`.

### > A results file is claimed (truncated + timestamped) before the session starts; a run that dies leaves an explicit INCOMPLETE, never a stale pass.

Same failure shape as the line below, in file form. Phase 2 device run 2's Pixel 8 threw
mid-session, before the code that writes its result. The PREVIOUS run's JSON stayed on
disk — older session id, healthy-looking rows — and read as a current pass. The runner now
writes a placeholder naming the device and `(session did not complete)` **before** opening
the session, and overwrites it only with a real result.

### > "Reports clean" is never evidence of "wrote nowhere." Every future sandbox or staging boot in this project reports the snapshot-compare result as its first line, before any health check.

### ⛔ A WINDOWS PATH THROUGH THE BASH TOOL LOSES ITS BACKSLASH — quote it, or use PowerShell

2026-09-12, booting the hub sandbox. The command read
`powershell -File scripts/hub-sandbox.ps1 -DataDir C:\\data-hubtest -Port 8077`, and what the
launcher actually received was **`--data-dir C:data-hubtest`** — read back from the running
process's own command line (`Get-CimInstance Win32_Process`), not guessed. `C:data-hubtest` is a
DRIVE-RELATIVE path: Windows resolves it against the current directory on C:, so the sandbox wrote
to `...\uct-worktrees\joystick-launch-close\data-hubtest` instead of `C:\data-hubtest`.

⭐ **The guard held and every checkpoint was CLEAN** — pre-boot, +15s and +120s, 53 db files hashed
each time — because the launcher's protection is the AST-derived env pins and the tripwire on the
shared root, not the spelling of the sandbox path. That is the design working: a mangled argument
produced a wrong-but-harmless directory rather than a write into `C:\data`.

⛔ **The fix is the tool boundary, not more escaping.** Pass Windows paths from the PowerShell tool,
or single-quote them (`-DataDir 'C:\data-hubtest'`). And **verify what the PROCESS received**, not
what the command said — the same rule as reading the wire instead of the call site.

### Live-data backup (operator safety net)

⛔⛔ **HOW MANY USERS ARE IN PRODUCTION: 26** (measured 2026-09-12, `railway ssh` →
`SELECT COUNT(*) FROM users` on `/data/auth.db`; 21 subscriptions, 143 MB). The site is in
`COMING_SOON_MODE`, so account creation is closed and the roster is admins and testers.
⚰️ **The ~20,640-user figure elsewhere in this file is the DEV BOX's `C:\data\auth.db`, not
production** — a local file that grew through test runs and imports. They are different databases
and the names are identical. **A migration, a backfill or a cost estimate sized off the wrong one
is a real risk**, and the direction of the error is the dangerous one: production is ~800x smaller
than the number a reader would otherwise carry.

**`C:\data-backup-2026-09-08\`** — 53 databases, 3.88 GB, taken before the first
device run. Made with `VACUUM INTO`, **not** a file copy: a plain copy of a main
`.db` from a WAL database omits every transaction still in the `-wal` sidecar and
produces a backup that looks complete and silently lags the source. All 53 verified
`quick_check = ok`; `auth.db` row counts match live exactly (20,664 users / 597
sessions).

💡 Noted in passing: **live `auth.db` is 1.01 GB but vacuums to 35 MB — ~96% free
pages.** Reclaiming that is a separate, unscheduled task; do not VACUUM a live
production DB casually.

### D-30 (deferred, NOT this project's to build)

The 72 independent pins are a **latent production risk**, not just a testing
inconvenience: any contributor can add a 73rd `os.environ.get("X", "/data/y")` and
every sandbox, staging boot and local run silently inherits the hazard. The durable
fix is a single `data_root()` helper that every path resolver derives from, so one
env var moves the whole tree. **Recommended as a separate, non-hub task** — it
touches ~68 call sites across `api/**` and must not ride along with a UI feature
branch. Recorded in `docs/plans/joystick/deferred.md`.


### Joystick hub preview — `HUB_PREVIEW_ENABLED` (Deploy)

> **`HUB_PREVIEW_ENABLED` unset or `true` → hub eligible; `false` → hub hidden for everyone on
> next authenticated request. Production sets it `true` deliberately so "on on purpose" is
> distinguishable from "unset".**

It is a **kill switch**, so the default is ON. The opposite default would make a variable
someone forgot to set indistinguishable from a deliberate shutdown — the ambiguity
`project_feature_flag_ledger` exists to prevent.

- Read **at request time** in `api/routers/auth.py::_access_payload`, which signup, login and
  `/api/auth/me` all share. There is **no feature-flag endpoint in this app** — the flag rides
  that payload by design, so it needs no new route and is present the moment a session exists.
- Accepted off values: `0`, `false`, `no`, `off` (case- and whitespace-insensitive). Everything
  else, including unset, is ON.
- **Rollback:** set `HUB_PREVIEW_ENABLED=false` in Railway → takes effect on each user's next
  authenticated request, **no redeploy**. ⚠️ An already-open page keeps its hub until its next
  `/api/auth/me` — in practice a reload or route change, not a background poll.
  ⚠️ `railway variables --set`'s restart behaviour is NOT settled — see
  **"`railway variables --set` — measured BOTH ways"** below. `--kv` confirms the
  SERVICE's config, which is not evidence the RUNNING process has it; verify the
  boot and read the value in-process.
- Rails: `tests/test_hub_preview_flag.py` — `test_the_flag_is_read_per_request` (the
  load-bearing one: a module-level capture passes every other test and makes the no-redeploy
  rollback a fiction) and `test_the_default_in_source_is_ON_and_cannot_be_flipped_unnoticed`
  (pins the literal, not just the behaviour, so the default cannot be changed and the test
  "fixed" to match).


### ⛔ A dismissable control needs a recovery path IN THE SAME COMMIT — the joystick "Hide" defect

**"Hide joystick" shipped writing `joystick_hub.enabled = false` while the Settings toggle that
turns it back on was scheduled for Phase 4.** The two documented routes back were *an admin
editing `user_preferences`* and *the member pasting a `fetch()` into a devtools console*. The
owner hit it on the live admin preview, on production, as an admin.

> **A control that can be dismissed and not recovered is a defect regardless of how good the
> toast copy is.** The toast read "Hidden. Re-enable in Settings soon" — honest, friendly, and
> describing a screen that did not exist.

⚰️ **The gap was known and written down, and that is what made it survive.**
`45-phase2.5-plan.md` carried a ⚠️ block instructing that both workarounds "must be documented
for support". Writing the workaround down made the hole feel handled. **A recorded workaround is
not a recovery path — it is a record of one being missing.**

The fix (`docs/plans/joystick/47-hide-recovery.md`) is three parts, and a persistent hide is
only allowed to exist because part 2 sits beside it:
1. hiding from the sheet is **session-only** and writes nothing — "Hidden for now. Reload to
   bring it back." is true only because `hubSessionVisibility.js` has no persistence layer, so
   the load-bearing test asserts **no write**, not that the hub vanished;
2. **Settings → Joystick** (pulled forward from Phase 4) is the one control that writes a
   persistent hide — and it must `clearSessionOverride()` before writing, or a member who
   session-hid then switched it ON sees nothing happen;
3. a 12×36px **edge tab** at the hub's resting position restores it, for either kind of hide.
   `HUB_PREVIEW_ENABLED=false` removes the tab too — a way back that outlives the kill switch is
   a live door into a feature that is supposed to be gone.

**Two defects found while building it, both invisible to structural tests, both in the same
place:** the toast was passed `message` where `JournalToast` reads `msg` (rendered blank), and
both toasts were owned by the branch their own action unmounts (rendered for zero frames). The
hub still hid, the tab still worked, every assertion stayed green — **the only broken part was
the half that talks to the member.** `hubHideRestore.test.jsx` therefore has a **copy contract**
section asserting rendered TEXT, not just state transitions.

⚠️ **`POST /api/auth/preferences` is `{key: str, value: str}` and REPLACES the whole value**
(`set_user_preference` writes one TEXT column). Any recovery snippet must be read-modify-write
or it silently wipes `handedness` and `coachMarkSeen`. The snippet previously in
`46-preview-production-check.md` posted `{joystick_hub: {...}}`, called itself "a JSON-patch
merge", and was neither.


### ⛔ Assert user-facing feedback by RENDERED TEXT, never by state (Testing)

> **User-facing feedback is asserted by rendered DOM text after the triggering action settles,
> never by state alone.**

Owner ruling, 2026-09-09, after two toast defects shipped in the joystick hub that left **every
structural assertion green**:

1. The toast was passed `message` where `JournalToast` reads `msg` — the component renders `''`
   for anything else, so the copy was blank.
2. Both toasts were owned by the element their own action unmounts. "Hide joystick" lives in
   the Actions sheet inside `HubShell`; firing it unmounts `HubShell`. Tapping the restore tab
   unmounts the hidden branch. Each message was destroyed in the same commit that set it and
   rendered for **zero frames**.

In both cases the state transition was correct, the control worked, and the only broken part was
the half that talks to the member. A test that asserts `setToastMsg` was called proves nothing
about whether a human ever saw the sentence.

**Structural corollary:** a toast/banner/confirmation host must OUTLIVE the control that fires
it. `HubRoot.jsx::HubToastHost` is the pattern — one element above the visible/hidden branch,
written to by both sides, with one fixed anchor so the message lands in the same place either
way. Do not nest a feedback element inside a subtree that its own trigger tears down.

### ⛔ Registering a hub mode must never re-render the registrant — the 2026-09-10 navigation freeze

> **A `useHubMode` config is memoized by its caller on the values it is built from, and the hook
> reads its registrar from `HubRegistrarContext`, never from `useHub()`.**

The night §3.6 Catalysts went live (`80a520cb3`), clicking any nav entry on `/dashboard` changed
the URL and left the screen where it was; only a hard refresh recovered. Measured: Dashboard
rendered 0/sec, the hub-owning `CatalystTable` ~4,500/sec. A passive-effect loop — React never
throws "Maximum update depth" for one — starved React Router's transition commit, and the member
was held on the exact page that was looping, which is why it read as app-wide.

The chain: `useHubCursor` returned a fresh object every render → `catalystsSection`'s config
memo was keyed on that object → `useHubMode` re-registered → `setPageModeConfig` changed the hub
context value → the tile, a context consumer THROUGH `useHubMode`, re-rendered. A second leg:
while the catalysts fetch was pending, `data?.rows || []` manufactured a new array per render, so
the loop began on the first mount, before the API had answered at all.

⚰️ It was filed as *"only when the catalysts API returns no data."* Measured under the real
`HubProvider`, the owning tile never settled with a healthy payload, a 401, a network error OR a
still-pending request — the API state was a coincidence of when it was noticed. And
`useHubMode`'s own docstring asserted a fresh config per render *"costs one setState … and
correctness never depends on it."* It was the loop.

Four fixes, four rails, each mutation-proved by reverting exactly that fix:
- `useHubCursor` returns a memoized object (`hubRegistrarLoop.test.jsx`);
- `useHubMode` reads a SEPARATE, never-changing registrar context, so registering cannot
  re-render the registrant — a per-render config is now wasteful, not fatal (same file);
- `catalystsSection` keys its config on the cursor's stable parts, and `CatalystTable` derives
  `allRows` from a frozen constant (`CatalystTable.renderLoop.test.jsx` renders the REAL tile under
  the REAL provider across all four API states and asserts the render count stays bounded — the
  section's unit tests stub the cursor and the Dashboard tests mock the tile, so neither could see it);
- `Dashboard.jsx` prunes the hero out of whichever branch the stylesheet hides
  (`useCssDisplayed`, measured from computed style, never a second breakpoint literal), so the
  tile mounts ONCE in a browser and hub ownership follows the visible copy — the old
  "mobile copy owns it" rule handed the hub to a `display:none` tree on every tablet
  (`Dashboard.heroMount.test.jsx`). jsdom applies no CSS, so tests still see both branches.

⭐ ESLint had already named the second leg at HEAD — *"the `allRows` logical expression could make
the dependencies of useMemo change on every render"* — in a file whose pre-existing
`rules-of-hooks` errors made one more red line invisible. A lint finding on a file you touch is a
report, not noise.

### ⛔ A test run without a totals line is not a run (Testing)

> **Assert the totals line before reading the exit code.**

Owner ruling, 2026-09-09. A full-suite run was launched with an invalid `--minWorkers` flag; vitest
died at argument parsing having executed nothing, and the background-task wrapper reported
**exit 0**. Nothing in the status distinguished "17,000 tests passed" from "the runner never
started". It was caught only because the log had no `Test Files` / `Tests` line in it — had that
been trusted, a green gate would have been reported for a suite that never ran
(`lesson_a_task_status_reports_the_wrappers_exit_not_the_suites`).

**Corollary — a CHUNKED run must be diffed against the full test-file list before its total is
quoted.** The same gate was later split by directory to survive host memory pressure, and the chunk
list covered 1,016 of 1,178 files — missing a known baseline row. A partial suite fails in the
flattering direction: fewer files run, fewer failures found. Count the files, not just the passes:

```sh
find src -name "*.test.js*" | wc -l      # and compare against the chunks actually run
```

### ⛔ Run the suite in its OWN tool call, before `git commit` — never in the same one (Testing)

> **The verification and the commit are two separate acts, in that order. Chaining them into one
> shell invocation means the commit lands whatever the tests said.**

Owner ruling, 2026-09-10, from the model's own slip an hour earlier. Adding a `@typedef` to
`hub/contracts.js` broke `hub/phase3Contracts.test.jsx` — the rail that pairs every Phase 3 typedef
with a `validate*` export, on the grounds that *"a @typedef is a comment; it enforces nothing."*
The run and the `git commit` were in a single Bash call, so the failure printed and the red commit
landed in the same breath.

⭐ **The mistake is not "forgot to run the tests" — they DID run.** The output was right there. What
failed is that nothing in the sequence could act on it: `npx vitest run … ; git commit …` commits on
a non-zero exit exactly as happily as on a zero one, and by the time a human or a model reads the
combined output the commit already exists. Two calls, and the second one is only issued after
reading the first.

⚠️ Corollary, same disease: this is why `scripts/gate_shards.py` refuses a dirty tree and records
the tree hash at start AND end rather than trusting that the caller checked. A verification that
cannot block the thing it verifies is decoration.

### ⛔ An empty result is a failed invocation until proven otherwise (Testing)

> **Any rail that shells out — git, a subprocess, the network — carries a NON-VACUITY CONTROL: a
> case proving the command returned something before any assertion over its output means anything.
> Its mutation proof is run BEFORE the rail is called done, not after.**

Owner ruling, 2026-09-10 (rule 14). Same disease as the totals-line rule above, different organ: a
command that returns nothing produces an assertion that passes over an empty set, and an empty set
satisfies almost every check anyone writes.

**Three instances in two days, each caught only by the mutation proof, never by review:**

| Rail | What the command actually returned | Why it read green |
|---|---|---|
| `hub/rule12Paths.test.js` v1 | `git status --porcelain` sliced at a fixed offset, eating the first character of every MODIFIED path — `pp/src/pages/...` | the forbidden-prefix filter matched nothing, so a real violation passed |
| `hub/rule12Paths.test.js` v2 | `git diff -- app/src/...` run from vitest's cwd (`app/`), so the PATHSPEC resolved to `app/app/src/...` | zero added lines compared against zero removed lines: `0 === 0` |
| `scripts/deploy_watch.py` v1 | `subprocess.run(["railway", ...])` cannot resolve a `.cmd`/`.exe` shim on Windows without `shutil.which` | forty consecutive `FileNotFoundError`s, then **exit 0** |

⭐ **The three fixes generalise.** Pin the working directory (`git -C $(git rev-parse
--show-toplevel)`) rather than trusting the caller's cwd — git resolves pathspecs relative to the
cwd and `--porcelain` paths relative to the repo, and the two disagreeing is invisible. Resolve
executables with `shutil.which` and exec the resolved path, never `shell=True`, which fixes the
symptom by handing an interpolated string to a shell. Parse nothing you can avoid parsing: prefer
commands whose output needs no offset arithmetic (`git ls-files --others --exclude-standard` over
slicing status codes).

⚠️ **The control must be able to fail.** `expect(files.length).toBeGreaterThan(0)` is only a control
if a broken invocation would actually make it zero — assert on something the command CANNOT
legitimately return empty (this repo's branch always changes at least its own resume file), and
prefer naming a specific expected member (`expect(files).toContain('HubRoot.jsx')`) over a count.

### ⛔⛔ H14 — A HAZARD CLASS FOUND WHILE THE CODE IS LIVE IS A HARD STOP, NOT A FOOTNOTE

> **The moment you name a hazard class, ask whether code exhibiting it is in production right
> now. If it is: check the live build immediately, and the NEXT deploy is blocked until that
> check is done. It is never a line in a report.**

Owner ruling, 2026-09-11, and it is written from a case where every other rule in this file was
followed and the outcome was still four and a half hours of broken navigation.

**What happened.** On the evening of 2026-09-10 a subagent finishing unrelated chart work hit an
out-of-memory kill in its own test harness, diagnosed it, and reported this sentence:

> "`useHubMode` re-registration is identity-driven, so any host passing an unmemoized callback
> loops."

That is a complete, correct description of a hazard class. It was reported as a curiosity —
"worth knowing" — and relayed to the owner the same way. **At that moment the class was already
live in production**: `catalystsSection` keyed its config memo on the object `useHubCursor`
returned, a fresh literal every render, and had been shipping since the 19:45 ET deploy. Clicking
any nav entry on `/dashboard` changed the URL and left the screen where it was, app-wide. It was
found by a member, and fixed by a different session hours later.

**Why nothing else caught it, and why this rule is about ATTENTION rather than tooling.** The
gate was green (1,261 files, 18,708 tests, 0 NEW). `/api/health` returned 200 throughout. The
first-hour watch recorded five clean samples while the defect was live, because it polled the
server and the server was never unwell. ⭐ **A green suite, a 200 and a rising uptime are all
compatible with a browser that cannot change pages.** The one instrument that would have caught
it did not exist; it does now (`tools/hub_nav_smoke.py`). But the *information* was already in
hand before the tooling gap mattered — somebody had described the exact mechanism in prose.

**What H14 requires, in order:**

1. **Name the class**, not the instance. "This host loops" is an instance; "re-registration is
   identity-driven" is the class.
2. **Enumerate what exhibits it, from source.** A grep for callers, not a memory of which ones
   exist. The freeze's host was not the one the finding came from.
3. **Check the live build now.** Not the branch, not the suite — the deployed thing, at the layer
   the hazard would show up in. A render loop shows in a browser, never in `/api/health`.
4. **Block the next deploy** until 1–3 are done. A deploy that ships while a live hazard class is
   un-checked is a second bet on the same coin.

⛔ **The tell to watch for in your own writing is the word "interesting".** A hazard class
reported as interesting has already been demoted. If it is real enough to write down, it is real
enough to ask whether it is running.

⚠️ This is deliberately stricter than "add a rail". A rail protects the next change; H14 is about
the change that already shipped.

### ⛔⛔ H15 — A FAILING POST-DEPLOY SMOKE IS ROLLED BACK FIRST AND DIAGNOSED SECOND

> **When the post-deploy smoke fails, roll back via the runbook, THEN report. Never diagnose on
> a live failure.**

Owner ruling, 2026-09-11, written into the member-launch charter. It exists because the
2026-09-10 navigation freeze was live for **four and a half hours**, and essentially none of that
was spent fixing it — it was spent not knowing. Once a member is looking at a broken screen, the
time cost of a diagnosis is paid by them, and the rollback is cheaper than the investigation in
every case where both are available.

**The order, and it is not negotiable:**

1. **Roll back.** `HUB_PREVIEW_ENABLED=false` in Railway removes the hub per request with **no
   redeploy** — `docs/plans/joystick/rollback-runbook.md` §1. If the failure is not hub-scoped,
   §3's revert-and-push is the slow path.
2. **Confirm the rollback took**, at the layer the failure appeared in — not by reading the
   variable back. `--kv` shows what the service is CONFIGURED with, which is not evidence the
   running process has it.
3. **Then** report, and only then diagnose. The branch is still there; the member is not.

⛔ **"Let me just check one thing first" is the failure mode this rule names.** A smoke that
fails has already done the checking — it names the route and the shape of the break. Reading its
output is not diagnosing; opening a browser to see how bad it is, is.

⚠️ **INCONCLUSIVE is not FAILED, and must not trigger a rollback.** `tools/hub_nav_smoke.py`
exits **2** when nothing was measurable and **1** when a break was measured, precisely so this
rule cannot fire on an unmeasured deploy. "We could not compute it" and "it is broken" are
different facts; rolling back on the first one teaches everyone to stop running the smoke.

### ⛔ Contracts — verify against the RUNTIME CALL SITE, not a harness

> **A contract is verified against the runtime call site, never against a harness that restates
> it. Arity is not a shape; validators do not catch it, derivation rails do.**

Owner ruling, 2026-09-09, after R-05. `HubRoot.jsx` had called `onScrub(ctx, scrub)` since Phase 2.
The Phase 3 typedef said `onScrub(scrub)` — and the contract test's harness hand-wired the
one-argument form **to match the typedef**. The contract and its test agreed with each other and
neither agreed with the product, so a section built against the documented shape would have read
`ctx.delta === undefined` on a real page with a green suite behind it.

**A runtime validator cannot see this.** `validateSectionConfig` asserts `onScrub` is a *function*,
and a function of the wrong arity is still a function — JavaScript calls it and drops the context
into a parameter named `scrub`. Nothing throws, nothing logs; the gesture silently does the wrong
thing. Two integrators found it independently, from opposite sections, on their first day.

**The rail:** `app/src/hub/contractArity.test.js`. For every callback `contracts.js` documents, it
READS the argument list from the file that actually calls it (`HubRoot.jsx`, `useJoystick.js`),
asserts the typedef declares the same, and asserts the harness invokes it the same way.
Mutation-proved on `onScrub` and `onScrubCommit`. ⭐ It strips comments before matching — its own
first version matched the prose "passed through to the mode's own onScrub(ctx, delta)" a few lines
above the real call site, which is the invented-citation defect committed by a machine.

### ⛔ A citation you cannot quote is struck

> **A plan citation to a document or file must be verified AT WRITE TIME by quoting the cited
> line. A citation that cannot be quoted is struck, not softened.**

Owner ruling, 2026-09-09. The Phase 3 plan carried *"`Screener.jsx` no longer exposes an
`activeTab` — the Wave 0 scout described one"*. The string `activeTab` appears **nowhere** in
`10-wave0-discovery.md`. A binding was attributed to a document that never made the claim, and it
survived weeks of review because a citation looks like evidence: nobody re-opens a source that has
already been named.

This is the same failure as a stale line number, one level up — and worse, because a wrong line
number is discovered the moment someone follows it, while an invented citation sends them to a
real document that simply does not say the thing. Quote the line into the plan, or do not cite it.

### ⛔ Provenance: `git show <sha>:<file>`, never `git status`

> **"Did my change cause this?" is answered by asking the committed version, not by looking at
> what is dirty in the working tree.**

Owner ruling, 2026-09-09. A suite baseline turned up four failing rails caused by the joystick
hub — three of them shipped by PR #100 — and **not one of the four offending files was in that
branch's working set**:

| Rail | Offender | Hub cause |
|---|---|---|
| `styles/tokens.reachable.test.js` | `hub/hub.module.css` | `--color-text-muted` is not a token and never was, so the declaration was a silent no-op |
| `__tests__/sourcesAreText.test.js` | `hub/useHubCursor.js` | a raw `0x01` byte made the file binary to git and ripgrep |
| `research/EarningsResearchModal.themeIsland.test.js` | `styles/tokens.css` | three `--hub-*` glass tokens added with `[data-theme]` variants, never pinned in the island |
| `screener/reachable.test.js` | `hub/contracts.js` | typedef-only module with no runtime importers |

A `git status`-based argument would have cleared all four and filed them to other owners. Run
`git show <sha>:<file>` and look for the construct.

**Corollary — a timeout is never banked as permitted breakage.** A test that fails a full run on
a timeout and passes in isolation is load-sensitive, not broken (`enumerationSites.test.js`:
15 000 ms under the full suite, **1461 ms** alone on the same SHA). Banking one leaves a slot in
the baseline that a real failure can occupy unnoticed. Re-run it alone before classifying it.

### ⛔ A themed token must be pinned in every theme island

> **Adding a custom property with a `[data-theme]` variant is a change to every theme island in
> the app, whether or not you have heard of them.**

A "theme island" re-declares theme-variant tokens at their `:root` values so everything inside it
renders as one consistent surface whatever theme the page wears. PR #100 added
`--hub-glass-tint`, `--hub-glass-tint-strong` and `--hub-rim` to `tokens.css` with theme variants
and did not pin them in `EarningsResearchModal.module.css`'s island — so descendants of that
modal resolved the hub's glass against the page theme instead of the dark chrome the modal is
drawn on. The feature that added the tokens and the surface that broke were in different
directories and neither had reason to look at the other.

**Rail:** `app/src/styles/themeIslands.test.js`. Islands declare themselves with
`--theme-island: <name>;`; the required set is derived from `tokens.css` every run; a missing
token fails by name. Mutation-proved both directions. Self-declaring rather than
threshold-guessed on purpose — `floor2/standalone.css` (substitutes for `tokens.css` on a page
that never loads it) and `ChartsWorkspace.module.css` (pins under `[data-theme='light']`) both
look like islands to a naive scan and are not (`lesson_a_guard_that_tests_the_adjacent_thing`).

### Rebasing a feature branch — when, and when not

> **Rebase only when master has touched a file the branch touches, or the branch is more than
> five commits behind. Otherwise merge clean.**

Owner ruling, 2026-09-09. Rebasing rewrites already-published commits and forces a
`--force-with-lease` push; when master's changes cannot interact with the branch's, that buys
nothing and risks clobbering a concurrent session's work on the same branch (see
`feedback_agent_authority_and_worktree_isolation`). Measure it, don't guess:

```sh
BASE=$(git merge-base origin/master HEAD)
git rev-list --count $BASE..origin/master                       # behind
comm -12 <(git diff --name-only $BASE..origin/master | sort -u)          <(git diff --name-only $BASE..HEAD          | sort -u) # overlap
```

Empty overlap and fewer than six behind ⇒ push and open the PR as-is.

### Deploy windows — the FILES decide, not the clock

**`docs/runbooks/deploy-windows.md` is the single authority. This section states no
rule of its own.**

In short: which services restart depends on which files a push touches, and only one
restart is expensive.

- **Docs, tests, tools, scripts, `app/**` → push any time.** These restart web only.
  Cost is a ~1 min `/api/*` blip and a possible lost scheduler slot (APScheduler's job
  store is in memory, so a slot whose minute passes during the swap is lost outright,
  not run late). If a scheduled job is due in the next minute or two, wait for it.
- **Anything on flow-worker's watch list → after-hours or weekend only.** A flow-worker
  restart drops the Massive OPRA socket, and Massive does not replay: the gap is
  permanent until the T+1 flat file. Physics, not policy.

`python tools/flow_worker_watch_coverage.py` prints what this branch touches and what
flow-worker reaches. `railway deployment list --service flow-worker --json` reports
**`SKIPPED`** for a push that missed the list — it was SKIPPED on **14 of 14** pushes to
2026-09-11.

⚰️ **Two rules this replaces, and the history is kept deliberately.**
**"No master push Mon–Fri 09:00–16:00 ET, docs-only included"** was justified by *"every
master push redeploys web, worker, bars-api and flow-worker in lockstep"* — measurement
disproves it: over 14 pushes flow-worker deployed **zero** times, worker and bars-api
only on the two `api/**` commits, and only **web** deploys on every push.
**"Ignore the no push window, we can push anytime anyday forever"** dropped the
flow-worker case entirely, and that case is real.

⛔ **Neither should be restored, and neither should be re-derived from its surviving
rationale.** This file has had a rescinded restriction reinstated that way twice: the
mechanism under a struck rule explains a class of bug, it is not the rule.

⚰️ **How the wrong version of this was nearly written into a rule:** a Wave Q1
session read a deployment list by SHA and never read the `status` column, which
said `SKIPPED` — concluding *"every master push restarts web, worker, bars-api
and flow-worker in lockstep"* and nearly widening the RTH freeze to docs on that
basis. Counting presence is not reading a verdict.

### 📓 Notebook Wave Q1 — LIVE (not dark) since 2026-09-12 00:45 ET

`OFFLINE_DEFAULT_ON = true` on `master` as of `739218e48`. The durable IndexedDB
working copy, the outbox, Web Locks leader election and conflict-fork-never-clobber
are the DEFAULT path for every member, not an opt-in.

⭐ **The closing entry is the authority** — `docs/notebook/wave-q1-RESUME-HERE.md`,
first section. It carries the verification, the canary table, the Sunday
18:00 ET keep-or-revert gate, and the per-browser opt-out.

⛔ **Rollback is pre-authored and pushed**: `rollback/notebook-offline-default-off`
at `3db89e205`, gated and gauntleted green with the flag false. It is a DEPLOY,
not a variable — see *"Rolling back a FRONTEND flag"* below.

⛔ **Unattended observation**: `tools/nb_observe.py`, Task Scheduler job
`UCT-WaveQ1-Observe`, every 2 hours into `docs/notebook/wave-q1-observation-log.md`.

### ⛔ B7 / rule 12 owes a branch-identity check — OPEN, owned by the joystick session

`app/src/hub/rule12Paths.test.js` (`327fa4c70`) asserts *"this branch must not
edit the Notebook workstream's files"* and enforces it by diffing
`merge-base(origin/master, HEAD)..HEAD` for anything under
`app/src/pages/journal-2-0/`.

⛔ **It has no branch identity check, so it fires on EVERY branch that edits
those paths — including the Notebook workstream editing its own code.** It
cannot distinguish the case it was written for from that case's exact opposite
(`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`). It is on `master`
today, which means the Notebook cannot hold a green suite while doing its own
work.

**Waived once, by the owner, 2026-09-11**, for the Wave Q1 flip gate — excluded
by name with the reason printed in the gate manifest, never modified. ⭐ **The
fix belongs to the joystick session**: gate the rail on being ON a joystick
branch (or on the diff containing hub changes), so it only fires where rule 12
applies. Until then every Notebook gate carries a waiver it should not need.

### ⛔ Rolling back a FRONTEND flag is a deploy, not a variable

Constants like `OFFLINE_DEFAULT_ON`
(`app/src/pages/journal-2-0/lib/offline/offlineFlag.js`) are **compiled into the
bundle**. There is no Railway variable behind them, and setting one named after
the constant changes nothing while looking like it worked. Rollback = revert the
commit, push to `master`, wait for the `web` rebuild (**~2–3 min**; one
measurement, 138 s), and **every member with an open tab keeps the OLD bundle
until they reload** — there is no service worker and no new-version prompt, by
charter. ⚰️ For most of Wave Q1 the canary stamped the opposite instruction on
every evidence row; it was corrected 2026-09-12.

### ⛔ `railway variables --set` — measured BOTH ways. Verify the BOOT, not the CLI.

> **Whether `--set` restarts the service is not settled, and this file asserted
> three different answers in three places. The rule that survives either
> behaviour: after setting a variable, verify a NEW BOOT by startup-line
> timestamp. Never assume which behaviour you got.**

Two measurements, both real, both kept:

| Date | Service | What happened |
|---|---|---|
| 2026-08-30 | `chart-renderer` | `--set` **STAGED only**. `--kv` read the new value back immediately while `/proc/1/environ` still held the old one; only an explicit `railway redeploy` applied it. |
| 2026-09-09 | `web` | `--set` **auto-redeployed**. An explicit `railway redeploy` issued 16s later was REFUSED — *"cannot be redeployed... currently building"*. The new value was live in the running process after the boot. |

It may be per-service, or the CLI changed between those dates. **Do not
re-litigate it from either data point alone** — that is how this file ended up
with three contradictory sentences (the lines that now point here).

**The procedure, either way:**
1. `railway variables --service <svc> --set "K=V"`
2. Watch for a **new boot** — a startup line stamped AFTER the `--set`.
3. **Only if no boot appears within ~3 minutes**, `railway redeploy --service <svc> --yes`.
4. Confirm the RUNNING process, not the service config: `--kv` shows what the
   service is configured with, which is **not evidence the process has it**.
   Read it in-process (`os.environ.get(...)` over `railway ssh`) or from
   `/proc/1/environ`.

5. ⛔⛔ **UPDATE `docs/feature_flags.json` IN THE SAME DOCS PUSH THAT RECORDS
   THE FLIP TIME.** A flip is not finished when the process has the value; it
   is finished when the ledger says so. Set `status` to `armed`, put the
   SERVICE in `where`, and put the FLIP TIMESTAMP in the note.

⚰️ **This rule exists because the ledger described an unreleased surface while
members were using it.** `RESEARCH_TECHNICAL_TAB_ENABLED` was flipped ON by
owner ruling at **2026-09-09 23:22:30 ET** and verified in the running process.
Its ledger entry kept the MERGE-TIME `dark` state for a full day. Two
independent readers then disagreed about whether the Research > Technical tab
was live, and a session reading the LEDGER reported the live flag as a
"discovery" — in a file that recorded the flip, with its timestamp, 488 lines
higher up.

⭐ **The ledger records INTENT and cannot see Railway; the checkpoint records
WHAT HAPPENED. When they disagree about a live flag, the checkpoint wins and
the ledger is the thing that drifted.** Do not infer a flag's state from the
ledger — it is the artifact most likely to be stale, because nothing fails
when it is.

⚠️ **And the half that would have caught it was unrunnable.**
`tools/flag_ledger_audit.py` is the only thing that compares the ledger to
Railway. On Windows `subprocess.run(..., text=True)` decodes the pipe with the
locale codec (cp1252); the Railway CLI emits UTF-8, so the first box-drawing
byte killed a reader thread and the tool reported **"could not enumerate the
project's services"** — which reads as an auth or project problem, not as an
encoding bug. That is why it went unfixed rather than unnoticed. Fixed
2026-09-10 (`encoding="utf-8", errors="replace"`); run it after any flip.

⚠️ **A flip is therefore a RESTART either way**, so it is bound by the push
window above.

⭐ **One probe during a swap is not a verdict.** Right after a redeploy the old
pod can still answer; re-probe. Cf.
`lesson_a_railway_var_set_stages_it_does_not_restart` (the 2026-08-30
measurement, still accurate for what it measured) and
`lesson_two_points_do_not_establish_a_rate`.

### Tooling — GitHub MCP reads `GITHUB_PERSONAL_ACCESS_TOKEN`

The `github` MCP server (plugin `claude-plugins-official`) is configured as:

```json
"github": { "type": "http", "url": "https://api.githubcopilot.com/mcp/",
            "headers": { "Authorization": "Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}" } }
```

⛔ **It reads `GITHUB_PERSONAL_ACCESS_TOKEN` (user scope). `GITHUB_TOKEN` is NOT read** —
setting that one does nothing, and the unexpanded `${...}` is what produces the connection
error *"Authorization header is badly formatted"*, which reads like a malformed value rather
than a missing variable. **A restart is required after setting it.**

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
- `GET  /api/breadth-monitor/live/drill/{metric_key}` — the names behind one cell
  of the INTRADAY row (shipped 2026-08-07 `5bf07061`)

### Live-row drill-down (2026-08-07) — LOCKED invariants

The intraday row's cells drill like a recorded day. `compute_metrics` already
built every count as a boolean mask over the aligned ticker array, so the list
is emitted **from that same mask** via an optional `members` out-dict.

- ⛔ **A drill list MUST come from the mask that produced the count** — never a
  second pass. Two passes drift the moment a definition moves and the failure is
  SILENT: the cell says 47, the modal lists 45, nothing reports it.
  `test_every_drillable_metric_reports_members_matching_its_count` is the gate.
- ⛔ **Lists are cached BESIDE the payload, never IN it** (`_live_cache["members"]`).
  `/api/breadth-monitor/live` is polled every 60s by every Dashboard user on a
  single-process pod. `test_the_live_payload_never_carries_drill_lists` asserts
  the key set so nobody can quietly inline them and re-bloat the poll.
- ⛔ **`drillKey` is NOT the metric key.** The monitor's columns send
  `col.drillKey` — usually metric+`_list`, but `universe_list` / `stage2_list` /
  `stage4_list` map to `universe_count` / `stage2_count` / `stage4_count`.
  `_metric_key_of` + `_DRILL_KEY_ALIASES` resolve both forms; naive suffix
  stripping opens an EMPTY modal beside a cell showing a number. The coverage
  test READS every drillKey off `Breadth.jsx` rather than listing them.
- ⛔ **Route order:** `/live/drill/{metric_key}` must be declared BEFORE
  `/{date_str}/drill/{metric_key}` — that route matches `"live"` as a date, and
  registered the other way round every live click 404s.
- **TWO surfaces share one decision:** the monitor table (`Breadth.jsx`) and the
  eight `BreadthViews` tiles both route through
  `app/src/pages/breadth/liveDrill.js::drillTarget`. Don't reimplement it in one.
- **A CARRIED metric drills the session it came FROM.** `atr_ext_7` needs
  intraday high/low, so the live row shows the prior day's number; opening
  today's list would caption a past session's names as today's. No
  `carried_from` → the cell stays inert.
- `atr`/`a50` are **absent by construction** on live items (need intraday
  high/low the snapshot doesn't carry). The modal already renders a missing one
  as an em dash — do NOT fabricate them.
- The live row is **hidden whenever `superseded`** — once the 4:15 collector
  writes the day, `useLiveBreadth` returns nothing by design. "No live row after
  4:15" is not a regression.

---

## Phase E — the scan surfaces that now exist (branch `feat/phase-c-alerts`, 2026-08-09)

⚠️ **IN FLIGHT.** Phase E is being built by multiple parallel agents on this branch
right now, so this section names **doors that were verified reachable on 2026-08-09**
and deliberately restates no counts. Re-derive anything you are about to depend on.

### The nightly scan sweep — ON in production, OFF in code

`scan_evaluator.sweep_job()` is registered in `api/main.py` under
`CronTrigger(hour=scan_evaluator.SWEEP_HOUR_ET, minute=scan_evaluator.SWEEP_MINUTE_ET,
timezone=_ET)` — **05:00 ET**, `max_instances=1`. Read the two constants from
`api/services/screener/scan_evaluator.py`; don't retype the time.

- 🔑 **`SCAN_SWEEP_ENABLED=1` on Railway `web`** (read live, 2026-08-09) while
  `scan_evaluator.enabled()` **defaults to `"0"`**. Same divergence on
  **`RATINGS_PERCENTILE_ENABLED=1`**. ⛔ **A local run therefore behaves differently
  from production on both** — if you are reproducing a prod behaviour, set them.
- **One hour is enough because the ceiling is a property of the tree, not the
  schedule** — all declared scalars are `cadence: nightly` out of `screener_rows`, so
  a scan re-read at noon returns the same answer off the same 03:00 snapshot.
  `scan_evaluator.cadence_ceiling` derives that per definition from the manifest.
- ⚰️ **The flag's own docstring and the comment above its `add_job` both still say
  "E-4 has not wired a surface to these results."** That is false — the surface is
  below. Those two comments are in `api/**`, which this doc's owner cannot edit; the
  correction lives here. **Two copies of one false sentence read as corroboration** —
  that is why it survived (`lesson_gate_that_cannot_fail`'s cousin: a claim nobody
  can falsify because it is stated twice and checked nowhere).

### The door a member actually walks through

`/screener` → `pages/Screener.jsx` → `components/screener/SavedScreensPanel.jsx` →
`ScanResults.jsx` → `CoverageLine.jsx`, reading **`GET /api/scans/definition-results`**
(`api/routers/scan_results.py`, mounted in `main.py`).

⭐ **`CoverageLine` is the idiom worth copying anywhere a result set can be short:**
FOUR counts — *evaluated · answered · dropped · not computable* — because *"we could
not compute it"* and *"something broke"* are different facts to a trader. ⛔ **Do not
collapse them to make the line shorter**: a screen that silently loses symbols returns
fewer hits and **looks like a quiet market**. And when `answered === 0` with anything
not-computable, it says *"that is a gap in what we hold, not a quiet market"* **in
those words, above the counts** — measured on the real universe, the naive formula
returns `answered=0, not_computable=2615` because `rs_rank` is NULL in every screener
row on this box, and rendering that as "0 matches" is a lie a member would act on.
`withheld` sits BESIDE the four, never inside them. The component also **refuses to
present a receipt whose arithmetic does not close**, mirroring
`scan_evaluator._assert_coverage_closes`, which refuses to write one.

**Two rails, and they fail for different reasons — keep both:**
- `app/src/components/screener/reachable.test.js` — walks the **real import graph from
  `App.jsx` with an AST**, following `lazy(() => import(…))` as well as static imports,
  and asserts every component in `components/screener/**` is reachable. ⛔ **An AST,
  never a grep** (`lesson_probe_names_must_be_derived_not_typed` — a grep here once
  "found 5 call sites, all five of them prose"). It carries a **control** proving the
  dynamic edge is load-bearing, so it cannot pass for the wrong reason. Its assertion
  is scoped to that one directory on purpose while other agents add files elsewhere;
  widening it is a one-line change.
- `app/src/pages/Screener.scanmount.test.jsx` — mocks **nothing on the path under
  test**, so it goes RED when the *wire* is cut while every component stays correct.
  ⭐ **That is the shape the 2026-08-08 audit said was missing** (8 features built,
  tested, green, and connected to nothing): component tests are structurally blind to
  a severed wire.

### Other Phase E surfaces on this branch

- **Builder criteria picker** — `components/chart/builder/BuilderSheet.jsx`: a VIEW
  over the definition tree, with the round trip as the gate.
- **Concierge (English → a SCAN)** — `components/chart/builder/ConciergeBox.jsx`,
  rendered from `BuilderSheet.jsx`. ⚠️ A prior audit listed it as unmounted; **that is
  FIXED** — don't re-report it.
- **Starter library** — `api/services/starter_library.py` +
  `components/chart/builder/StarterLibrary.jsx` + `engine/ast/starterScans.json`: the
  firm's setups ship as **ordinary definitions, editable on arrival** (not a special
  read-only class).
- **User definitions** — `api/routers/user_definitions.py` (`GET`/`POST`/`POST
  /propose`/`GET|PUT|DELETE /{def_id}`).
- **Entitlements / toolkits** — `api/services/entitlements.py`. ⛔ **One toolkit ships
  today (`"all"`) and the lookup is still real**: returning the default unconditionally
  would be indistinguishable from a lookup that had been deleted. Read `TOOLKITS`,
  `toolkit_for`, `limits_for` — do not assume "there is only one, so it doesn't matter."

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

### MarketBreadth (`app/src/components/tiles/MarketBreadth.jsx`) — REWRITTEN; read the file
Titled **"UCT Exposure Rating"**. At 2026-08-09 (117 lines) it renders: `ExposureBar`
(0-150 score + delta + ★ on bonus/leveraged) · phase row · the exposure note ·
`gate_reason` warning when gated · a **live "ABOVE 50-DAY NOW"** row from
`useLiveBreadth` with a `DayPath` sparkline and an ET stamp · then `MARelationship`.
- 🔑 **Why only `pct_above_50sma` goes live:** the exposure rating is pushed by the
  morning wire and is **not derivable intraday**, so nothing above it can be live.
  Participation is, and % above the 50-day reconciles to within a point — the
  tightest grade the gate measures. Don't "make the rest live"; it has no intraday basis.
- ⚰️ **Everything this section used to say is gone from the file:** no SVG gauge
  (R=72), no 3 MA progress bars, no **% Above 5MA / 50MA / 200MA** trio, no stat row
  (*Dist. Days · Adv · Dec · NH · NL*), and **no clickable NH/NL buttons** — which is
  the origin of the `NHNLModal` claim below. The strings `highs`, `lows`, `Adv`,
  `Dec` and `Dist` appear nowhere in the component.

### NHNLModal (`app/src/components/tiles/NHNLModal.jsx`) — ⚰️ ORPHANED, opens from nothing
⚠️ **Zero importers.** `MarketBreadth.jsx` does not reference it, so nothing below
happens for a member. Kept as a record of what was built. See *⚰️ DOCUMENTED BUT
UNREACHABLE* near the top.
- ⚰️ Was documented as: opens on click of NH or NL count in MarketBreadth tile
- Shows full list of S&P 500 stocks at 52W highs or lows as TickerPopup chips
- Escape key closes; backdrop click closes
- Data: `new_highs_list` / `new_lows_list` arrays from `/api/breadth`

### LeadershipTile (`app/src/components/tiles/LeadershipTile.jsx`)
- Replaced EpisodicPivots on Dashboard
- Fetches `/api/leadership`, scrollable compact list: rank · TickerPopup · cap badge · RS score · thesis

### EarningsModal (`app/src/components/tiles/EarningsModal.jsx`) — ⚰️ SUPERSEDED, opens from nothing
⚠️ **Zero importers** (2026-08-09). The live per-ticker earnings detail is
`components/research/EarningsResearchModal.jsx` (routed via
`pages/calendar/useEarningsModalRoute.js`), which states in-file that it *replaces*
this modal's idiom. **Read `EarningsResearchModal.jsx` for the current behaviour, not
the list below** — this is retained as a record of what the old modal did, and it is
the sole importer of the also-orphaned `calendar/FundamentalsStrip.jsx`. See
*⚰️ DOCUMENTED BUT UNREACHABLE* near the top.
- ⚰️ Was documented as: opens on ticker click in CatalystFlow or Calendar
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
- **Per-ticker depth (`components/research/EarningsResearchModal.jsx` — ⚰️ this said "EarningsModal", which is orphaned, as is the `FundamentalsStrip` that rendered the fwd-PE):** fundamentals/fwd-PE (`/api/fundamentals`), SEC filings (`/api/filings`, free EDGAR), AI call recap + sentiment + guidance + rating changes (`call_recap.py`, Opus+Perplexity, cost-guarded), **free verbatim transcripts** (`av_transcripts.py` via AlphaVantage `EARNINGS_CALL_TRANSCRIPT`, lazy/25-day-budgeted) + keyword search + 🔊 TTS Listen.
- **Pluggable live/recorded audio** (`earnings_audio.py`): env `EARNINGS_AUDIO_PROVIDER`(`none`|`earningsapi`|`earningscall`|`quartr`) + `EARNINGS_AUDIO_API_KEY`. EarningsAPI adapter concrete (URL assumed-verify); **Quartr/EarningsCall = stubs** (Quartr needs real wiring + hls.js when contracted).
- **IPO + dividends/splits** event calendars (`ipo_calendar.py` Finnhub, `dividends_calendar.py` yfinance) as event-type chips/cards. **My Stocks hub** at `/calendar/mystocks` (Earnings/News/Calls/Filings/Insights + read-unseen via `calendar_seen.py`).
- **Alerts:** pre-report (`calendar_alerts.py`, APScheduler 7am=today / 6pm=tomorrow ET, dedup table) — gated `CALENDAR_ALERTS_ENABLED=1`. **iCal/webcal export** `/api/calendar/export.ics` + `/export-token` (HMAC(PUSH_SECRET,user_id)).
- Routers: `calendar.py` (refresh is admin-gated), `earnings_intel.py` (recap/sentiment/transcript/audio — auth-required), `fundamentals.py`, `filings.py`, `ticker_logos.py`. **`EarningsResearchModal` is the click-through detail** — ⚰️ this said "EarningsModal still the click-through detail"; that component has zero importers (see the unreachable table).
- **Past days of the CURRENT week come from Finnhub, not EW/Finviz** (`_backfill_past_days`, 2026-07-30). EarningsWhispers + Finviz are forward-looking SCHEDULES: once a company reports, EW drops it from that date and Finviz's `Earnings` column rolls to next quarter, so `_build_live` progressively emptied Monday, then Tuesday, while the week was still open (EW served 2 names for Mon 7/27 vs Finnhub's 119). The `live_total == 0` wire fallback never caught it — today/tomorrow are always full. Runs AFTER that fallback decision so it can't mask an empty live build; today + future days stay EW/Finviz's. A symbol the schedule still carries keeps its entry (EW owns the BMO/AMC session + the `ew` rank that drives ordering) and only its blank actuals are filled.
- **A FINISHED day is capped looser than a live one** — `_PAST_SESSION_CAP=150` vs `_build_live`'s 40. The 40 bounds a forward SCHEDULE where EW's anticipation rank decides who matters; truncating a day that already happened just hides reporters (a 40-cap showed 96 of Wed 7/29's 240). `_PAST_REACTIONS_MAX_SYMS=250` matches so the whole day gets a gap %. Finnhub carries `hour` for ~90% of past rows; the ~10% with an empty `hour` land in **Time TBD** — a genuine provider gap, not a bucketing bug.
- **`_compute_enrichment_for_date`: `is_past` beats `in_current_week` for the TTL.** The 5-min TTL exists for the live expected-move (options) field, which `_one` skips for past dates. A past day in this week now holds ~100 symbols instead of ~1, so the live TTL would re-fire ~200 provider calls per past day per 5 min.
- LOCKED invariants: enrichment endpoint must `return out` (cold-cache bug 2026-06-02); LLM features cost-guarded+cached; AV transcripts lazy-only (25/day free tier); never fetch per-card fundamentals (60-req storm — batch via enrichment if needed).

### API: Breadth (`api/services/engine.py` → `_normalize_breadth()`)
- Fields: `pct_above_5ma`, `pct_above_50ma`, `pct_above_200ma`, `advancing`, `declining`, `new_highs`, `new_lows`, `new_highs_list`, `new_lows_list`, `breadth_score`, `distribution_days`, `market_phase`

### FuturesStrip (`app/src/components/tiles/FuturesStrip.jsx`)
- Each index tile has a background sparkline SVG: linearGradient stroke, feGaussianBlur glow, fog fill polygon, last-point circle marker
- Static SPARK point arrays per symbol (pos/neg/neu variants)
- **Layout**: left 50% = index grid (QQQ/SPY/IWM/DIA/BTC/VIX), right 50% = Quote of the Day panel
- **Quote of the Day**: `app/src/constants/quotes.json` is the ONE library — 674 cited `{t, a, src, tags}` (web-verified 2026-08-22: 42 upgraded to primary sources, 33 re-credited, 12 fabrications dropped; 76 remain `Attributed`). **The SERVER picks**: `GET /api/quote-of-the-day` (`api/services/quote_of_the_day.py`, public) is ANCHORED TO THE LATEST WIRE — that wire's date + its own `game_plan.exposure_tier` word (Aggressive/Constructive/Neutral/Caution/Defensive — never a restated threshold) and walks the regime's tag pool as a full cycle (`quoteRotation.js` ⇄ `pick_index`, parity-tested through Node). `hooks/useQuoteOfTheDay` feeds FuturesStrip + the Wire banner (the client rotation in `quotes.js` is the offline fallback only); the engine fetches the same pick for the Substack epigraph (`substack/quote.py`). `components/quote/SaveQuoteButton` posts the quote into a Journal 2.0 note (`tags: ["quote"]`). The quote changes once per trading day, when the wire lands (never at midnight). `MarketStatusBar.jsx` (built, never mounted) was deleted 2026-08-22; its `sessionModel`/`nextOpenHint` helpers live in `dashboard/sessionModel.js`.
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
- `api/routers/cot.py` — 5 routes: GET /symbols, GET /status, POST /refresh, POST /reseed, GET /{symbol} (said "4 routes" beside a list of five until 2026-08-07 — the list was right, the count was not; same shape as the writer-index and taxonomy drifts above)
- `app/src/pages/CotData.jsx` — FIVE stacked Chart.js panes (proxy price · Commercials · Large Specs · Small Specs · Open Interest), symbol dropdown, lookback buttons (rendered inside Breadth.jsx). ONE fetch per symbol (`weeks=520`); the lookback is a client-side slice.
- `app/src/pages/CotData.module.css` — page styles (incl. the shared HTML hover tooltip `.tip`)
- `app/src/pages/cot/` — the **Positioning rail** and its analytics (see the subsection below)

### Positioning rail + the read (shipped 2026-08-21, v1 + v2 the same night)
The right-hand rail tracks the chart's hover and reads ONE report week: verdict
tiles (Contrarian bias · Crowding), a table (Net / WoW / % of OI / 3-year COT
Index with a meter) for all four series, signal chips, the written weekly read,
a price check, precedents, and "What to watch". Design + pitfalls: user memory
`project_cot_positioning_rail_2026_08_21`.

- **Analytics are pure JS and the SINGLE authority** — `app/src/pages/cot/`:
  `cotRead.js` (3Y + 26-wk COT Index, zones 90/75/25/10, commercial-led bias,
  crowding, Movement Index, streaks, `assetClassOf` + class framing, templated
  copy), `cotAnalogs.js` (episodes of the same positioning setup → forward returns
  4/8/13 wks via an ETF proxy; **no lookahead past the week shown**),
  `cotDivergence.js` (5 price-vs-positioning tells), `cotProxies.js` (`PRICE_PROXY`
  → ETF per market; null where no liquid proxy exists), `cotFacts.js` (the ONLY
  numbers the LLM may cite), `cotCompose.js` (`composeWeek` — the one composition
  used by BOTH the rail and the Node CLI), `cotTooltip.js`, `cotFormat.js`,
  `cotPalette.js`. ⛔ Do not port any of this to Python — the backend reaches the
  same code through the Node bundle below.
- **Hover → rail** goes through an imperative handle (`railRef.current.setIndex`),
  never props/state in `CotData.jsx`: a mousemove must not re-render the Chart.js
  instances. The tooltip is ONE HTML element in `panesWrap` (`tooltipPlugin(key)`
  → `enabled:false, external`) because a canvas tooltip is clipped by its pane.
- **Written weekly read** — `POST /api/cot/{symbol}/narrative` (`require_paid`;
  body `{report_date, name, facts}`) → `api/services/cot_narrative.py`: the facts
  become ~150 words of prose (Opus), cached per (symbol, report week, facts hash)
  in `cot.db` table `cot_narratives`, behind a **grounding gate** (every number in
  the prose must appear in the facts; 100–230 words; no markdown/emoji/tags; one
  retry, then `status:"error"` and NOTHING stored — the rail falls back to its
  templated read). Env: `COT_NARRATIVE_ENABLED` (default 1), `COT_NARRATIVE_MODEL`
  (default `claude-opus-5`), `COT_NARRATIVE_DAILY_CAP` (300/UTC day). ⛔ No
  `temperature=` kwarg (the pinned SDK raises; Claude 5 rejects sampling params).
- **Friday pre-warm + archive** — `api/services/cot_prewarm.py` generates the read
  for every market after the CFTC refresh (APScheduler `cot_narrative_prewarm`
  Fri 17:05 ET + `cot_narrative_prewarm_retry` Sat 09:00 ET; env
  `COT_PREWARM_ENABLED`, default 1). It shells out to the **Node facts bundle**
  `app/dist/cot-facts.cjs` (built by `npm run build` via
  `app/scripts/build-cot-facts.mjs` from `cotFactsEntry.js`; CLI: `proxies` /
  `facts <stdin JSON>`), so Python never re-implements the analytics. Manual
  trigger `POST /api/cot/narratives/prewarm` and `GET
  /api/cot/narratives/recent` are PUSH_SECRET-bearer gated; `GET
  /api/cot/{symbol}/narratives` (paid) is the archive the rail shows when you
  scrub to a past week. Optional weekly Discord post of the "Most watched" reads:
  `COT_WEEKLY_DISCORD_WEBHOOK_URL` — **blank posts nothing** (paid content).

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
- `themes_taxonomy.json` — source of truth. **Measure it, don't quote it** (`json.load(...)` → `version`, `len(themes)`, `len(sectors)`, `sum(len(t["holdings"]))`). At 2026-08-07 it reads **v4.22.0, 112 themes, 2029 holdings, 12 sectors**. ⚰️ This line said *111 themes, 2049 holdings, v4.16.0* — three of the four numbers had moved across six minor versions while calling itself "source of truth", which is precisely what discourages re-measuring. It matters for anyone reasoning about coverage before a version-gated reseed, or sizing what the Theme Membership Engine's orphan absorption works against.
- `morning-wire/morning_wire_engine.py` — reads taxonomy, fetches holdings, pushes to Railway

### Architecture
- **Hybrid taxonomy**: JSON seed file → SQLite DB on startup → API enrichment with sector/tier/sub_themes
- **12 sectors**: Technology, Innovation, Clean Energy, Traditional Energy, Materials, Defense & Industrials, Financials, Healthcare, Consumer, Real Estate & Utilities, Crypto, Global. (Theme count deliberately not restated — see the taxonomy line above; it was `111` here too and drifted in lockstep.)
- **Holdings cap**: 50 per theme (was 15), filtered by $300M market cap
- **Non-blocking compute**: memory cache → disk → `{status: "computing"}`
- **Workers**: `_MAX_WORKERS = 6` in `api/services/theme_performance.py` (its own comment calls 6 "conservative — keeps Railway memory safe"), consumed by one `ThreadPoolExecutor`. ⚰️ Documented as `2` here until 2026-08-07 — a 3× under-count of theme-compute threads, in the same file whose launch-hardening section budgets the single web pod's ONE shared anyio threadpool. Anyone sizing headroom was four threads short.

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
- **Catalog (user-provided 2026-06-10, extended since).** ⭐ **Measure it, don't quote
  it** — there are TWO setup lists and they do not agree, so any number written here
  goes stale in whichever one moves first. Count both and diff them:
  `SETUP_FAMILIES` + the `name:` entries in `app/src/pages/modelbook/setupCatalog.js`,
  vs `SETUP_GROUPS`/`SETUPS` in `app/src/constants/setupGroups.js`. Measured
  2026-08-09: **`setupGroups.js` = 32** (26 Swing + 6 Intraday) · **`setupCatalog.js`
  = 26 across 5 families** (Bases & Breakouts · Gaps & Catalysts · Momentum & Trend ·
  Reversals & Reclaims · **Intraday**) · **only 15 names appear in both**, so 11
  catalog entries and 17 taxonomy entries have no counterpart.
  ⚰️ This said *"24 swing setups grouped into 4 families"*. **The same wrong count is
  also in `setupCatalog.js`'s own file header** — it still reads "24 swing setups"
  when the file holds 26 and one of its families is Intraday, so "swing" is wrong too.
  A count that has drifted in the artifact AND in the file it describes is the
  writer-index `FOUR`-beside-six and the COT router's "4 routes" above five all over
  again: **a hand-typed count beside the list it claims to describe.** Treat the
  15-name overlap as the load-bearing number — it is what "normalize when wiring
  examples to the DB" actually costs.
  A few catalog names use fuller display forms (e.g. 'U&R (Undercut & Rally)' vs the
  taxonomy's 'Classic U&R') — normalize when wiring examples to the DB. Each entry:
  family, direction, one-line `essence`, hand-authored `candles` array rendered by
  `<SetupGlyph/>` as an idealized mini candlestick sketch (pure SVG; optional `pivot`
  dashed trigger line + optional `ema` period drawing a smoothed MA curve).
- **Library screen:** hero + family pills (All + one per `SETUP_FAMILIES` entry — ⚰️ this said "4 families"; count the array) + search + grouped
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

## Discord `/buzz` — ticker-mention board (LIVE in #main-chat, 2026-09-02)

Counts ticker mentions in `#main-chat` and reports which names the room is
actually talking about — on demand via `/buzz`, and on a schedule as a rendered
board image. **Live: seven posts a session, mon-fri**, into a ~750-member room.

- **Source:** `api/services/buzz_{store,extract,universe,boards,image,reply,ingest}.py`
  + `api/services/discord_buzz_digest.py`; board page
  `app/src/pages/BuzzRender.{jsx,module.css}` served headless at `/r/buzz`;
  payload `GET /api/r/buzz` in `api/routers/render_panels.py`.
- **Store:** `/data/buzz.db`, one row per (message × ticker). **It stores NO
  message text** — `message_id` + `channel_id` reconstruct a jump link, which
  stays true when a member edits or deletes; a stored copy would not. The
  composite PK makes re-ingesting an overlapping window a no-op.
- **Schedule:** `DEFAULT_TIMES` in `discord_buzz_digest.py` — 10:00, 10:30,
  11:30, 12:30, 14:00, 16:15, 17:30 ET. ⛔ **Read it there.** `BUZZ_DIGEST_TIMES`
  is deliberately UNSET in production so the schedule has ONE authority.
  One `add_job` per slot: a CronTrigger with a list of times fires the cross
  product, which is seven jobs' worth of posts per slot.
- **Env (web):** `BUZZ_DIGEST_ENABLED=1` · `BUZZ_DIGEST_CHANNEL` (bot token, not
  a webhook) · `BUZZ_CHANNELS`. Rollback is the flag alone. The **ingest poller
  and `/buzz` are NOT gated on it** — turning posting off never stops counting.

### LOCKED invariants — each of these was a shipped defect

- ⛔⛔ **THE BAR DRAWS THE QUANTITY THE ROWS ARE SORTED BY.** Ranking is
  MENTIONS-led with people as the tiebreak (owner, 2026-09-02). When the bar
  came from a different number than the sort, the board stepped UP three times
  in fourteen rows and the owner correctly read it as "the ranking is broken".
  Mirrored in the image AND the text reply — `lesson_rail_the_mirror_not_just_the_lane`.
- ⛔⛔ **`#buzz-export`'s geometry is INLINE and must stay inline.** This page's
  stylesheet is a CSS module, and css-modules scopes bare `#id` selectors exactly
  like classes, so `#buzz-export { width: 1000px }` compiles to
  `#_buzz-export_<hash>` and matches nothing. It shipped that way for two days:
  the board stretched to the renderer's 1400px viewport and every people/heat
  cell sat ~800px from the count it annotates. `BOARD_W` is published as
  `window.__buzzBoardW`; `buzz_image.PROBE_JS` reads it and discards a PNG whose
  box disagrees. **Never restate 1000 in Python.**
- ⛔ **The board is TWO COLUMNS because it is an ATTACHMENT.** A client fitting a
  portrait image into a landscape box scales by HEIGHT — at 1000×1338 into
  ~550×350 it renders 262px wide, ticker type at 4.1px. **Shorten, never widen:**
  a height cut dominates (helps the fit-by-height case, neutral in fit-by-width);
  widening helps one and hurts the other. Ranks read DOWN each column.
- ⛔ **The tail is the point, not decoration.** The 1–3 mention names are what the
  owner asked to see, and the once-named chips are the SAME chip as the 2+ names
  — same box, size, weight and ink. That tier has been de-emphasised twice and
  rejected twice; four ways of restoring the gap are railed in
  `BuzzRender.test.jsx`.
- ⛔ **A cashtag beats the symbol universe.** `$XYZ` is an explicit act of naming
  a ticker; gating it on universe membership silently dropped real mentions.
  Casing collisions are handled by a corpus-derived list plus a curated
  `TICKER_DESPITE_LOWERCASE` — ⚰️ the general "trust the uppercase form" rule was
  measured and thrown away (it recovered BE/NOW/SPOT but dragged in AM, ON, IT,
  YOU, FOR). **Recall beats precision here** (owner): a false mention is cheap, a
  missed one is the product failing.
- ⛔ **Extraction is four-tier, lowest rank wins:** `cashtag > alias > exact >
  contextual`. The collision list must be derived from `#main-chat`'s OWN corpus —
  it was first derived from `#tsdr` and booked 1,059 junk mentions (7.7%), with
  `EVER` ranking 10th on 48 people.
- ⛔⛔ **ON-DEMAND IS EPHEMERAL AND THROTTLED; THE SCHEDULED POST IS NEITHER.**
  Owner ruling 2026-09-02. `/buzz` is open to every member with no role gate, so
  a public reply meant one member could put a second board in front of 750
  people at will. The interaction reply now carries `flags: 64` and the command
  spends the same per-member budget as `/chart` (`DISCORD_CHART_USER_RATE`,
  12/min — both land on the same 4-slot render valve, so one budget is the
  honest model). ⛔ **The flag goes on the DEFER (`type: 5`), not the follow-up**
  — Discord fixes a deferred reply's visibility at defer time and silently
  ignores flags on the later PATCH, so a bare defer ships the board publicly and
  looks correct in review. ⛔⛔ **The scheduled post must NEVER become
  ephemeral** — it IS what the room is meant to see, and an ephemeral one would
  leave every check green (job ran, `posted` stamped, attachment exists) while
  seven boards a day reached nobody. They cannot collide today: the digest posts
  through the bot token to `POST /channels/{id}/messages`, where message flags do
  not apply. Railed in `test_buzz_digest.py::test_the_scheduled_post_is_never_ephemeral`.
- ⛔ **A missed checkpoint is caught up, then paged.** APScheduler's job store is
  in-memory, so a pod restarting across a slot never SCHEDULES that fire and
  `misfire_grace_time` cannot see it. `catch_up()` rides the 60s poll and posts a
  slot up to 20 minutes late; past that it records the slot and raises a CRITICAL
  `chart_health_alert` (the only severity that pages Discord). **20 minutes is an
  honesty limit, not a retry budget** — the board says "since the open" and an
  hour-late post is a different board wearing an old slot's label.
- ⛔ **The design of record is a CAPTURE, not a copy.**
  `tools/gen_buzz_board_reference.py` opens the running page and saves the real
  `#buzz-export` subtree beside the real compiled stylesheet into
  `docs/superpowers/design/2026-09-01-buzz-board-reference.html`. Do not hand-edit
  it. The previous hand-written references carried a warning that they and the
  component "MUST change in the same commit" — a second authority over one value
  by construction, which silently overrode two rulings.
- **Heat marks are `HEAT_MARKS` (4), in BOTH lanes.** The image once asked for 12
  and the text for 4, so 11 of 14 rows wore a "hot" pill and the *normal* rows
  read as the anomaly. Attention rotating is not news; only the extreme tail is.
- **Backfill is resumable** via a watermark distinct from the forward cursor
  (`_BACKFILL_SUFFIX`). It used to restart from the newest message every run — on
  ~1,100 messages/day one rate limit at page 11 capped history at ~14 hours, and
  four of five consecutive runs added nothing. ⛔ **Judge it by the SPAN of data,
  never by the absence of a warning** — a run that dies prints nothing either.
- **Renderer viewport** `BOARD_H=2400` (`buzz_image.py`). It was 1400 and the
  board reached 1412 on day one; `_warn_if_capped` reads the returned PNG's IHDR
  and logs if a shot comes back exactly viewport-tall. It never discards — whether
  the renderer crops belongs to another service.

### Ops
- Activation + verification runbook: `docs/runbooks/buzz-activation.md`.
- **Two instruments, and they answer different questions.**
  `tools/buzz_derive_collisions.py` re-derives the casing-collision list from
  `#main-chat`'s own corpus. `tools/buzz_audit_extraction.py` asks what the
  extractor is getting WRONG on live chat — suppressed uppercase symbols, cashtags
  that produced nothing, aliases that never fired. ⛔ Run the second one before
  widening any matching rule: the day-one audit compared `extract(messages)` against
  the store, and since BOTH sides ran the same extractor it proved ingest fidelity
  and nothing about extraction quality — a token the extractor never recognises is
  invisible to that check by construction. The independent audit is what found the
  cashtag universe-gate bug. The corpus is the regression net, never a target.

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

Single-stock catalyst news from a curated set of TwitterAPI.io accounts, surfaced inline on MoversSidebar (🐦 icon per row, via `useTickerTweets`). Designed for morning watchlist building from overnight + pre-market catalysts.

⚰️ **Two of the three surfaces this section claimed do not exist — and the third
MOVED.** There is **no "ON THE TAPE" section** on `MoversSidebar.jsx` (`3dc5036a`
removed it; the string appears nowhere in the file), and the "Recent tweets card"
lived in the since-deleted `EarningsModal.jsx`. The tape itself is **live on the
Dashboard** as `components/tiles/TapeFeed.jsx` — but off a **different endpoint**:
`GET /api/tweets/feed` via `hooks/useTweetFeed.js`. ⭐ **The name survived the
move and the wiring did not**, which is exactly why this section read as true:
"ON THE TAPE" is on screen, so nobody checked which hook drew it. The ingestion
pipeline below (poller, store, cleanup, admin panel) is real and running. See
*⚰️ DOCUMENTED BUT UNREACHABLE* near the top for the retired `/tape` pair.

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
- `app/src/components/MoversSidebar.jsx` — 2-col RIPPING/DRILLING grid + 🐦 icon on rows with tweets. ⚰️ *(no "ON THE TAPE" section exists here — see above)*
- ⚰️ `app/src/components/tiles/EarningsModal.jsx` — its "Recent tweets" section is unreachable; the modal is orphaned.
- `app/src/components/admin/TwitterAccountsPanel.jsx` — admin-only panel on `/admin` page (slotted between Section 6b Admin Tools and Section 7 System Health).
- `app/src/utils/timeAgo.js` — shared relative-time helper (extracted from `AlertBell.jsx`; AlertBell now imports `timeAgoShort` for backward-compatible "now/5m/2h" output).
- `app/src/hooks/{useTickerTweets,useTweetFeed,useBatchTweetCounts}.js` — SWR fetchers. `useTweetFeed` (`/api/tweets/feed`) is what the Dashboard `TapeFeed` tile reads. ⚰️ `useTapeFeed.js` was listed here and is **deleted**: it had zero importers and was the only caller of `GET /api/tweets/tape` in the whole codebase. That route is still mounted and now serves nobody — the catalyst engine uses `tweet_store.tape()` **in-process**, not the HTTP route, so nothing server-side keeps it alive either. Retiring it is a follow-up, one deploy cycle behind this deletion so cached bundles do not 404.
- `tools/twitterapi_io_smoke_test.py` — pre-flight key validation script (manual run).
- `tools/seed_twitter_accounts.py` — one-shot to insert the initial curated list.

### Env vars
- `TWITTERAPI_IO_API_KEY` — required for polling.
- `TWITTERAPI_IO_ENABLED=1` — master switch for the scheduler block AND the lifespan DB-init. Set to enable polling.
- `VITE_TWITTER_UI_ENABLED=1` — frontend kill-switch (default ON; "0" hides the 🐦 icons. ⚰️ It was documented as also hiding "ON THE TAPE + EarningsModal tweets section" — neither surface is reachable, so today the flag gates the icons alone).
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
Title `{type} — {Month D, YYYY}` (ET) — **that classic format is now the
FALLBACK: under `DESK_CREATIVE_TITLES=1` (LIVE since 2026-08-19) the shipped
title is `"{Hook} | {type} — {Month D, YYYY}"`**, a Claude-composed topical
hook gated deterministically (`api/services/desk_creative.py` — corn/emoji
blocklists, market-direction honesty, whole-token number check, opener-echo
history, `"|"` banned inside hooks). ⛔ **The hook is UNTRUSTED free text to
every downstream consumer** — parse titles ONLY via
`desk_creative.parse_session_title` / match suffixes via `date_suffix`
(the format's one owner); `show_allowed`, `split_title` and
`desk_article_links._series_of` all learned this the hard way. Under
`DESK_CREATIVE_THUMBS=1` the thumbnail is an AI cover (art-director LLM →
gpt-image-1 → brand frame), re-skinned once the transcript lands
(`desk_session_insights.refresh_creative_cover`); the per-show themed cards
below are the fallback — **a PLACEHOLDER, not the answer**: a creative cover
that didn't render is queued in `api/services/desk_cover_retry.py`
(`/data/desk_cover_retry.json`; scheduler drain `2/15`, exponential backoff
15m→3h, gives up after 8 tries/48h; `POST /api/desk/creative-cover-retry`
`{"youtube_id","drain":true}` under PUSH_SECRET is the hand lever). 2026-08-20's
session shipped the themed card because ONE OpenAI 429 at publish time was
final — `_openai_generate` now retries 429/5xx with backoff and logs the body.
Both composers also get **the session's own Zoom AI-Companion summary at
publish** (`desk_creative.session_facts_from_zoom` — headline + chapter titles;
it is usually there by the time the recording lands), so a title can be about
what happened in the session rather than the morning brief; the desk ships
the editor's **pick** (not the first survivor), rotates hook forms, reads the
full wire brief (movers/earnings/rotation/regime/index reads), and runs on
`claude-opus-5` by default (`DESK_CREATIVE_MODEL`). ⭐ **The title register is
Qullamaggie's REAL stream titles** (`api/services/desk_assets/qullamaggie_register.txt`,
~80 harvested 8/20 from his channel + the 2020/2021 archives) — sentence case,
`!`/`?`, `$TICKERS`, blunt tape reads, a BUT-contrast; never Title-Case cleverness,
never a report card on our discipline (`_SOFT` gate). Edit the corpus file to
steer the voice, not the prompt. Back catalog was re-skinned 2026-08-20 via
`POST /api/desk/creative-cover-backfill` (PUSH_SECRET; atomic resumable
ledger at `/data/desk_cover_backfill.json`). Titles are FINAL at upload
(`youtube.upload` has no `videos.update`) — the creative title is composed
only on the attempt that uploads and recalled (never recomposed) on a
re-claim. `_notify_published` fires once per
genuinely-new publish (not on idempotent re-runs); recipients = `DESK_DAILY_SESSION_ALERT_EMAILS`
or `ADMIN_EMAILS`; best-effort (never breaks publish). **⚠️ NO allowlist — EVERY cloud
recording on the account auto-posts (titled by its webinar name); add a skip rule in
`_route` if private/internal recordings ever need excluding.**

**🔴 YouTube privacy is per-show and defaults to UNLISTED** (`privacy_for_section`,
2026-08-09). Only a section matching `DESK_PUBLIC_SHOWS` (default `sunday scans`)
uploads **public**; every other show — **Live Trading Sessions above all, which are
paywalled** — stays unlisted. This is the one call that decides whether a paid session
becomes a searchable video on the channel, so:
- It keys off the **routed SECTION**, not the hand-typed Zoom topic — the section is
  the canonical name `_RULES` already pins, so casing/pluralisation/double-space
  variants collapse to one answer. Keying it off the raw name would put a second
  authority on "which show is this" (the 2026-07-29 thumbnail bug).
- **A blank `DESK_PUBLIC_SHOWS` makes NOTHING public** — same contract as
  `DESK_TSDR_ANNOUNCE_SHOWS`: the failure direction is private, never a leak. Rollback
  is therefore an env var, not a deploy.
- Rails in `tests/test_desk_daily_session.py` **derive the show list from `_RULES` /
  `_HOST_AWARE`** rather than retyping it, so a show added tomorrow is covered the day
  it lands and defaults to unlisted. Mutation-checked three ways (guard deleted · call
  site stops passing privacy · client ignores the value it was handed) — the middle one
  is the "routing computed but never applied" failure this repo keeps rediscovering.

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
- `api/services/youtube_client.py` — OAuth refresh + `upload(path, title,
  description="", privacy="unlisted")` (resumable, streamed from disk; rejects a
  privacyStatus outside `_PRIVACY_STATUSES` rather than letting YouTube coerce a typo)
  + `set_thumbnail` (thumbnails.set) + `list_completed_broadcasts` (v1 poll, retired).
  ⚠️ Was `upload_unlisted` until 2026-08-09; the name was renamed rather than given a
  `privacy` kwarg **because a method called `_unlisted` that can publish publicly is
  exactly the stale-name defect this file keeps paying for** (cf. "ON THE TAPE").
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
`_STALE_SECS`, `_MAX_ATTEMPTS` · `DESK_PUBLIC_SHOWS` (default `sunday scans`; comma-
separated, matched against the routed section — **blank makes nothing public**).
Webhook URL: `https://uctintelligence.com/api/desk/zoom-webhook`.

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

### "Did everything land?" — session pipeline audit (2026-08-09)

`api/services/desk_session_audit.py` + `GET /api/desk/session-audit` (PUSH_SECRET
bearer) + a 09:00 ET scheduler job (`desk_session_audit`). A published session is
supposed to end up with a YouTube video, a transcript, chapters, ticker moments
and — for opted-in shows — a Discord announcement. **Five subsystems on three
schedules, every one of them failing quietly by design** so a hiccup can never
block publishing. This re-reads the ARTIFACTS (the `edu_videos` row + the announce
ledger) and names whatever is missing.

- **It reads the artifact, never a counter.** `desk_session_insights._FAIL_STREAKS`
  is an in-memory dict alerting on the 4th CONSECUTIVE failure — that needs an
  uninterrupted hour of 15-minute passes, and this pod redeploys several times a
  day, so the streak resets before it can fire. A proxy that resets on redeploy
  reports healthy straight through a total failure
  (`lesson_health_check_reads_a_proxy_not_the_artifact`). **Do not "improve" this
  by persisting the streak counter instead — that rebuilds the proxy.**
- **Grace window is load-bearing** (`DESK_SESSION_AUDIT_GRACE_SECS`, default 3h).
  Insights land 2 min–3 h after publish, so a session younger than the grace period
  is not checked AT ALL. Without it this fires on every healthy session and gets
  muted inside a week.
- **The announce check reads the announcer's OWN allowlist** (`show_allowed` +
  `is_enabled`), so the audit can never disagree with the thing it audits. A second
  copy of that list would drift and start flagging paywalled shows for not leaking.
- **Names, not counts** — the alert carries each session's id, title and the
  specific artifacts missing (`lesson_a_differ_can_truncate_the_names_a_rail_exists_to_report`).
- **Wiring is test-pinned two ways** (`tests/test_desk_session_audit.py`): an AST
  over `api/main.py` proving the `add_job` id exists, and a route-presence check off
  `router.routes` — each with a non-vacuity control asserting the probe can see a
  sibling it isn't looking for. Mutation-checked: cut the scheduler wire, cut the
  route, delete the grace window, or swap names for a count — each goes RED.
  ⛔ **An audit nobody runs is worse than none: it reads as coverage.** That is
  literally this pipeline's own history (the insights pass was "written, documented
  as scheduled, wired into no scheduler" for weeks).
- Env: `DESK_SESSION_AUDIT_ENABLED` (default ON) · `_GRACE_SECS` (10800) ·
  `_WINDOW_DAYS` (3).
- ⚠️ KNOWN, deliberate: a quiet run and a run with nothing to check look identical
  in Discord. The endpoint always reports `checked`, and "no sessions published at
  all" is already owned by `check_missing_session_alert`.

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
- **Alert-on-change:** Discord + in-app (`chart_health_alerts`) fire ONLY on a
  newly-seen defect that indicates OUR pipeline regressed. The "newly" baseline
  is the **durable `defect_state` table** in `/data/fundamentals_monitor.db`,
  written back only for the tickers a cycle ACTUALLY CHECKED.
  ⛔ That last clause is the whole design: this monitor SAMPLES ~30 of ~3,700, so
  "absent from the flagged set" almost always means "not looked at", and clearing
  those is the bug. `provider_coverage_monitor`'s version replaces the whole set
  each cycle because it evaluates its entire population — **do not copy it back
  here.**
  ⚰️ This previously read *"fire ONLY on newly-flagged tickers … without
  re-spamming hourly"* and described an intent that did not hold: the baseline
  was `_state["_prev_flagged_syms"]`, an in-memory set holding only the PREVIOUS
  cycle's flagged names. Half of the 30 sample slots are a random shuffle of warm
  entries plus a random cold tail, so a long-tail name left the set the moment it
  went unsampled and paged again on its next appearance — and every master push
  restarts web and cleared it outright (measured on prod 2026-09-12: started_at
  minutes old, `cycles_completed` 1, `_prev_flagged_syms` empty). It produced
  several pages a day for defects nobody could act on. **A suppression set whose
  population is a rotating sample is not a suppression set.**
- **`_CRITICAL_KINDS` is wired** and decides what pages. The split is "who is
  supposed to guarantee this?": `exception` · `bad_shape` · `nan` ·
  `dup_quarter` · `dup_forward` · `reported_forward_overlap` ·
  `label_period_mismatch` are invariants OUR code enforces, so one surfacing
  means a guard stopped working → page. `forward_gap` ·
  `forward_noncontiguous` · `stale_reported` describe a HOLE a provider handed
  us that our code faithfully reproduces → recorded in `flagged_current`, served
  by the health endpoint, and summarised in **one digest per
  `FUNDAMENTALS_MONITOR_DIGEST_SECONDS`** (default daily; stamp is in
  `monitor_meta` on disk, or a pod that redeploys three times a day sends three
  "daily" digests). ⚰️ The tuple existed from 2026-07-03 referenced NOWHERE, so
  every kind paged equally; it also listed `label_mismatch`, which
  `check_ticker` has never emitted — wiring it as written would have demoted the
  real `label_period_mismatch` signal.
- **Funds/ETFs are never flagged** (`_is_fund`, reusing `darkpool_eod._ticker_meta`'s
  cached profile lookup, consulted only for a ticker that already FAILED so the
  clean majority costs nothing). 42 of the 55 stale names in a 900-ticker sample
  were closed-end funds, which can never have a quarterly EPS strip. ⚠️ FMP's
  `isFund`/`isEtf` misses some CEFs (RNP is one) and an industry-based test would
  be worse — DHIL is also "Asset Management" and is a real operating company.
  A missed fund is recorded and digested, never paged.
- **`stale_reported`** catches the member-visible half: `_build_and_cache`'s
  completeness guard only ever asked whether there were ZERO reported quarters,
  so a strip whose newest actual was two quarters old passed as complete, held
  the full TTL, persisted to the snapshot store, and was served as current. The
  payload now carries `reported_through` + `stale_quarters` and the widget says
  so. Threshold is 2 quarters: one behind is an ordinary late filer.
  ⛔⛔ **THE MONITOR'S FLAG IS CONFIRMED AGAINST SEC EDGAR; THE DISPLAY IS NOT.**
  `reported_staleness` compares against a GENERIC 75-day expectation, which
  answers *"is what we hold old?"* — right for the member notice, useless as a
  defect signal. `check_ticker` therefore consults
  `edgar.newest_reported_quarter(sym)` and raises `stale_reported` ONLY when the
  filings show a periodic report we do not have. Validated live 2026-09-12:
  HOLX/EXAS/ACLX/FOLD/DHIL/BRY → **no flag** (SEC agrees with what we serve;
  the companies have not reported), MMC's pre-fix state → **flag** (SEC showed
  2026 Q2 against our 2025 Q4). ⭐ Display asks "is what we hold old?"; the
  monitor asks "has the company filed something we lack?" — only the second is
  actionable and only the filings can answer it. ⚠️ SEC is consulted only for an
  already-stale strip (a healthy ticker spends no round-trip), cached per ticker
  per UTC day, and a `None` answer does NOT flag — unknown and current must stay
  distinguishable or an SEC outage manufactures findings for the universe.
  ⛔ Tests that exercise a stale fixture MUST stub `sec_newest_reported_quarter`;
  without it `check_ticker` makes two live HTTP calls to sec.gov.
  Measurement and the three upstream failure modes:
  **`docs/fundamentals-provider-gaps-2026-09-12.md`**.
  ⛔⛔ **THAT DOC'S FMP TICKET IS WITHDRAWN — DO NOT SEND IT.** It accused FMP of
  dropping filed quarters for EXAS/FOLD/ACLX/DHIL/BRY/HOLX. Checked against SEC
  EDGAR's submissions index 2026-09-12 (control: MMC, BK and AAPL each return a
  2026 Q2 10-Q, so the method finds current filings), **every one of those six
  has filed nothing newer than what FMP already has** — HOLX's newest 10-Q is
  period-end 2025-12-27, filed 2026-01-29. They are not provider gaps; the
  companies have not reported. ⭐ `stale_reported` cannot distinguish "the
  provider is missing a filed quarter" from "the company has not filed one", so
  the member-facing notice states only *nothing newer has been reported yet* —
  it previously blamed the providers, for six names where they were blameless.
  ⚰️ And `sec.gov/files/company_tickers.json` is PARTIAL (10,426 entries, missing
  MMC and BK): resolve a CIK via `browse-edgar?action=getcompany&CIK=<ticker>`,
  and never read that file's silence as "not a US filer".
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
  surfaced anomaly, not a false positive. **Still flagged 2026-09-12**, now with
  twelve more operating companies; it was the first instance of a class, not a
  one-off.
- ⚰️ **`_UNREPORTED_GRACE_DAYS` (130d) is NOT the follow-up this used to
  suggest.** Measured 2026-09-12: the floor is doing the right thing in both
  directions. On MMC it correctly drops the 2026-03-31 estimate row — that
  quarter should be a reported actual by now, and showing it as a forward
  estimate is precisely the lie to avoid. Tightening it drops MORE real forward
  quarters; loosening it re-admits stale estimates for quarters already
  reported, which is the `reported_forward_overlap` class. **The gap is upstream
  absence, not our window.** Leave it at 130 unless a measurement says
  otherwise.
- ✅ **THE DATA WAS RECOVERABLE FROM A SOURCE WE ALREADY PAY FOR.**
  `/stable/earnings` is the only *earnings* endpoint on this plan, but
  `/stable/income-statement?period=quarter` — same vendor, same key, different
  endpoint — carries the reports it drops. It is now the THIRD gap-fill leg in
  `get_year_earnings` (ahead of yfinance: it has revenue, it is the plan we
  already pay for, and Yahoo's record is shorter for exactly these names).
  Measured 2026-09-12: recovers MMC (+2 quarters), SJW (+2), RNP (+2), BK (+1);
  **nine of the fifteen investigated stale names came out clean**, MMC and BK
  (~$90B and ~$97B) among them. ⛔ It is labelled by
  `_fiscal_q_from_period_end`, NEVER by FMP's own `period`/`fiscalYear` — HOLX
  ends its fiscal Q1 in late December, so the provider's numbering disagrees
  with this pipeline's and trusting it duplicates one quarter while dropping
  another, which is the trap `_year_earnings_from_stock` already documents.
  ⚠️ Actuals only — no estimate, so no surprise %; inventing one would render to
  a member as analyst consensus nobody published.
- ⛔ **The yfinance leg was UNREACHABLE for every plain US ticker** until
  2026-09-12 — `get_year_earnings._gather` gated it on `"." in prov or
  any(ch.isdigit())`, a test of the SYMBOL'S SHAPE, so a three-provider chain was
  two deep for exactly the names members open. Now gated on whether the year is
  still on screen (`_is_recent_year`: current or previous), which is the cost the
  shape test was really protecting. ⚠️ **This does not close the gap** — Yahoo is
  empty for MMC, BK and HOLX too (control: AAPL/NVDA return five quarters in the
  same session). It fixes a decorative fallback; it recovers nothing for the
  worst names.

## ⚠️ FOR RAVI — a one-line change landed in `api/live_massive_router.py` (2026-09-01)

**A non-partner change was made to a partner-owned file, with the owner's
go-ahead, and you should know before your next edit.** It is one deletion plus a
comment; nothing was refactored and nothing else in the file was touched.

**What it was.** `_parse_mdy` was defined TWICE — line ~3515 returning a
sortable `(Y, M, D)` tuple with `(0,0,0)` on malformed input, and a second
definition ~480 lines later returning `date | None`. Python keeps the LAST
top-level definition, so all four call sites — every one written for the tuple —
were running the date version.

**Why it mattered.** The call sites do `_parse_mdy(d) <= today_key`, and
`_resolve_date` passes unrecognised input through UNCHANGED, so a query param
reached that comparison directly. Reproduced before touching anything:

    today='2026/08/31'   tuple -> []          (a clean empty day)
                         date  -> TypeError: '<=' not supported between
                                  instances of 'datetime.date' and 'NoneType'

That is a 500 on the `lookback_days >= 2` paths of `_compute_recent_multiday`
and `_build_by_contract`, where the docstring promises zero rows.

**The fix** is the deletion of the caller-less date version. The surviving
definition is the one every caller was already written against, so no call site
changed. `tests/test_no_shadowed_definitions.py` (an AST sweep for a top-level
name bound twice, whole-repo) now guards it, and all 10 suites importing this
router are green.

**If this conflicts with work in flight,** take your side and keep the deletion —
the two definitions cannot both stand.

## Live Options Flow — Deploy Survival (2026-07-06 · LOCKED invariants; P5 CUTOVER DONE 2026-07-13)

**P5 cutover complete (2026-07-13):** the Massive OPRA WS consumer (`api/massive_ws_worker.py`,
partner-owned) + flow.db + ALL flow.db-owning jobs (T+1 flat-files ingest, gap-fill, R2 backup,
nightly prune) run on the **FLOW-WORKER service**. Web serves every flow-family read/write via
`api/flow_proxy.py` (registered in main.py BEFORE the local flow routers; active under
`FLOW_READS_PROXY_ENABLED=1` + `WORKER_INTERNAL_URL`; HMAC-vouched auth, SSE passthrough).
Env: flow-worker `MASSIVE_WS_ENABLED=1` + `MASSIVE_S3_*` + backup/gap-fill flags; web
`MASSIVE_WS_ENABLED=0`, `FLOW_BACKUP_ENABLED=0`, `FLOW_GAP_AUTOFILL_ENABLED=0`,
`MASSIVE_FLATFILES_ENABLED=0`. **Web deploys no longer touch the options tape.** flow-worker
deploys still cost a ~15-60s single-slot WS handoff — they are RARE and ship after-hours.
⚰️ This said *"manual `railway up --detach -s flow-worker`; NO GitHub trigger until
deliberately reconnected"* — **the reconnection happened 2026-07-17**: flow-worker IS
GitHub-triggered on NARROW watch paths set per-service in the Railway dashboard (the
dashboard is the ONLY authority; the one in-repo mirror is the `api/flow_worker_main.py`
header comment, synced to the live dashboard list 2026-08-21). A push touching a watched
file bounces the tape and THAT gap is permanent until the T+1 flat file — the market-hours
freeze and its `UCT_FLOW_OVERRIDE` double-lock were REMOVED 2026-08-24 (owner decision), so
nothing mechanical stops a mid-session flow-worker deploy. Rollback = flip the env sets back
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
- **Shipping window: NO FREEZE (2026-08-24).** The market-hours push freeze (Mon-Fri
  9:15a-4:20p ET) and BOTH its guards — the `pre-push` hook and the `Deploy window guard`
  workflow — were removed by owner decision. Push whenever. The physics did not change and
  is now unguarded: a web swap blips /api/* ~1 min for members and rebuilds the bars worker;
  a push touching a flow-worker watched file bounces the OPRA tape, and that gap is
  PERMANENT until the overnight T+1 flat file.
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
