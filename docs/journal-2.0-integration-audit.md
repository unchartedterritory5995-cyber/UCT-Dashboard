# Journal 2.0 — Phase 0 Integration Audit

**Date:** 2026-04-17
**Spec:** [docs/plans/journal-2.0-spec.md](plans/journal-2.0-spec.md)
**Branch target:** `feat/journal-2-0`
**Scope tier confirmed:** Must + Should + Could, all promoted to **required** for this build (per user decision 2026-04-17). Nothing is deferred. Won't-tier remains locked (no modification of existing Journal).

This audit establishes the off-limits surface area, the precise mount point, the new-code folder layout, and the data-namespace commitment. It is the single reference for "what's old" vs "what's new" during the Journal 2.0 build.

---

## 1. Existing Journal — OFF LIMITS (read-only reference)

The following files comprise the existing Journal. They are not to be modified, renamed, deleted, or refactored during this build. The sole permitted edit is the tab-registration change identified in Section 3.

### Frontend — `app/src/pages/journal/`

```
app/src/pages/journal/
├── JournalPage.jsx                         ← mount-point file (1-line edit permitted, see §3)
├── JournalPage.module.css
├── tabs/
│   ├── Analytics.jsx + .module.css
│   ├── CalendarReview.jsx + .module.css
│   ├── DailyNotes.jsx + .module.css
│   ├── Overview.jsx + .module.css
│   ├── Playbooks.jsx + .module.css
│   ├── Portfolio.jsx + .module.css         (existing Portfolio tab — distinct from Journal 2.0's Open Positions)
│   ├── ReviewQueue.jsx + .module.css
│   └── TradeLog.jsx + .module.css
└── components/
    ├── AISummary.jsx + .module.css
    ├── EmotionSelector.jsx + .module.css
    ├── ExecutionsList.jsx + .module.css
    ├── FilterBar.jsx + .module.css
    ├── ImportWizard.jsx + .module.css
    ├── InsightCard.jsx + .module.css
    ├── MistakeSelector.jsx + .module.css
    ├── ProcessScoreCard.jsx + .module.css
    ├── ResourceEditor.jsx + .module.css
    ├── ReviewProgress.jsx + .module.css
    ├── ScreenshotUploader.jsx + .module.css
    ├── StatCard.jsx + .module.css
    ├── TradeDrawer.jsx + .module.css
    └── TradeForm.jsx + .module.css
```

### Backend — `api/`

```
api/routers/journal.py                      ← all existing /api/journal/* endpoints
api/services/journal_ai.py
api/services/journal_analytics.py
api/services/journal_executions.py
api/services/journal_import.py
api/services/journal_insights.py
api/services/journal_screenshots.py
api/services/journal_service.py
api/services/journal_taxonomy.py
```

### Database (SQLite) — `data/auth.db`

Off-limits tables owned by the existing Journal (created/migrated by `api/services/auth_db.py`):

- `journal_entries`
- `trade_executions`
- `journal_screenshots`
- `daily_journals`
- `weekly_reviews`
- `playbooks`
- `journal_resources`
- `trading_accounts`
- `import_sessions`

These tables are **read-only** from Journal 2.0's perspective. No writes. No schema alterations.

---

## 2. Reusable utilities outside the Journal scope

These are available to Journal 2.0 without copying:

| Utility | Path | Use in J2 |
|---|---|---|
| `usePreferences` hook | `app/src/hooks/usePreferences.js` | Per-user UI preference storage (e.g. column picker state — but spec §7.3 mandates `localStorage`, so we use localStorage, not this hook) |
| `useLivePrices` hook | `app/src/hooks/useLivePrices.js` | Live price feed for Open Positions table (spec §7.2 "Current" column, "— if feed stale > 5 min") |
| `AuthContext` + `useAuth` | `app/src/context/AuthContext.jsx` | Current user identity |
| `AuthGuard` | `app/src/components/AuthGuard.jsx` | Route protection (already handled at router level for `/journal`) |
| `StockChart` (lightweight-charts wrapper) | `app/src/components/StockChart*.jsx` | Only needed if Phase 8 (chart right-click, Could-tier) is in scope |
| Backend auth middleware | `api/middleware/auth_middleware.py` (`get_current_user`) | Mandatory on every `/api/j2/*` route |
| Backend engine service | `api/services/engine.py::get_breadth()` | Source for market-context auto-fill (rally day, market phase, breadth score) |

**Section 2.1 rule applies:** do NOT copy-paste from the existing Journal's own components or services. If a behavior overlaps (e.g. stat-card styling), reimplement it inside `journal-2-0/`. The above list is strictly *non-journal* infrastructure.

---

## 3. Mount point — the single permitted edit outside `journal-2-0/`

**File:** [app/src/pages/journal/JournalPage.jsx](../app/src/pages/journal/JournalPage.jsx)

**Current tab registry (lines 19–28):**

```js
const JOURNAL_TABS = [
  { key: 'log', label: 'Trade Log' },
  { key: 'overview', label: 'Overview' },
  { key: 'portfolio', label: 'Positions' },
  { key: 'daily', label: 'Daily Notes' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'analytics', label: 'Analytics' },
  { key: 'playbooks', label: 'Playbooks' },
  { key: 'queue', label: 'Review Queue' },
]
```

**Planned change (user-confirmed: last slot, after "queue"):**

```js
const JOURNAL_TABS = [
  { key: 'log', label: 'Trade Log' },
  { key: 'overview', label: 'Overview' },
  { key: 'portfolio', label: 'Positions' },
  { key: 'daily', label: 'Daily Notes' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'analytics', label: 'Analytics' },
  { key: 'playbooks', label: 'Playbooks' },
  { key: 'queue', label: 'Review Queue' },
  { key: 'j2', label: 'Journal 2.0', beta: true },   // NEW
]
```

**Two additional edits inside the same file (required for the tab to render):**

1. An import line at the top: `const JournalTwoRoot = lazy(() => import('../journal-2-0/JournalTwoRoot'))` (or static import — decision in Phase 1).
2. A render branch in the tab-content switch (current switch at lines 148–191): add `{activeTab === 'j2' && <JournalTwoRoot onOpenTrade={handleOpenTrade} />}`.
3. The tab-button render (lines 121–132) needs one conditional: render a `beta` badge when `tab.beta === true` (can be styled via the new component's CSS, no change to existing `JournalPage.module.css`).

**Total diff to existing Journal code (Phase 10 acceptance target):**
- 1 new array entry
- 1 new `import` line
- 1 new `{activeTab === 'j2' && …}` branch
- 1 conditional badge render

Upper bound: ~6 lines added to `JournalPage.jsx`, zero lines removed, zero other files touched. If at any point the build requires a change outside this scope, Section 0.2 Ambiguity Protocol fires — no silent refactors.

**Visual cue (spec §6):** the "beta" chip adjacent to the tab label. Styling lives in the new component's CSS, not the existing `JournalPage.module.css`, to honor the "no modifications to existing Journal" rule.

**Routing:** existing Journal uses local state + `usePreferences` persistence (no URL change on tab switch). Journal 2.0 mirrors this pattern — no URL param, no nested route. (The spec Could-tier item "URL-state persistence of filters" is deferred to Phase 6 / Could.)

---

## 4. New code — folder structure

All Journal 2.0 code is isolated under clearly-named `journal-2-0/` folders. No code lives alongside the existing Journal.

### 4.1 Frontend — `app/src/pages/journal-2-0/`

```
app/src/pages/journal-2-0/
├── JournalTwoRoot.jsx              ← top-level component rendered from JournalPage.jsx
├── JournalTwoRoot.module.css
├── tabs/
│   ├── OpenPositionsTab.jsx + .module.css     (spec §7)
│   └── TradeJournalTab.jsx + .module.css      (spec §11)
├── components/
│   ├── PortfolioSettingsModal.jsx + .module.css   (spec §5)
│   ├── AddPositionModal.jsx + .module.css         (spec §8)
│   ├── EditPositionModal.jsx + .module.css        (spec §9)
│   ├── ClosePositionModal.jsx + .module.css       (spec §10)
│   ├── AddTradeModal.jsx + .module.css            (spec §11.4 "+ Add Trade")
│   ├── ImportCsvModal.jsx + .module.css           (spec §13)
│   ├── FiltersPanel.jsx + .module.css             (spec §12)
│   ├── ColumnsPicker.jsx + .module.css            (spec §7.3, §11.3)
│   ├── StatCard.jsx + .module.css                 (distinct from existing Journal's StatCard)
│   ├── PositionsTable.jsx + .module.css
│   ├── TradesTable.jsx + .module.css
│   └── BetaBadge.jsx + .module.css                (for the "beta" chip on the tab)
└── hooks/
    ├── useJ2Settings.js
    ├── useJ2Positions.js
    ├── useJ2Trades.js
    ├── useJ2MarketContext.js                     (fetches from /api/j2/market-context)
    └── useJ2ColumnPrefs.js
```

### 4.2 Frontend — `app/src/lib/journal-2-0/`

Calculation and formatting helpers (spec §14, §14.8):

```
app/src/lib/journal-2-0/
├── calculations.js                 (spec §14 — every formula, fully tested)
├── calculations.test.js            (Vitest, incl. YSS reference §14.7)
├── format.js                       (spec §14.8 money/percent/date formatters)
├── format.test.js
├── types.js                        (JSDoc typedefs for PortfolioSettings, Position, Trade, MarketContextSnapshot — spec §4)
└── index.js                        (re-exports)
```

JSDoc-flavored JS per user decision A1. Example:

```js
/**
 * @typedef {Object} Position
 * @property {string} id
 * @property {string|null} userId
 * @property {string} symbol
 * @property {'Long'|'Short'} side
 * @property {string} entryDate
 * @property {number} shares
 * @property {number} originalShares
 * @property {number} entryPrice
 * @property {number} stopPrice
 * @property {number|null} breakevenStop
 * @property {boolean} raiseToBreakeven
 * @property {string|null} setup
 * @property {string|null} notes
 * @property {MarketContextSnapshot} contextAtEntry
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {string|null} closedAt
 */
```

### 4.3 Backend — `api/routers/journal_two.py` + `api/services/journal_two/`

New router plus a small service folder:

```
api/routers/journal_two.py          ← all /api/j2/* endpoints, auth-guarded
api/services/journal_two/
├── __init__.py
├── db.py                           ← j2_ table creation, migration helpers
├── settings.py                     ← CRUD for j2_settings
├── positions.py                    ← CRUD + active-stop computation
├── trades.py                       ← CRUD + stats aggregation
├── csv_import.py                   ← pre-matched + (Could) broker adapters
├── market_context.py               ← pulls from engine.get_breadth() + morning-wire state
└── calculations.py                 ← Python mirror of lib/journal-2-0/calculations.js for import/migrations; both must agree on YSS verification
```

Route prefix: all endpoints under `/api/j2/*` (never `/api/journal/*` — that namespace is owned by existing Journal).

Proposed endpoints (final schema locked in Phase 1):
- `GET /api/j2/settings` / `PUT /api/j2/settings`
- `GET /api/j2/positions` / `POST /api/j2/positions` / `PUT /api/j2/positions/{id}` / `DELETE /api/j2/positions/{id}`
- `POST /api/j2/positions/{id}/close` → creates a Trade + decrements/archives position
- `GET /api/j2/trades` (with filter query params per spec §12) / `POST /api/j2/trades` (manual add) / `DELETE /api/j2/trades` (delete-all, double-confirmed with body `{ "confirm": "DELETE" }`)
- `POST /api/j2/trades/import` (CSV import)
- `GET /api/j2/market-context` (snapshot of current rally day, power trend, breadth)

All routes depend on `get_current_user` from existing auth middleware (user A4 confirmation).

### 4.4 Tests — co-located

Vitest for frontend: every `calculations.js` function has a test. Every modal has at least a mount-smoke test per Section 0.6.
Pytest for backend: already present (`tests/` dir at repo root if exists, else under `api/tests/`). `journal_two` gets its own test file.

---

## 5. Database — `j2_` prefix commitment

All Journal 2.0 tables use the `j2_` prefix. SQLite has no schemas, so the prefix is the namespace. Initial schema (finalized in Phase 1):

```sql
-- Single settings row per user
CREATE TABLE IF NOT EXISTS j2_settings (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    data         TEXT NOT NULL,   -- JSON blob of PortfolioSettings minus id/userId/timestamps
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    UNIQUE(user_id)
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
    context_at_entry    TEXT NOT NULL,   -- JSON MarketContextSnapshot
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    closed_at           TEXT
);
CREATE INDEX IF NOT EXISTS idx_j2_positions_user ON j2_positions(user_id);
CREATE INDEX IF NOT EXISTS idx_j2_positions_user_open ON j2_positions(user_id, closed_at);

CREATE TABLE IF NOT EXISTS j2_trades (
    id                  TEXT PRIMARY KEY,
    user_id             TEXT NOT NULL,
    position_id         TEXT NOT NULL,
    symbol              TEXT NOT NULL,
    side                TEXT NOT NULL,
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
    context_at_entry    TEXT NOT NULL,   -- JSON MarketContextSnapshot
    created_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_j2_trades_user ON j2_trades(user_id);
CREATE INDEX IF NOT EXISTS idx_j2_trades_user_entry ON j2_trades(user_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_j2_trades_user_result ON j2_trades(user_id, result);
```

**Zero overlap** with existing Journal tables. Zero foreign keys to existing Journal. Zero writes to existing Journal tables. Migration added to `auth_db.py`'s startup-migration loop as an additive block (the *only* file outside `journal-2-0/` and `journal_two/` touched by the build besides `JournalPage.jsx`; flagged explicitly here as a known, minimal edit).

**On `auth_db.py` edit:** the existing `auth_db.py` is the system-wide migration bootstrap — it's not owned by the existing Journal per se (it also migrates auth tables, watchlists, etc.). Adding a `j2_*` migration block there is structurally the same as the existing pattern. If the user prefers a cleaner separation (a dedicated `journal_two/migrations.py` invoked from `auth_db.py`), that's equivalent and lower-coupling.

---

## 6. Browser-side storage commitments

Spec §7.3 mandates `localStorage` for column visibility/order. Namespaced keys:

- `uct.j2.openPositions.columns` → column config for Open Positions table
- `uct.j2.tradeJournal.columns` → column config for Trade Journal table
- `uct.j2.filters.trades` → (Could-tier, Phase 6) URL/local persistence of filter state

No overlap with any existing `uct.*` keys.

---

## 7. Dependencies to add (per user decisions A2 + Could-promotion)

Additive dev-time requests, flagged here per Section 0.4:

- **`@tanstack/react-virtual`** — table virtualization (spec §15.5 target: ≥ 200 rows)
- **`@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities`** — drag-to-reorder in columns picker (spec §7.3) and drag-reorder in CSV column-mapping wizard (§13.2 now Must)
- **`react-hotkeys-hook`** — keyboard-shortcut registry (§9 Polish, now Must). Small (~2 KB gz), declarative, keyboard-only-nav compatible.
- **`papaparse`** — robust RFC-4180 CSV parser, required for the broker auto-detect adapters (Schwab quoted multi-line cells, IBKR header variants, E*Trade mixed-encoding quirks). Lazy-loaded per §15.5. A hand-written parser would be feasible for pre-matched format only but not for production-quality broker adapters.

All five are lightweight, actively maintained, and have keyboard-accessible defaults (spec §15.75 requirement).

**No new dep for URL-state persistence** — `react-router-dom` 7.13 is already in the repo and its `useSearchParams` covers the filter-state serialization.

**No new dep for chart right-click** — the existing `StockChart` component is a `lightweight-charts` wrapper. Context-menu integration is a `contextmenu` event handler on the chart container (native DOM), routed through a small `ChartContextMenu` component inside `journal-2-0/components/`. If the existing chart wrapper needs a *non-trivial* prop extension to support this, Section 0.2 Ambiguity Protocol fires in Phase 8 before editing `StockChart`. Expected outcome: zero edits to existing chart code; event handling added in a wrapper.

---

## 8. Market-context data source (per user decision A3)

Auto-fill source path for `MarketContextSnapshot`:

- **`rallyDay`** → `morning_wire_state.json::rally_day_count` (integer, rendered as `"D7"` at capture time). Exposed through a new `GET /api/j2/market-context` endpoint backed by `api/services/journal_two/market_context.py`, which reads via `api/services/engine.py::get_breadth()` and the state file.
- **`powerTrend`** → derived from state: `"On"` if `market_phase == "Confirmed Uptrend"` and `distribution_days_spy` count ≤ 5 (preliminary rule — final rule TBD in Phase 1 with user). Flag `null` if state is stale.
- **`breadthValue`** → `engine.get_breadth()::breadth_score` (numeric); `breadthMetricName` snapshot comes from `settings.journalColumns.breadthMetric`.
- **`navCount`** → computed server-side at position-creation time as `COUNT(*) WHERE user_id=? AND closed_at IS NULL`, evaluated *before* the insert.
- **`igRank`**, **`rsRating`** → manual entry in Add Position modal (user decision A3).
- **`indexName`** → snapshot of `settings.journalColumns.marketNavIndex` at capture.

A known follow-up in Phase 1: if the `powerTrend` derivation rule above doesn't match the user's intended definition, this is a Phase-1 ambiguity to be resolved with concrete rule text.

---

## 9. Scope-tier summary (confirmed — all Could items promoted to Must)

Per user decision 2026-04-17: **every feature in the spec ships in this build. Nothing deferred.**

### Must (formerly M + S + C)

- Settings modal (§5) — account size, default stop modes, FIFO/LIFO, BE range, setups, journal columns
- Open Positions tab (§7) — top stats, table, columns picker with drag-reorder, tooltips
- Add / Edit / Close / Delete position flows (§§8–10), **including chart right-click entry per §8.2**
- Trade Journal tab (§11) — 12 stat cards, table, columns picker, `+ Add Trade`, `Delete All` double-confirm
- Journal entries auto-written on close (§10)
- Calculations module (§14) with YSS verification tests (§14.7)
- Raise-to-breakeven toggle with original-stop preservation for R-multiples (§9)
- **Filters panel (§12) with live stat recomputation AND URL-state persistence via `useSearchParams`** (previously S + C; now Must)
- **CSV Import (§13) with: pre-matched parser + Schwab auto-detect + IBKR auto-detect + E*Trade auto-detect + interactive column-mapping wizard for unknown formats** (previously S + C; now Must)
- Market context snapshot (§4 `MarketContextSnapshot`) auto-filled from morning-wire per §8 above
- **Chart right-click → "Add to Portfolio" integration (§8.2)** (previously C; now Must) — uses existing `StockChart` component without modification; integration is event-layer only
- **Keyboard shortcuts (§16 Phase 9)** via `react-hotkeys-hook` (previously C; now Must) — scoped shortcut table finalized in Phase 9 plan

### Won't — still locked

- No modification to existing Journal code/data/routes/UI
- No cherry-picking/merging between Journals during this build (that's a separate task after ship)
- No multi-user sharing; no realtime co-edit; no mobile-native polish; no tax-lot accounting beyond FIFO/LIFO; no broker API sync; no embedded charts in Journal rows

### Impact on Phase plan

- **Phase 7 (CSV Import)** expands from "pre-matched only" to include three broker auto-detectors + a column-mapping wizard. Effort shifts from S to M. `papaparse` dep added.
- **Phase 8 (Chart integration)** is no longer conditional. It executes unconditionally. Skip-clause removed.
- **Phase 9 (Polish)** explicitly includes keyboard-shortcut registration, a shortcut cheat-sheet modal (`?` hotkey), and focus management tests.
- **Phase 6 (Filters)** now requires `useSearchParams` integration; on filter change, the URL query string updates; on page load, URL query string is the source of truth for initial filter state. Back/forward browser buttons must restore prior filter state.

---

## 10. Verification that existing Journal remains unchanged

At the end of every phase, and specifically at Phase 10 acceptance (spec §17):

1. `git diff origin/master -- app/src/pages/journal/ api/routers/journal.py api/services/journal_*.py` should show **only** the 3–6 line edit in `JournalPage.jsx`.
2. Manual smoke: navigate to `/journal`, click through all 8 original tabs, confirm each loads and functions as it did before the build started.
3. All existing `journal_*` database tables are untouched (`sqlite3 data/auth.db ".schema journal_entries"` matches pre-build schema).

---

## Open items for Phase 1 (not blockers for Phase 0 approval)

- `powerTrend` derivation rule — confirm with user before wiring.
- BE-trade consecutive-streak rule (§14.6 already specifies "skip BE" — just needs a test case with a BE trade in the middle of a streak).
- Whether column picker uses static import or lazy import for `@dnd-kit` (affects TTI; spec §15.5 says lazy-load CSV parsers but is silent on drag-kit).

## Open items for Phase 8 (Chart right-click, now Must)

- Exact `StockChart` extension point. The existing wrapper may already dispatch a `contextmenu` event at the bar level, or it may swallow it. Phase 8 starts with a 5-minute read of the current chart wrapper — if it already exposes a usable event (e.g. `onBarContextMenu`), zero edits to existing code. If it swallows the event, Section 0.2 ambiguity fires before touching it.
- Which chart instances across the dashboard get the right-click? Spec §8.2 says "Context menu on any bar" — implying wherever charts render. Proposal: scope to the chart inside Journal 2.0's own modals/drawers only, so no cross-page coupling. User confirmation needed in Phase 8.

## Open items for Phase 9 (Keyboard shortcuts, now Must)

- Proposed shortcut table (finalize before Phase 9 implementation):
  - `a` — open Add Position modal (when on Open Positions tab)
  - `t` — open Add Trade modal (when on Trade Journal tab)
  - `f` — toggle Filters panel
  - `c` — open Columns picker
  - `/` — focus global search/filter symbol input
  - `g then p` → Open Positions tab; `g then j` → Trade Journal tab
  - `Esc` — close any open modal/panel
  - `?` — show shortcut cheat-sheet modal
- Conflicts with the existing dashboard's global shortcuts (if any) are enumerated in Phase 9 plan before implementation.

---

**Phase 0 gate (spec §16 Phase 0 closing):** user approves (a) this audit, (b) the mount-point and folder structure, (c) the `j2_` data namespace, (d) the scope tier (Must + Should, Could per-phase).
