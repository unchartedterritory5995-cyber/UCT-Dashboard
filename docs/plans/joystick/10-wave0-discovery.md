# Wave 0 — Discovery report (Joystick Hub)

Director consolidation of nine read-only scout reports.
Worktree `C:\Users\Patrick\uct-worktrees\joystick-hub`, branch `feat/joystick-hub`, base `origin/master` @ `42daef020`.
Nothing was built. No file outside `docs/plans/joystick/` and `.claude/agents/` was created or changed.

Spec of record: `docs/plans/joystick/00-master-spec-v1.1.md` (the **mobile-only** revision — no desktop path, no keyboard mapping).

---

## 0. The headline

Six of the spec's load-bearing assumptions are false against this codebase. Two of them are large enough
to change what gets built, not just how. They are listed first because everything downstream depends on them.

| # | Spec says | Reality | Severity |
|---|---|---|---|
| 1 | Charts use "the licensed TradingView charting library"; drive it with `widget.activeChart().setResolution()` / `setSymbol()` / `executeActionById()` / `createStudy()` | **Lightweight Charts v5.2.0.** None of those four calls exist anywhere in the repo. Chart mode must be re-derived from scratch. | **Blocking** |
| 2 | The hub docks bottom-right on every page | **That corner is occupied and has already been vacated twice on the one screen that matters.** On the portrait phone chart both the voice orb and the feedback FAB are `display:none` — because they covered candles and tap-blocked the back-to-live chip. | **Blocking** |
| 3 | "Echo" is the catalyst feed section | **No such name exists.** The feature is **Stock Catalysts**, a *tile* on `/dashboard` (and in Morning Wire's rail). It has no route of its own. | High |
| 4 | "Watch" adds the symbol to UCT20 | **UCT20 is engine-curated and read-only.** Zero write endpoints; the router has no `@router.post` at all. Nobody — member or admin — can add to it from the app. | High |
| 5 | Numbers render in a mono face (IBM Plex Mono) | **There is no monospace font.** `--font-mono`, `--font-sans`, `--font-display` and `--font-heading` all resolve to `Instrument Sans`, deliberately unified. | Medium |
| 6 | Hub renders on touch devices ≤ **900px** | **900 is not a canonical breakpoint.** The repo's two boundaries are 640 and 1024, and CLAUDE.md forbids introducing new literals. | Medium |

Two more that change the shape of the work rather than contradicting the spec:

- **No section in this app has a selection cursor.** Not the Screener, not Journal positions, not Catalysts.
  Every "tap = next X" in Part C needs new state built before it can be wired to anything.
- **Almost the whole app is already paid-gated** (`FREE_PAGES = ['/morning-wire']`). Per-action `tier` declarations
  are near-vacuous: if a user can see the hub at all they can use essentially every action in it.

---

## 1. Route table (the corrected section names for Part C)

Read from `app/src/App.jsx` (one inline `<Routes>` tree; no route-config file). Gating is centralized in
`app/src/components/AuthGuard.jsx:109-173` as a sequence of `pathname` checks — a route's gate is **not**
visible at its own `<Route>` declaration.

| Spec name | Real route | Real component | Notes |
|---|---|---|---|
| Home / Dashboard | `/dashboard` | `pages/Dashboard.jsx:95` | `/` redirects here for paid, `/morning-wire` for free (`App.jsx:217,228`) |
| Scanner | `/screener` | `pages/Screener.jsx:68` → `pages/screener/shell/ScannerShell.jsx:42` | Nav label "Screener" |
| Chart | `/charts` | `pages/charts/ChartsWorkspace.jsx` → **`mobile/MobileChartsApp.jsx`** on touch | Not `MobileWorkspace` — CLAUDE.md is stale twice over here |
| Echo | **none** | `components/tiles/CatalystTable.jsx` | A tile on `/dashboard` + `/morning-wire`'s rail. History browser at `/catalysts/history` |
| Journal 2.0 | `/journal/trades` | `journal-2-0/surfaces/TradesSurface.jsx` → `OpenPositionsTab.jsx` | v5 nested shell at 100% rollout (`shellFlag.js:20`) |
| Notebook | `/journal/notebook` | `journal-2-0/surfaces/NotebookSurface.jsx` → `tabs/NotebookTab.jsx` | **A sub-route of Journal**, not a top-level section |
| Breadth | `/breadth` | `pages/Breadth.jsx` | Phones land on the **Daily** tab (`overview`), not Monitor (`Breadth.jsx:560-564`) |
| Calendar | `/calendar` | `pages/Calendar.jsx` | **UI label is "UCT Terminal"** (`NavBar.jsx:20`, `CalendarHeader.jsx:631`); plumbing stays `calendar` |
| Morning Wire | `/morning-wire` | `pages/MorningWire.jsx` | The one free route |
| Options Flow | `/options-flow` | `pages/OptionsFlow.jsx` (9,684 lines) | Partner-owned. Also `/live-massive`, `/flow-scoreboard` |
| UCT20 | `/uct-20` | `pages/UCT20.jsx` | Read-only. `/watchlists` is a `LegacyRedirect` → `/charts` |

**Mount point.** A global fixed element belongs in `app/src/components/Layout.jsx:132-138`, as a sibling of
`FeedbackWidget` / `MoreSheet` / `TickerHubSheet` / `CommandPalette` inside `.shell`. That covers every
authenticated in-app route and **not** the public/marketing routes, the `/r/*` headless renderers, or the two
journal interstitials — none of which mount `<Layout/>`.

`.shell` is `overflow:hidden`, `.main` is `overflow-y:auto` (`Layout.module.css:1-6,38-43`). A `position:fixed`
element is unaffected by both, but **scroll listeners must use capture phase on `window`** — the app scrolls the
inner `.main` div, so a bubble-phase `window` scroll listener never fires. Reuse `hooks/useHideOnScroll.js:43`.

---

## 2. The corner problem (Finding #2, in detail)

This is the single most consequential discovery of Wave 0, because the codebase has already run this
experiment and reversed it.

**What is there now**, measured from CSS at the touch breakpoint:

| Element | Position (touch) | Size | z-index | Visible to |
|---|---|---|---|---|
| Voice orb cluster (`voice/FloatingOrb.module.css:152-156,192-196`) | `right:14px; bottom:calc(16px + safe-area)` | **214px wide** (64px orb + three 44px satellites at 6px gaps), 64px tall | `--z-fab` = **350** (`tokens.css:246`) | Paid only; user-draggable, position persisted in `localStorage['voice.orb.position']` |
| Feedback "?" (`FeedbackWidget.module.css:19-28`) | bottom-**left**, `left:14px; bottom:calc(16px + safe-area)` | 40px | 500 | Logged-in, non-admin routes |
| Desk mini video (`video/hostStyle.js:8-14,38`) | bottom-right, `mobileBottomClear: 80` | varies | 8500 | When a video is active |

The proposed hub at `right:22px; bottom:calc(safe-area + 28px)`, 84px square, spans `[22,106]` horizontally
and `[28+safe, 112+safe]` vertically from the corner. The orb's **AgentPicker toggle** `[14,58]` and
**VisionAttachButton** `[64,108]` overlap it by 36–42px in both axes. The 64px orb button itself sits
farther left (`[164,228]`) and does not overlap.

Note the existing precedent already encoded in the repo: `hostStyle.js:8` gives the mini video player
**80px** of bottom clearance on mobile with the comment *"also clears the orb"*. The spec's 28px is a third of that.

**The decisive part.** On the portrait phone chart (`pointer:coarse` + `max-width:640px`), both the orb and the
feedback FAB are `display:none` outright — `FloatingOrb.module.css:283-292`, `FeedbackWidget.module.css:54-58`.
The comment reads:

> *"the orb cluster was squatting on the volume pane of the one screen where every pixel is candles
> (it also tap-blocked the back-to-live chip once)… the chart page belongs to the chart."*

On the wider touch range both instead step **up over the toolbar** to `bottom: calc(68px + safe-area)`,
keyed off `html[data-mobile-chart-shell]`, which `MobileChartsApp.jsx:82-89` stamps while mounted.

Related but distinct: `pages/charts/mobileShellHeight.test.js:86-103` is a **resurrection guard** forbidding
`--mobile-tabbar-h` from reappearing in the shell's `calc()` height budget, after the 58px bottom tab bar was
retired on 2026-09-01 and its space given back to the chart. A `position:fixed` hub consumes zero layout
height and does **not** trip that test — but it reproduces the exact defect the guard exists to remember.

---

## 3. Chart mode, re-derived (Finding #1, in detail)

`app/package.json` → `"lightweight-charts": "5.2.0"`. `StockChart.jsx:12` imports `createChart` from it.
No `charting_library`, no datafeed, no TradingView widget object. (`TickerPopup` and the Breadth drill modal
embed a raw TradingView **iframe** for preview only — no postMessage bridge, no scriptable API.)

**There is no single "chart API".** Three narrow imperative surfaces exist at different layers:

1. **`ChartPane` ref** (`chart/pane/ChartPane.jsx:616-636`) — what the mobile shell holds:
   `openSettings, applySettings, focus, changeSymbol, getRect, getViewState, goToDate, goToYear, stepBar,
   ensureFullHistory, getDateMeta`. **No timeframe setter** — `tf` is a controlled prop only.
2. **`toolbarApiRef`** (`StockChart.jsx:4045-4080`) — `openIndicatorLibrary()`, `openAlerts(initialFor)`,
   `getSnapshotBlob()`, `expandDrawToolbar()`. A *reveal* API, not a *select* API.
3. **`chartApiById`** (`pages/charts/WorkspaceContext.jsx:23-27`) — `setComparison`, `setPercentScale`,
   `setHideBase`, … **registered only by the desktop `ChartWidget.jsx:212-242`. `MobileChartsApp` never touches it.**

Per spec action:

| Spec action | Reality |
|---|---|
| Next / prev timeframe | Buildable. Canonical list `NATIVE_TFS = ['1','5','15','30','60','D','W','M']` (`chart/timeframes.js:12`). State is `chartWidget.opts.tf`, written via `onOptsChange` (`MobileChartsApp.jsx:144-147`), persisted per-widget into `charts_workspace_layout`. |
| Cycle symbol | Buildable. `setGroupSym(color, sym)` (`MobileChartsApp.jsx:149-158`). Symbols are per **color group** (A–D), not app-wide. **No "next symbol" source list exists** — nearest is `mobileRecents.js`. |
| Pan (horizontal scrub) | Partial. `timeScale().setVisibleLogicalRange()` exists on the LWC instance but is **not exposed** on any of the three refs. `ChartPane.goToDate/stepBar` is the nearest host-callable lever; whether it supports smooth incremental scrubbing vs jump-to-date is **unverified**. |
| Draw (trendline) | Partial. `expandDrawToolbar()` reveals the bar but selects no tool; `activeTool` is private `useState` (`StockChart.jsx:3911-3913`). Needs a new `selectTool(name)` on the toolbar ref. |
| Indicator set (EMA 9/21/50, VWAP, AVWAP) | Messy. MAs live in a **fixed 4-slot array** `cs.overlays[]` defaulting to EMA9/EMA20/SMA50/SMA200 — there is no "add a fifth"; EMA 9/21/50 means clobbering the user's SMA50/SMA200. VWAP/AVWAP are separate engine instances via `addInstance()` (`chart/engine/instanceControls.js:379-398`). ⚠️ **Two different AVWAPs exist** — an engine indicator with a named anchor, and a click-anchored drawing tool. The spec must say which. |
| Alert at crosshair price | Not buildable as written. `crosshairData` is private `useState` (`StockChart.jsx:3471`) with no external accessor. `MobileAlertSheet` seeds from **live price**, not crosshair (`MobileAlertSheet.jsx:28,34`). Getting the crosshair price out is a new wire. |
| Compare (overlay QQQ) | Desktop-only today. `setComparison(arr)` is on `chartApiById`, which mobile never registers. Reachable on mobile by writing `cs.comparisonSymbols` through the `handleStore` the shell already owns. |

**Readiness.** `StockChart` has `onBarsReady`, but neither `ChartPane` nor `MobileChartsApp` wires it. Every
imperative call is optional-chained or try/caught — a command before readiness is a **silent no-op**, no error,
no queue. The spec's "if the widget is not ready, actions are disabled" has nothing to read today.

---

## 4. Per-section state map

The recurring answer: **the state a joystick needs does not exist yet.** Not trapped in the wrong place — absent.

### Scanner (`/screener`)
- Rows live in `ScannerShell.jsx:60-66` local `useState`, fed by `useScreenerScan.js` (hand-rolled, not SWR, 300ms debounce). Nothing above it can see them.
- **No selected-row index exists, and selection is not even visual** — no `.selected` class in `VirtualResults.jsx` or `ResultCards.jsx`. Tapping a ticker opens `TickerPopup`/`TickerHubSheet`; it does not select the row.
- **Two unrelated "scan" concepts**: *My screens* (a whole saved spec; applying it **discards the screen's identity** — nothing records that this used to be "RS leaders") and *My scans* (boolean AST formulas, identified only by an opaque `ast_hash` inside `filters.scan`). The chip's `"RS leaders · 3/41"` has no backing for the left half.
- Phone has **no sort UI at all** — `ResultCards` is never passed `sort`/`onSort` (`ScannerShell.jsx:196-197`).
- Count readout exists: `"N matches"` (`ShellToolbar.jsx:173-175`).

### Journal 2.0 (`/journal/trades`)
- `useJ2Positions.js` — SWR poll, 15s during market hours. Row shape has `stopPrice`, `breakevenStop`, `raiseToBreakeven`; **no `currentPrice`, no `rMultiple`** — both derived client-side.
- **No selected-position concept.** The default mobile view (`HoldingsList`) shows no stop, no R, and no actions; only the opt-in `PositionsTable` phone card does.
- **`activeStop(p)`** (`lib/journal-2-0/calculations.js:55-56`) is the stop actually in force. `breakevenStop` is a *separate field* — "raise to breakeven" never mutates `stopPrice`, deliberately, so R stays honest on close.
- **No one-tap "move stop to breakeven" exists.** Only the full `EditPositionModal`.
- R math exists but only for **closed** trades: `tradeRMultiple({side, entryPrice, exitPrice, originalStop})` (`calculations.js:687-690`). A live open-position R is a one-function addition, not a new system.
- Stop write: `PUT /api/j2/positions/{id}` with a whitelisted partial patch. Pure SQLite, no broker.
- Stop-placement mode **exists and is well named**: `settings.defaultStop.mode` ∈ `custom | bar_low_high | fixed_dollar_risk | fixed_percent_distance` (`services/journal_two/settings.py:76`), labeled "Default stop placement" in the UI. Its prefill logic is a private helper in `AddPositionModal.jsx:59-95` — pure, trivially exportable.
- Sizing: `settings.defaultSizePct` → `computeDefaultShares()` (`journal-2-0/lib/disciplineGuards.js:13-20`), regime-scaled by `settings.regimeSizeMultipliers`.
- **Planned trades do not exist.** No status column, no table, no endpoint; `AddPositionModal` even caps `entryDate` at today. See §6.

### Catalysts (spec's "Echo")
- `useCatalysts.js` → `GET /api/catalysts/today`, SWR, 30s poll.
- **No read/unread state of any kind.** `is_new` is server-computed and global, not per-user. **"Next unread item" is not buildable.**
- Real filters: `ALL_TAGS = ['Catalyst','Earnings','Gapper','News']` (`CatalystTable.jsx:18`) plus an "A only" grade toggle — **not** all/confirmed/filings/analyst/FinTwit. Both are local `useState`; the component's only props are `{compact, datePicker, title}`.
- No selected-item concept — only a multi-expand `Set`.
- **Timeline scrub would be dishonest.** The table is a top-20 curated snapshot upserted per `(market_date, ticker)`; rows are overwritten in place and can drop off with no trace. Scrubbing "to 10:15am" would show today's *final* list sorted by time, not what was on screen at 10:15.
- ⚠️ The 👍/👎 and note controls are **not cosmetic** — they steer what the curator picks on future days. A stray gesture must not reach them.

### Morning Wire — **the best-supported section in the whole spec**
- The brief is a server-built HTML blob rendered via `dangerouslySetInnerHTML` (`MorningWire.jsx:338-343`), but it is **not opaque**: sections are `<section class="rd-seg" data-seg="KEY">`, already queried in-file at `MorningWire.jsx:183`.
- Closed key set (`api/routers/wire_feedback.py:17`): `overall, tape, macro, earn, analyst, movers, setups, close` — 7 real DOM sections plus a synthetic "overall".
- This scheme is already wired end-to-end for per-segment 👍/👎/notes. **"Next section" needs no new state** — just `querySelectorAll` + `scrollIntoView`.
- Symbols in the brief carry 7 different block-specific classes (`.rd-pick-sym`, `.rd-lv-sym`, `.rd-rs-sym`, `.rd-order-sym`, `.rd-cal-tk`, `.rd-ti-sym`, `.rd-watch-sym`) — no generic marker, no `data-sym`. "Chart the current section's symbol" needs a small allowlist.

### Breadth
- Metric groups are **`SCORE, PRIMARY, MA, REGIME, HIGHS, SENTIMENT`** (`Breadth.jsx:102-111`) — not thrust/MA%/positioning. Group identity is a **rendering detail only**: its sole runtime use is drawing a hairline rule (`Breadth.jsx:882-888`). There is no active-group state to cycle.
- **A scrubber already exists** — `pages/breadth/BreadthScrubber.jsx` (drag + play/pause + speed), wired today only into the Views tab, which holds the entire 90/180/365-day window in memory. **Zero-fetch scrub is viable there today.** The Monitor tab fetches in 150-row blocks (`useMonitorGrid.js:24-25`) — mostly free, occasionally one request.
- Date cursor is **split across two tab-local states** that die on tab switch (Views unmounts entirely).
- Snapshot PNG exists and is reusable: `breadthShare.js:135-182` (`modern-screenshot` → branded card), currently only on the Monitor header.
- "Sizing rule" = the UCT Exposure Rating, rendered by `ExposureBar` in `MarketBreadth.jsx:24-55`. No dedicated page. "Sectors", "Phase detail", and "Scan with a breadth filter" have **no entry points**; "Compare prior cycle" exists only as the **admin-only** Analogues tab.

### Calendar
- Week/day state is URL-owned (`?week=&d=`) and cheap to read from outside. `monthCursor` is unpersisted component state.
- Views are **Wire / Board / Table / Month** (`CalendarHeader.jsx:257-260`), pref key `calendar_view_v3`.
- Earnings (`bmo/amc/tbd`) and econ (`econ/fed`) are separate sources merged per-day; the filter has 4 chips with Earnings effectively always on — **there is no econ-only view**.
- "My names" is real and already built: `/calendar/mystocks` + `useCalendarMySets()` over watchlists ∪ flagged ∪ J2 positions ∪ UCT20.
- Event alerts: only an automatic background job (`services/calendar_alerts.py`), no per-event user control. The reachable "Alert" is a **price** alert via `TickerActions`.
- "Add to Notebook" from a calendar entry: **does not exist**.

### Notebook
- `createNoteViaApi()` (`journal-2-0/lib/noteCreation.js:17-44`) → `POST /api/j2/notes` with `{title, bodyJson, tags, ticker, folderId}`. **Title, body and ticker in one call** — the cross-section "Note" action is genuinely one tap.
- `bodyJson` must be a TipTap doc built from `lib/tiptapDocBuilders.js`. **No table extension** — table nodes are silently dropped.
- Ticker link = the `j2_notes.ticker` column (single-value). `j2_note_mentions` is a separate `$CASHTAG` scan — don't use it for pinning.
- **Templates exist on master** (`21bfd6854`, already merged): 8 templates including `daily-prep` ("Daily Game Plan") and `trade-review` ("Trade Post-Mortem"), deep-linkable as `/journal/notebook?new=<key>&ticker=SYM`.
- **Search cannot be opened programmatically** — `FolderSidebar`'s search mode is local state with no `?q=` deep link (unlike `?folder=`/`?ticker=`/`?new=`). The Command Palette's "Search Notebook" entry is a keyword alias pointing at the bare route.
- **Voice is not wired into Notebook** at all — deliberately not carried over from its predecessor.
- **Obsidian has no "sync now".** It is a *device push* connector: `connect` mints a code the desktop plugin redeems, then the plugin pushes. `syncSource()` exists only for pull providers. Read `providers.obsidian.connected` from `useNoteConnectors()`; when false, deep-link `/settings?section=connections` (the existing idiom, `NoteConnectorsTrustStrip.jsx:32`).
- ⚠️ Note CRUD is `get_current_user`-gated, **not** `require_paid` — the paywall is a client route redirect. A hub action firing a raw `fetch()` bypasses `AuthGuard` entirely.

### Options Flow — navigate-only, confirmed
`OptionsFlow.jsx` has exactly one export: its default component (`:615`). No hook, no context, no callable
global (`window.__flowChartsStats` / `__flowRenderStats` are debug counters). Nothing imports anything from it.
**The Flow fan stays `[Home]`.** Its four `position:fixed` blocks are full-screen modals, not corner controls —
but note they sit at `z-index:9999–10000`, outside the house scale.

Drift found, **not ours to fix**: CLAUDE.md documents an `of-tip` className hook with a `data-pin` tap-toggle.
`of-tip` no longer exists in `OptionsFlow.jsx` and `data-pin` exists nowhere in the tree; the corresponding
rule in `OptionsFlow.mobile.css:172-175` is a dead no-op. That is a request for the Flow owner.

---

## 5. Platform inventory (what the hub can reuse)

| Need | What exists | Where |
|---|---|---|
| Live prices | Pooled SSE + REST merge. `subscribe(tickers, listener)`, union-chunked at 50 tickers. **Already-hot symbol = free; cold symbol = one shared round-trip.** | `lib/priceStreamManager.js`, `hooks/useRealtimePrices.js` |
| Live breadth | `useLiveBreadth()` — SWR, 60s, backs off to 15min | `hooks/useLiveBreadth.js` |
| Data fetching | **SWR** (no react-query). One hook per endpoint; `SWRConfig` at `App.jsx:300`. Preferred wrapper `utils/jsonFetcher.js:30-38` (throws on non-2xx so a 402 can't read as empty) — recommended, not yet dominant. | — |
| Haptics | **Helper exists**: `tap()` 10ms, `impact()` 18ms, `success()` `[10,40,12]`, `warn()` `[22,60,22]` | `components/mobile/haptics.js:13-18` |
| Toast | `useJournalToast()` / `<JournalToast/>` — a `[msg, setMsg]` pair, 2200ms auto-clear, `role="status"`, text-toggles rather than mount/unmount (an a11y choice). **Per-consumer chip, not a global stack** — the hub needs its own mount point. Used by 12 files, most of them *not* journal. | `journal-2-0/lib/useJournalToast.jsx:13-31` |
| Settings persistence | `user_preferences(user_id, pref_key, pref_value TEXT)` + `GET/POST /api/auth/preferences`. Client: `usePreferences()` with **`setPrefMerged(key, updater)`** for JSON blobs — atomic merge inside the SWR mutate, per-key write queue, tombstones for deletion. **`chart_settings` is the exact precedent for the hub's settings bundle.** | `hooks/usePreferences.js:150-191` |
| Tier | `isPaid` = admin ∨ plan ∈ {pro, premium, lifetime} ∨ active trial | `context/AuthContext.jsx:171-173` |
| Locked-state idiom | `MoreSheet` **renders every item**, dims the locked ones with a lock icon, and routes them to `/subscribe` instead of the destination — exactly the spec's "disable, don't hide" | `components/mobile/MoreSheet.jsx:141,149` |
| Feature flags | **Three coexisting mechanisms**, with inconsistent defaulting. Safest precedent = server status endpoint defaulting `"0"` (Community: `api/routers/community.py:44-45` → `GET /api/community/status`) | — |
| Analytics | **None for authenticated in-app use.** The only `track()` is anonymous, landing-page-scoped, with a hard server-side allow-list of ~20 marketing event names. No posthog/segment/amplitude. `hub_action` has nowhere to go. | `utils/landingTrack.js:40-67`, `api/routers/landing_analytics.py:32-52` |
| Speech ("Say it") | `useRealtimeSession().connect(context)` — the same call the orb makes. Paid-gated. Already understands `open_page`, `open_ticker`, `change_chart_timeframe`, `add_chart_indicator`, `change_chart_type`. | `hooks/useRealtimeSession.js:398` |
| Reduced motion | Global CSS reset at `styles/tokens.css:541-548` **plus** a JS idiom to copy for rAF work (`useAnimatedNumber.js:13-16`). CSS alone will not stop a rAF spring. | — |
| Icons | `UIcon` — **87 glyphs** (CLAUDE.md's "~65" has drifted), `UICON_NAMES` exported. Gold-embossed by default; `gold={false}` for `currentColor`. | `components/ui/UIcon.jsx:17-453` |
| Safe area | `viewport-fit=cover` + `interactive-widget=resizes-content` present (`app/index.html:29`); `env(safe-area-inset-*)` used in 20 files; `100dvh` in 16. **`window.visualViewport` has exactly one consumer** — `hooks/useKeyboardVisible.js`, used by `MobileNav`. | — |

**Design tokens** (`styles/tokens.css`): `--bg:#101012` (OLED `#000`, light `#fff`) · `--ut-green:#2d8c4e` /
bright `#34d17c` · `--ut-red:#c0392b` / bright `#f24b42` · `--ut-gold:#dcbb5e` (`--accent`) ·
`--text:#f0efea` · `--border:#2a2c31` · radii 4/6/8/12/16/999 · `--tap-min:44px` ·
z-scale `dropdown 100 → sticky 200 → nav 300 → fab 350 → backdrop 399 → drawer 400 → modal 1000 → toast 1100`.

Two token facts that contradict the spec:
- **Glass already has tokens** (`--glass-surface`, `--glass-elevated`, `--glass-border-neutral/accent`, `--glass-chrome`),
  but they are **deliberately absent from the light theme** — `tokens.css:432-436` says *"NO --glass-\* HERE, ON PURPOSE"*.
  `backdrop-filter` appears in 33 files but **only transiently** (modal backdrops); the token comment restricts it
  for performance. Nothing in this app currently runs a persistent, always-on `backdrop-filter` the way an
  always-visible glass knob would.
- **There is no mono font.** All four font tokens resolve to `Instrument Sans` (`tokens.css:177-184`).

**Breakpoints**: `BP.phone = 640`, `BP.tablet = 1024` (`styles/breakpoints.js:18-21`). Hooks: `useIsPhone`,
`useIsTablet`, `useIsTouch` (**a width test ≤1024, not an input-modality test**), `useHasCoarsePointer`, `useHasNoHover`.
⚠️ `useMediaQuery.js:4-15` seeds once at mount and only updates on a `change` event — in a fixed mobile context
the viewport never changes, so a JS read can render the desktop variant on a phone. **Gate the hub's visibility
in CSS `@media`, not on a JS mount condition.**

---

## 6. "Plan trade" — the one genuinely new thing

**No planned-trade concept exists.** `j2_positions` has one lifecycle signal: `closed_at IS NULL`. No status
column, no draft table, no endpoint. `AddPositionModal` caps `entryDate` at today, reinforcing that every row
is an already-filled position.

Two options, and the scouts converge on the same recommendation:

- **(a) Extend `j2_positions`** with a status/nullable-fill column. **Risky.** Every consumer of
  `list_open_positions()` — portfolio aggregates, `BrokerAccountHero`, and the broker-mirror-fidelity
  invariants CLAUDE.md marks LOCKED — assumes those rows are real open exposure. Planned rows would
  pollute all of it unless every call site is audited.
- **(b) A new narrow table + endpoint** for planned entries, converting to a real position only on fill.
  **Recommended** — it keeps the broker mirror byte-honest.

**Order-path safety, certified.** A whole-repo grep for `place_order|placeOrder|submit_order|/orders|OrderTicket|create_order`
returns **zero** matches outside test prose. `services/journal_two/broker/snaptrade_client.py`'s complete function
list (`:313-517`) is register/login/delete/reset/status/list-users/list-authorizations/balance-history/partner-info/
refresh/list-accounts/get-balances/get-positions/get-recent-orders/get-option-holdings/get-activities — **every one a
read or an OAuth lifecycle call**. `recent_orders.py:284-290` only *reads* executed history to reconcile fills.
**There is no order path in this repository to cross.** `close_position()` writes `j2_trades` + `j2_positions`
in one SQLite transaction and imports nothing broker-related.

---

## 7. Files proposed for Phase 1 (nothing written yet)

```
app/src/hub/
  registry.ts          modes + actions as data; defineMode(); requires/tier; JSON-patch overrides
  HubContext.tsx       mode, setMode, shared symbol/timeframe/activeScan/selectedPosition
  useHubMode.ts        per-page registration hook
  JoystickHub.tsx      gesture engine + glass UI (Phase 2)
  hub-tokens.css       --hub-glass-tint / --hub-rim / --hub-shadow / per-mode accents
  haptics.ts           thin re-export of components/mobile/haptics.js (no second authority)
```
Mounted once in `components/Layout.jsx` beside `FeedbackWidget`. Settings ride `usePreferences`'
`setPrefMerged` under a single `joystick_hub` pref key, mirroring `chart_settings`.

New state the hub must create because nothing equivalent exists (all additive):
`useScanCursor` · `useJ2SelectedPosition` (mirroring `useJ2SelectedAccount`'s localStorage + CustomEvent idiom)
· `positionRMultiple()` in `calculations.js` · an exported `prefillStop()` · a `lastSection` localStorage write.

---

## 8. Deferred — Part C entries with no backing state

| Section | Entry | Why |
|---|---|---|
| Echo | "next unread item" | No read/unread state exists anywhere |
| Echo | timeline scrub | Data is an overwritten snapshot, not an event log — a readout would lie |
| Echo | Filter cycle as specified | Real values are Catalyst/Earnings/Gapper/News, not the spec's five |
| Echo | Mute ticker | Does not exist |
| Echo | Pin to Notebook | Endpoint exists generically; zero wiring to catalysts |
| Scanner | Chip's `"RS leaders · …"` | Applying a saved screen discards its identity |
| Scanner | Sort | No phone sort UI exists at all |
| Chart | Alert at crosshair | `crosshairData` is private state with no accessor |
| Chart | Indicator set | The 4-slot MA array cannot express EMA 9/21/50 without clobbering user defaults |
| Breadth | Metric-group cycle | Groups are a rendering detail, not state |
| Breadth | Phase detail / Sectors / Scan-with-breadth-filter | No entry points exist |
| Breadth | Compare prior cycle | Only as the admin-only Analogues tab |
| Calendar | Event alert | Only an automatic background job; no per-event control |
| Calendar | Add to Notebook | No wiring |
| Notebook | Double-tap = search | Search mode cannot be opened programmatically |
| Notebook | Voice note | Not wired into Notebook (reachable via the generic transcribe endpoint instead) |
| Notebook | Sync (Obsidian) | Push connector — there is no "sync now" to fire |
| Cross-section | Watch → UCT20 | Read-only list, no write endpoint |
| All | `hub_action` analytics | No authenticated event sink exists |

---

## 9. Corrections to `CLAUDE.md` found in passing

Recorded, not yet applied (Director owns that file):

1. `/charts` mobile renders **`MobileChartsApp`**, not `MobileWorkspace` — CLAUDE.md's own unreachable-table already
   corrected this once, to a name that has since been superseded again. `MobileChartsApp` appears nowhere in the file.
2. The Nav Tabs list says **"Calendar"**; `NavBar.jsx:20` reads **"UCT Terminal"**.
3. `OptionsFlow.jsx` is described as "~7k lines" — measured 9,684.
4. `UIcon` is described as "~65-glyph" — measured 87.
5. The Phase-E door `/screener → SavedScreensPanel → ScanResults → CoverageLine` is stale:
   `SavedScreensPanel.jsx` no longer exists (only its CSS module), its logic moved into `ScreensManager.jsx`.
6. `TapeFeed.jsx` is described as mounted on Dashboard twice; its mount was **cut** (`64960303b`) and the tape now
   lives inside `MoversSidebar`, which imports `useTweetFeed` directly.
7. `chart/engine/instanceControls.js:375-377` claims `addInstance` is "EXPORTED WITH NO CALLER" — it has five live callers.
8. The `of-tip` / `data-pin` Options Flow hook documented in CLAUDE.md no longer exists in the partner file.
9. Calendar view modes are Wire/Board/Table/Month on pref `calendar_view_v3`, superseding the documented
   Feed/Week/Month on `calendar_view`.
