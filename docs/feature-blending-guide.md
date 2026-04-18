# Journal 2.0 — Feature Blending Guide

**Purpose:** this document is the cherry-picking reference for merging Journal 2.0 features into the existing Journal. It exists because Journal 2.0 was built as an **additive side-by-side rebuild**, not a replacement. The two Journals run in parallel today — user toggles between them via the tab bar inside `/journal`.

**How to use it:** pick a row. Read the "merge-back note." Decide whether to port the feature across.

**Key paths:**
- Journal 2.0 frontend — [app/src/pages/journal-2-0/](../app/src/pages/journal-2-0/)
- Journal 2.0 backend — [api/services/journal_two/](../api/services/journal_two/), [api/routers/journal_two.py](../api/routers/journal_two.py)
- Journal 2.0 tables — `j2_settings`, `j2_positions`, `j2_trades` (prefix-namespaced, zero overlap with existing `journal_entries` etc.)
- Existing Journal (off-limits during build) — [app/src/pages/journal/](../app/src/pages/journal/), [api/routers/journal.py](../api/routers/journal.py)

**Effort legend:** S = < 1 day, M = 1–3 days, L = 3+ days.

**Compatibility legend:**
- **drop-in** — copy the file(s), no schema or contract changes.
- **needs adapter** — code is reusable but the existing Journal's data shape is different; write a small translator.
- **conflicts — requires design decision** — the existing Journal already has a different take on this concept. You'll need to pick which wins or blend semantics.

---

## 1. Portfolio Settings (account size, default stop, FIFO/LIFO, BE range, setups)

**What it is:** a single settings row per user covering `accountSize`, `defaultStop` (4 modes), `positionClosing`, `breakevenRange`, `setups`, `journalColumns` — all surfaced through a dedicated modal reachable from the ⚙ Settings $X pill.

**Lives in:**
- Frontend — [components/PortfolioSettingsModal.jsx](../app/src/pages/journal-2-0/components/PortfolioSettingsModal.jsx), [hooks/useJ2Settings.js](../app/src/pages/journal-2-0/hooks/useJ2Settings.js)
- Backend — [api/services/journal_two/settings.py](../api/services/journal_two/settings.py), routes `/api/j2/settings` in [journal_two.py](../api/routers/journal_two.py)
- DB — `j2_settings` table

**Merge-back note:** the existing Journal currently has no user-facing settings UI at all — settings like account size live implicitly via `trading_accounts`. Porting this gives the existing Journal first-class portfolio-level settings. You'll want to either (a) point the existing Journal's calls at the `j2_settings` table and delete the per-trade computed fields that currently rely on `trading_accounts.balance`, or (b) duplicate the table under `journal_settings` and thread a translator. **Effort:** M. **Compat:** needs adapter. **Risk note:** the BE range `enabled` invariant (value != 0 → enabled=true) is enforced server-side in `settings.py::validate_settings_payload` — must carry this rule with it.

---

## 2. Open Positions live risk/heat table (16 columns)

**What it is:** the table in Journal 2.0's Open Positions tab. Every row live-computes P&L, stop distance, risk $, heat $, % of account, B/E sell shares, etc. Stats header at top aggregates across all rows using live prices.

**Lives in:**
- Frontend — [tabs/OpenPositionsTab.jsx](../app/src/pages/journal-2-0/tabs/OpenPositionsTab.jsx), [components/PositionsTable.jsx](../app/src/pages/journal-2-0/components/PositionsTable.jsx), [lib/journal-2-0/calculations.js](../app/src/lib/journal-2-0/calculations.js)
- Backend — [api/services/journal_two/positions.py](../api/services/journal_two/positions.py)

**Merge-back note:** the existing Journal's Positions tab (`app/src/pages/journal/tabs/Portfolio.jsx`) shows open positions but doesn't have the full 16-column math. The blockable piece is the **calculations module** — `calculations.js` is a pure, fully-tested JS module you can import directly into any React tree. To get the 16-column table in the existing Journal, either (a) mount `PositionsTable` as-is inside `Portfolio.jsx` and feed it the existing data shape via a shape adapter (`journal_entries` → Position shape), or (b) rewrite `Portfolio.jsx` against the same shape. **Effort:** M for (a), L for (b). **Compat:** needs adapter — existing `journal_entries.direction/entry_price/etc.` don't match the `Position` shape exactly.

---

## 3. Raise-to-breakeven toggle with original-stop preservation

**What it is:** the Edit Position modal's checkbox that changes **live** risk/heat math to use a new `breakevenStop` while keeping the **original** `stopPrice` frozen for journal R-multiple calculations. Critical invariant: toggling raise-to-BE never modifies `stopPrice`.

**Lives in:**
- Frontend — [components/EditPositionModal.jsx](../app/src/pages/journal-2-0/components/EditPositionModal.jsx) (the `touched` ref pattern)
- Backend — [api/services/journal_two/positions.py](../app/src/pages/journal-2-0/positions.py) `update_position` (server-side enforcement)
- Close-time enforcement — [api/services/journal_two/trades.py](../app/src/pages/journal-2-0/trades.py) `close_position`: always copies `originalStop` from `position.stopPrice`, never from `breakevenStop`.

**Merge-back note:** existing Journal has no equivalent. Straightforward to port — lift the EditPositionModal's touched-fields pattern and the server-side invariant into the existing Journal's update path. **Effort:** S. **Compat:** drop-in for the toggle UI; the existing Journal needs a `breakeven_stop` + `raise_to_breakeven` migration on `journal_entries` (or new columns). The invariant itself (R uses original stop, not BE stop) is the most important thing — an `originalStop` column on trades already exists in j2; would need adding to existing Journal.

---

## 4. Close flow → atomic Trade + Position decrement

**What it is:** a single `POST /api/j2/positions/{id}/close` endpoint runs a SQLite transaction that writes a new Trade row (with derived pnl/r/hold/result computed server-side) AND decrements the Position's shares AND archives the Position via `closed_at` when shares reach 0. All-or-nothing.

**Lives in:**
- Backend — [api/services/journal_two/trades.py](../api/services/journal_two/trades.py) `close_position`

**Merge-back note:** existing Journal writes trades and positions separately; there's no transactional close flow. Porting would give the existing Journal the same atomicity guarantee. **Effort:** M. **Compat:** needs adapter — the existing Journal's shape for trades (`journal_entries.status = 'closed'`) differs from a separate `j2_trades` table. Two viable strategies: (a) keep using `journal_entries` but add transactional close logic; (b) migrate existing Journal to split positions vs trades.

---

## 5. Top stats grid with Profit Factor ∞ edge case

**What it is:** 6×2 grid of 12 summary stats computed entirely client-side from the trades array. Handles Profit Factor `∞` (all wins, no losses) and `0` (no wins) correctly; BE trades excluded from Win Rate / Avg Win / Avg Loss; BE trades do NOT break Win/Loss streaks.

**Lives in:**
- Frontend — [components/StatsGrid.jsx](../app/src/pages/journal-2-0/components/StatsGrid.jsx), [lib/journal-2-0/calculations.js](../app/src/lib/journal-2-0/calculations.js) (`summaryStats()`)

**Merge-back note:** drop-in. `summaryStats(trades)` is pure — pass whatever your existing Journal's trade array is. Only thing to check: the input must have `pnlDollar`, `pnlPercent`, `result` ('Win' | 'Loss' | 'BE'), and `holdDays`. If the existing Journal computes `result` differently, write a small `.map()` to align. **Effort:** S. **Compat:** drop-in.

---

## 6. Filters panel with URL-state persistence

**What it is:** 9-section filter panel with live stat recomputation, AND across sections, OR within groups. Active count badge. URL reflects the filter state so back/forward buttons restore it and URLs are shareable.

**Lives in:**
- Frontend — [components/FiltersPanel.jsx](../app/src/pages/journal-2-0/components/FiltersPanel.jsx), [hooks/useJ2Filters.js](../app/src/pages/journal-2-0/hooks/useJ2Filters.js)

**Merge-back note:** existing Journal has a FilterBar component but lacks URL-state persistence and the 9-section breadth. The `useJ2Filters` hook is self-contained (just needs `useSearchParams` from React Router 7, which the existing Journal already uses via the shared router). Plug-and-play if your existing Journal's trade shape carries the same `contextAtEntry` fields — otherwise adapter. **Effort:** M. **Compat:** needs adapter — existing Journal's trades don't carry a structured `contextAtEntry` block.

---

## 7. CSV Import with broker auto-detect + column-mapping wizard

**What it is:** dropzone → format auto-detect (Schwab, IBKR, E*Trade, pre-matched) → FIFO reconstruction for broker fills → preview → confirm. For unknown formats, a column-mapping wizard with header-name auto-guessing. Formula-injection sanitization on every cell (spec §15.9).

**Lives in:**
- Frontend — [components/ImportCsvModal.jsx](../app/src/pages/journal-2-0/components/ImportCsvModal.jsx), [components/CsvColumnMapper.jsx](../app/src/pages/journal-2-0/components/CsvColumnMapper.jsx), [lib/csvTemplates.js](../app/src/pages/journal-2-0/lib/csvTemplates.js)
- Backend — [api/services/journal_two/csv_import.py](../api/services/journal_two/csv_import.py), [api/services/journal_two/fifo.py](../api/services/journal_two/fifo.py)

**Merge-back note:** existing Journal has `components/ImportWizard.jsx` + `api/services/journal_import.py` already. Porting the new features means swapping those out rather than adding. FIFO reconstruction is the biggest win — existing Journal's importer is spec-matched format only. **Effort:** L. **Compat:** conflicts — requires design decision. The existing Journal has a different importer architecture; cherry-pick the sanitization + broker adapters + FIFO module as drop-ins, but the modal and the route contracts are a design call.

---

## 8. Manual Add Trade with collapsible Historical Market Context

**What it is:** the Add Trade modal lets users record a historical trade that didn't originate from a closed Position. Under a collapsible "Historical Market Context (optional)" section, power users can backfill `navCount`, `rallyDay`, `powerTrend`, `breadthValue`, `igRank`, `rsRating` so the trade participates in filter narrowing. Casual adds skip and get nulls.

**Lives in:**
- Frontend — [components/AddTradeModal.jsx](../app/src/pages/journal-2-0/components/AddTradeModal.jsx) (the `ctxOpen`/`ctxStyles` sub-section)
- Backend — [api/services/journal_two/trades.py](../api/services/journal_two/trades.py) `create_trade_manual`

**Merge-back note:** existing Journal's `TradeForm` already has a lot of fields but doesn't separate "core" vs "historical context." The collapsible UX is the innovation. Drop-in the pattern; needs new columns on `journal_entries` for the context fields, OR repurpose the existing fields (`setup`, `notes`, etc.) with a JSON blob column. **Effort:** S for the UI; M if it requires migrating existing Journal's table. **Compat:** drop-in (UI), needs migration (data).

---

## 9. Chart right-click → Add to Portfolio

**What it is:** click 📈 on a position row → chart opens → right-click any bar → context menu with "+ Add to Portfolio" → opens Add Position modal with Symbol locked + Entry Price + Entry Date pre-filled from the clicked bar. Stop Price auto-computed per `settings.defaultStop` with a source badge.

**Lives in:**
- Frontend — [components/J2Chart.jsx](../app/src/pages/journal-2-0/components/J2Chart.jsx), [components/ChartContextMenu.jsx](../app/src/pages/journal-2-0/components/ChartContextMenu.jsx), [components/ChartModal.jsx](../app/src/pages/journal-2-0/components/ChartModal.jsx)

**Merge-back note:** existing Journal's `TradeDrawer` embeds a chart but uses a different chart component (`StockChart`). Porting the right-click flow to the existing chart means either (a) adding a `contextmenu` handler to the existing `StockChart` wrapper, or (b) replacing that wrapper with `J2Chart`. `ChartContextMenu` itself is a tiny drop-in primitive that's chart-agnostic. **Effort:** M. **Compat:** needs adapter — the existing `StockChart` component would need a new prop or event, or a thin wrapper to handle the right-click.

---

## 10. Keyboard shortcuts + cheat sheet

**What it is:** `a` / `t` / `f` / `c` / `/` / `g>p` / `g>j` / `?` / `Esc`. Discoverable via the `?` button in the root header.

**Lives in:**
- Frontend — the `useHotkeys` calls inside [JournalTwoRoot.jsx](../app/src/pages/journal-2-0/JournalTwoRoot.jsx), [tabs/OpenPositionsTab.jsx](../app/src/pages/journal-2-0/tabs/OpenPositionsTab.jsx), [tabs/TradeJournalTab.jsx](../app/src/pages/journal-2-0/tabs/TradeJournalTab.jsx); [components/ShortcutCheatSheet.jsx](../app/src/pages/journal-2-0/components/ShortcutCheatSheet.jsx)

**Merge-back note:** drop-in. `react-hotkeys-hook` is already a dep, so no new install. Copy the `useHotkeys(...)` calls into the existing Journal's equivalent tabs, update the cheat-sheet lists to match. **Effort:** S. **Compat:** drop-in.

---

## 11. Destructive-action confirm modal

**What it is:** generic `ConfirmModal` component replacing `window.confirm` for Position deletion. DeleteAll uses a stricter type-`DELETE`-to-confirm modal.

**Lives in:**
- Frontend — [components/ConfirmModal.jsx](../app/src/pages/journal-2-0/components/ConfirmModal.jsx), [components/DeleteAllModal.jsx](../app/src/pages/journal-2-0/components/DeleteAllModal.jsx)

**Merge-back note:** drop-in. Both components are dependency-free (only need the shared ModalShell CSS). Useful anywhere the existing Journal still uses `window.confirm` for destructive actions. **Effort:** S. **Compat:** drop-in.

---

## 12. Column picker with drag-to-reorder

**What it is:** `@dnd-kit`-backed sortable column picker with keyboard alternatives (↑ / ↓ buttons), `nonHideable` enforcement, `hiddenByDefault` support, and localStorage persistence.

**Lives in:**
- Frontend — [components/ColumnsPicker.jsx](../app/src/pages/journal-2-0/components/ColumnsPicker.jsx), [hooks/useJ2ColumnPrefs.js](../app/src/pages/journal-2-0/hooks/useJ2ColumnPrefs.js)

**Merge-back note:** existing Journal's tables don't have column customization. Drop-in. You'll define a `defaultColumns` array per table and a unique localStorage key. `@dnd-kit` is already a dep. **Effort:** S. **Compat:** drop-in.

---

## 13. Live-price-aware stats header

**What it is:** the stats bar at the top of Open Positions (Value, Risk $, Heat $, Unrealized $, etc.) that updates every 2s via the existing `useLivePrices` hook. Skips positions with missing prices gracefully.

**Lives in:**
- Frontend — [tabs/OpenPositionsTab.jsx](../app/src/pages/journal-2-0/tabs/OpenPositionsTab.jsx) (the `statGroup` section), [lib/journal-2-0/calculations.js](../app/src/lib/journal-2-0/calculations.js) (`portfolioAggregates`)

**Merge-back note:** the existing Journal's Positions tab has some live-price display but no aggregated-across-portfolio stats bar. Drop-in via `portfolioAggregates()` + the JSX. **Effort:** S. **Compat:** drop-in.

---

## 14. Historical Market Context (auto-fill on Position create)

**What it is:** every new Position captures a `contextAtEntry` snapshot (navCount, rallyDay, powerTrend, breadthValue, indexName, breadthMetricName) at creation time. Frozen; never recomputed. Later filters narrow trades by these snapshots.

**Lives in:**
- Backend — [api/services/journal_two/market_context.py](../api/services/journal_two/market_context.py), [api/services/journal_two/positions.py](../api/services/journal_two/positions.py) (`create_position` calls `build_snapshot` before insert)

**Merge-back note:** existing Journal has no historical-context capture. To port: add a `context_at_entry` JSON column on `journal_entries`, call `build_snapshot` on trade creation, snapshot `market_context.breadthMetric` + `marketNavIndex` from the user's settings at capture time. **Effort:** M. **Compat:** needs adapter — new column + wiring the market-context reader into the existing trade-create path.

---

## 15. `powerTrend` derivation (deferred)

**Note:** per user direction 2026-04-17, `powerTrend` is intentionally left returning `null` from `market_context.build_snapshot`. When the user defines the rule, update [api/services/journal_two/market_context.py](../api/services/journal_two/market_context.py) and the unit test in [test_market_context.py](../api/services/journal_two/test_market_context.py). This is a one-function change.

---

## Historical data migration

Out of scope for this build (spec §16.5). Journal 2.0 starts empty by design — the side-by-side review period is what proves which features are worth blending. If and when you decide to merge historical trades from the existing Journal, write a one-shot script at [scripts/seed-journal-2-0.ts](../scripts/seed-journal-2-0.ts) (not yet created) that **reads** `journal_entries` and **writes** transformed records into `j2_trades`. Never modify the existing Journal tables from that script. Legacy-missing fields (no `originalStop`, no `contextAtEntry`): write `null`; the existing Journal 2.0 code handles those gracefully.

---

## What is NOT in Journal 2.0 (intentionally skipped — spec §2.5 Won't tier)

- Multi-user collaboration / sharing
- Realtime co-editing
- Mobile-native polish (desktop-first; mobile degrades to card lists acceptably)
- Tax-lot accounting beyond FIFO/LIFO
- Broker API live sync
- Charts embedded in Journal rows (only inside modals)

If any of these become priorities, they're new builds on top of Journal 2.0's foundation — not blends from it.
