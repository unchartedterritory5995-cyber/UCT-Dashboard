# Journal 2.0 — Architecture Overview

**Status:** Shipped as a side-by-side additive build inside the existing Journal page, per spec §2 and the [Phase 0 integration audit](journal-2.0-integration-audit.md). The existing Journal is untouched and fully functional; users toggle between the two via the last tab (`Journal 2.0 beta`) in `/journal`.

**Spec of record:** [plans/journal-2.0-spec.md](plans/journal-2.0-spec.md)

---

## Top-level layout

```
app/src/pages/journal-2-0/
├── JournalTwoRoot.jsx        — root shell: header + nested tabs + global shortcuts + modals
├── JournalTwoRoot.module.css
├── tabs/
│   ├── OpenPositionsTab.jsx  — live positions + stats bar + CRUD + chart action
│   └── TradeJournalTab.jsx   — 12 stat cards + filterable/sortable table + add/import/delete
├── components/
│   ├── PortfolioSettingsModal.jsx    — 6 sections (Account, Stop, Closing, BE, Setups, Columns)
│   ├── AddPositionModal.jsx          — manual add + chart-prefill variant
│   ├── EditPositionModal.jsx         — raise-to-BE toggle with original-stop preservation
│   ├── ClosePositionModal.jsx        — partial/full close with live P&L/R preview
│   ├── AddTradeModal.jsx             — manual Add Trade + collapsible historical context (A2)
│   ├── DeleteAllModal.jsx            — type-DELETE-to-confirm nuke
│   ├── ConfirmModal.jsx              — generic destructive confirm
│   ├── ImportCsvModal.jsx            — three-step flow (drop/map/preview)
│   ├── CsvColumnMapper.jsx           — unknown-format column mapping wizard
│   ├── FiltersPanel.jsx              — 9-section filter panel w/ URL-state
│   ├── ColumnsPicker.jsx             — drag-reorder column visibility/order
│   ├── StatsGrid.jsx                 — 12-card summary (§11.1)
│   ├── PositionsTable.jsx            — 16-column live positions table
│   ├── TradesTable.jsx               — 18-column (+1 hidden) trade journal table
│   ├── J2Chart.jsx                   — lightweight-charts wrapper (contextmenu-aware)
│   ├── ChartContextMenu.jsx          — right-click menu (Reset / Add / Settings)
│   ├── ChartModal.jsx                — pairs J2Chart + ChartContextMenu
│   ├── ShortcutCheatSheet.jsx        — ? key modal
│   ├── Toast.jsx                     — single-in-flight toast
│   ├── BetaBadge.jsx                 — tab-label chip
│   └── ModalShell.module.css         — shared modal chrome
├── hooks/
│   ├── useJ2Settings.js              — SWR settings + mutation
│   ├── useJ2Positions.js             — SWR positions list (15s refresh)
│   ├── useJ2Trades.js                — SWR trades list
│   ├── useJ2Filters.js               — filter state + URL-state persistence
│   └── useJ2ColumnPrefs.js           — localStorage-backed column order + hidden set
└── lib/
    └── csvTemplates.js               — client-side template generators

app/src/lib/journal-2-0/
├── calculations.js              — pure math (spec §14), long/short separate
├── calculations.test.js         — 75 tests incl. §14.7 YSS verification
├── format.js                    — display helpers (money, percent, rMultiple, dates)
├── format.test.js               — 42 tests
├── types.js                     — JSDoc typedefs for PortfolioSettings, Position, Trade, MarketContextSnapshot
└── index.js                     — barrel export

api/
├── routers/journal_two.py       — all /api/j2/* routes
└── services/journal_two/
    ├── db.py                    — j2_* schema + ensure_schema() (migration helper)
    ├── settings.py              — settings CRUD + validation
    ├── positions.py             — position CRUD + validation
    ├── trades.py                — close_position, create_trade_manual, bulk_insert_trades, deletes
    ├── market_context.py        — snapshot builder (pulls from engine.get_breadth)
    ├── csv_import.py            — sanitize, decode, format detect, pre-matched + broker adapters, mapping
    ├── fifo.py                  — FIFO reconstruction of broker fills into round-trip Trades
    └── calculations.py          — Python mirror of JS calc (close-time derivation)
```

## Data layer

Three tables, all `j2_` prefixed, created by [db.py::ensure_schema](../api/services/journal_two/db.py) and called from the existing `auth_db.init_db()` bootstrap:

### `j2_settings`

One row per user. The settings payload is stored as a JSON blob in the `data` column for cheap schema evolution.

### `j2_positions`

```
id, user_id, symbol, side (Long/Short), entry_date, shares, original_shares,
entry_price, stop_price, breakeven_stop, raise_to_breakeven,
setup, notes, context_at_entry (JSON), created_at, updated_at, closed_at
```

**Invariant (spec §9, §18):** `stop_price` is the ORIGINAL stop — frozen for R-multiple math. Raise-to-BE toggle only modifies `breakeven_stop` + `raise_to_breakeven`.

### `j2_trades`

```
id, user_id, position_id, symbol, side, shares,
entry_price, entry_date, exit_price, exit_date,
original_stop, setup, notes,
pnl_dollar, pnl_percent, r_multiple, hold_days, result (Win/Loss/BE),
context_at_entry (JSON), created_at
```

**Invariant (spec §10):** `original_stop` always copied from `position.stop_price`, NEVER from `position.breakeven_stop`. This preserves R math even after the user raises the stop mid-trade.

**Sentinel positionId (A1 decision 2026-04-17):** manually-added trades and imported trades get `position_id = "manual-{uuid}"` so the field stays non-null per schema while being visually distinguishable from real Position UUIDs.

### Tables the existing Journal owns (off-limits — never touched by Journal 2.0)

`journal_entries`, `trade_executions`, `journal_screenshots`, `daily_journals`, `weekly_reviews`, `playbooks`, `journal_resources`, `trading_accounts`, `import_sessions`.

## HTTP surface

All routes under `/api/j2/*`. Every route depends on the existing `get_current_user` middleware — multi-user isolation is enforced at the query layer.

```
GET    /api/j2/settings                   — read + auto-seed defaults
PUT    /api/j2/settings                   — validate + upsert

GET    /api/j2/positions                  — list open positions
GET    /api/j2/positions/{id}             — single position (404 on other users')
POST   /api/j2/positions                  — create; server builds context snapshot
PUT    /api/j2/positions/{id}             — partial update; stopPrice-preserving invariant
DELETE /api/j2/positions/{id}             — hard delete (trades retain position_id)
POST   /api/j2/positions/{id}/close       — atomic: Trade insert + Position decrement/archive

GET    /api/j2/market-context             — build a fresh snapshot for the Add Position modal

GET    /api/j2/trades                     — list all trades (newest-first)
POST   /api/j2/trades                     — manual Add Trade
DELETE /api/j2/trades/{id}                — hard-delete one trade
DELETE /api/j2/trades                     — nuke all (requires `{"confirm": "DELETE"}` body)
POST   /api/j2/trades/import/preview      — multipart file → {format, trades, errors, warnings}
POST   /api/j2/trades/import/preview-mapped — multipart + JSON mapping for unknown formats
POST   /api/j2/trades/import/confirm      — accepts parsed trades, bulk-inserts in a transaction
```

## Calculation ownership

**JS** ([lib/journal-2-0/calculations.js](../app/src/lib/journal-2-0/calculations.js)) — all live UI math: P&L, stop distance, risk, heat, B/E sell shares, portfolio aggregates, summary stats. 75 tests anchor §14.7 YSS reference.

**Python** ([api/services/journal_two/calculations.py](../api/services/journal_two/calculations.py)) — narrow close-time mirror: `compute_trade_derived` computes `pnl_dollar`, `pnl_percent`, `r_multiple`, `hold_days`, `result`. Used by `close_position`, `create_trade_manual`, `bulk_insert_trades`. 18 tests assert parity with JS on §14.7.

## Namespacing

- DB tables: `j2_` prefix
- URL-state filter params: `?from=...&to=...&sym=...&sides=...&setups=...&nav=...&pt=...&rd=...`
- localStorage keys: `uct.j2.openPositions.columns`, `uct.j2.tradeJournal.columns`
- Storage commitment: zero overlap with existing Journal's `uct.*` keys

## Derivation deferrals (per user direction)

- **`powerTrend`** — [market_context.py](../api/services/journal_two/market_context.py) returns `null` with an inline TODO per user direction 2026-04-17. The rule hasn't been defined; the feature surface still works (filters exclude trades with null powerTrend when the filter is set; the table cell renders `—`).

## Dependencies added for this build

All scoped to Journal 2.0; no existing code depends on them.

- `@tanstack/react-virtual` ^3.13.24 — table virtualization hook (not yet used at current trade volumes; reserved for when needed per §15.5)
- `@dnd-kit/core` ^6.3.1 + `@dnd-kit/sortable` ^10.0.0 + `@dnd-kit/utilities` ^3.2.2 — drag-reorder in Columns picker and the CSV mapping wizard
- `react-hotkeys-hook` ^5.2.4 — keyboard shortcuts (skips input/textarea/contenteditable by default)
- `papaparse` ^5.5.3 — installed for future complex CSV edge cases; current parser uses native `csv` module only

## Test coverage

Total at ship: **~470 tests** (Python + JS).

- `lib/journal-2-0/calculations.test.js` — 75 (spec §14 + §14.7 YSS reference)
- `lib/journal-2-0/format.test.js` — 42 (§14.8 display rules)
- `pages/journal-2-0/**/*.test.jsx` — smoke tests for every modal + table + hook
- `pages/journal-2-0/hooks/useJ2Filters.test.js` — 44 (§12 semantics + URL round-trip + perf anchor)
- `pages/journal-2-0/hooks/useJ2ColumnPrefs.test.js` — 12 (incl. hiddenByDefault seeding)
- `api/services/journal_two/test_*.py` — every write path, user isolation, validation rejections, FIFO edge cases, transaction rollback
- `test_csv_import.py` — 64 (sanitization, every §15.9 injection vector, every format detect, FIFO edge cases, bulk insert)
