# UCT Dashboard — "Journal 2.0" Additive Subsection
## Claude Code Project Prompt — v3 (Production-Ready, Non-Destructive)

> **READ THIS FIRST.** This is NOT a replacement of the existing Journal. It is a new sub-tab called **Journal 2.0**, mounted inside the existing Journal page, built entirely alongside the current Journal UI. The current Journal stays fully intact and functional. After Journal 2.0 is built, the user will review both side-by-side and cherry-pick features to merge in a separate pass. Do not modify, refactor, rename, or remove any file that belongs to the existing Journal. Additive only.

---

## TABLE OF CONTENTS

- [0. Operating Rules for Claude Code](#0-operating-rules-for-claude-code)
- [1. Project Context (YOU MUST FILL IN)](#1-project-context-you-must-fill-in)
- [2. Objective](#2-objective)
- [2.5. Scope Tiering (MoSCoW)](#25-scope-tiering-moscow)
- [3. High-Level Feature List](#3-high-level-feature-list)
- [4. Data Model](#4-data-model)
- [5. Settings Modal](#5-settings-modal)
- [6. Journal 2.0 Page Layout](#6-journal-20-page-layout)
- [7. Open Positions Tab](#7-open-positions-tab)
- [8. Add Position Modal](#8-add-position-modal)
- [9. Edit Position Modal](#9-edit-position-modal)
- [10. Close Position Modal](#10-close-position-modal)
- [11. Trade Journal Tab](#11-trade-journal-tab)
- [12. Filters Panel](#12-filters-panel)
- [13. CSV Import Modal](#13-csv-import-modal)
- [14. Calculations — Single Source of Truth](#14-calculations--single-source-of-truth)
- [14.5. Error & Edge Case Catalog](#145-error--edge-case-catalog)
- [15. Styling Notes](#15-styling-notes)
- [15.5. Performance Budget](#155-performance-budget)
- [15.75. Accessibility (WCAG 2.1 AA)](#1575-accessibility-wcag-21-aa)
- [15.9. Security Requirements](#159-security-requirements)
- [16. Implementation Phases](#16-implementation-phases)
- [16.5. Migration Strategy (Optional)](#165-migration-strategy-optional--skip-by-default)
- [17. Acceptance Criteria (Mapped to Phases)](#17-acceptance-criteria-mapped-to-phases)
- [18. Things Not To Do](#18-things-not-to-do)
- [18.5. Response Protocol](#185-response-protocol)
- [19. Deliverables Checklist](#19-deliverables-checklist)
- [20. Strict Mode Addendum (Optional)](#20-strict-mode-addendum-optional)

---

## 0. OPERATING RULES FOR CLAUDE CODE

Read every rule in this section before writing a single line of code. These rules apply to every response you produce in this project.

### 0.1 Reading & planning
- Read this entire document in full before Phase 0.
- Do not begin any phase until the previous phase is explicitly approved by the user (an unambiguous "approved," "go," "next," or "ship it").
- Before each phase, output a plan consisting of: affected files, approach, risks, and test strategy. Wait for approval.

### 0.2 Ambiguity protocol
- If anything is ambiguous, missing, or conflicting **STOP**. Do not guess, do not pick a default, do not "proceed with a reasonable assumption."
- Output an ambiguity notice using this exact template:

  ```
  ⚠ AMBIGUITY — <topic>
  Context: <what you need the info for>
  Options:
    A) <option + tradeoff>
    B) <option + tradeoff>
    C) <option + tradeoff>
  Recommendation: <your pick + one-line reason>
  Waiting for decision.
  ```

- The only exception: fixing a typo in this spec. Flag it in your response but don't stop.

### 0.3 Response format (every response)
Every response must follow this structure:

```
## Phase <N> — <phase name> — <status: PLANNING | IN PROGRESS | BLOCKED | AWAITING REVIEW | COMPLETE>

<body — plan, diffs, test results, questions, etc.>

### Proposed next step
<one or two sentences describing what you will do on the next turn, contingent on approval>
```

### 0.4 Code standards
- **TypeScript strict mode** (`"strict": true`). No `any` without a `// reason: ...` comment. No `@ts-ignore` without a `// reason: ...` comment.
- ESLint and the project's formatter must pass. If they don't exist, set them up in Phase 0.
- No new dependencies without calling them out in your phase plan and getting approval.
- Use the project's existing conventions (naming, folder layout) when extending; only restructure with approval.

### 0.5 Git workflow
- Work on a branch named `feat/journal-revamp`.
- One logical change per commit. Conventional Commits format:
  - `feat(journal): add positions table with live risk calc`
  - `fix(journal): correct BE sell rounding to round() not ceil()`
  - `test(calc): add verification suite for YSS reference position`
  - `chore(build): enable TS strict mode`
- No force-pushes to the branch after the first shared review.
- Do not merge to main without explicit approval.

### 0.6 Testing discipline
- Every function in `lib/portfolio/calculations.ts` has a unit test.
- Every modal and major component has at least a smoke test (mounts without error, primary action fires).
- Before declaring a phase COMPLETE, run the full test suite and paste the summary in your response.
- Verification data in Section 14 must be used as a test case.

### 0.7 When you are uncertain about the codebase
- If a path, framework, or convention from Section 1 doesn't match what you find in the repo → trigger the ambiguity protocol in 0.2. Do not patch the mismatch silently.

### 0.8 Forbidden behaviors
- Silent refactors outside the scope of the phase.
- Copying and renaming old Journal code to look new. If a utility from the old code is reusable, import it explicitly and note the reuse.
- Suppressing lint/type errors instead of fixing them.
- Writing placeholder `TODO` comments without a tracking note in your response.
- Invented dependencies, invented API endpoints, invented fields.
- Silently changing the data model after Phase 1 is approved.

---

## 1. PROJECT CONTEXT (YOU MUST FILL IN)

> Every `[FILL IN: ...]` below is a blocker. If any is left blank when this prompt is handed to Claude Code, Claude Code must trigger the ambiguity protocol and stop.

- **Tech stack:** `[FILL IN: e.g. Next.js 14 App Router + TypeScript + Tailwind + shadcn/ui]`
- **Styling system:** `[FILL IN]`
- **Data layer:** `[FILL IN: e.g. Supabase Postgres with Drizzle ORM]`
- **Auth:** `[FILL IN: e.g. Supabase Auth — single user for now, multi-user later]`
- **Repo root:** `[FILL IN]`
- **Existing Journal location (this stays untouched):** `[FILL IN: path — Claude Code reads this only to understand where to mount the new tab, never modifies it]`
- **Mount point (LOCKED):** New sub-tab labeled **"Journal 2.0"** inside the existing Journal page. Rendered adjacent to whatever tabs currently exist in the Journal page. Selecting the tab swaps the page body to the new module; the user can click back to the original tab at any time to compare.
- **Existing Portfolio location (if any):** `[FILL IN: path OR "N/A — no portfolio section exists yet"]`
- **Existing chart component path:** `[FILL IN: path OR "N/A — skip chart right-click integration"]`
- **Price feed source:** `[FILL IN: e.g. "Polygon REST, 15-min delayed, polled every 30s" OR "user-entered manually on position row" OR "stubbed constant for dev"]`
- **Market breadth / index data source:** `[FILL IN: e.g. "manually entered at add-position time" OR "fetch from [provider]" OR "stub for now — values manually typed in add-position modal"]`
- **Rally Day source:** `[FILL IN: e.g. "manual text field" OR "computed from followthrough-day algorithm" OR "stub"]`
- **Single-user or multi-user:** `[FILL IN]`
- **Target browsers:** `[FILL IN: e.g. "latest 2 Chrome, Safari, Firefox; desktop-first"]`
- **Data namespace / prefix for Journal 2.0:** `j2_` for table/key prefixes (e.g. `j2_positions`, `j2_trades`, `j2_settings`). If your data layer uses schemas, use a `journal_2_0` schema instead.

---

## 2. OBJECTIVE

Add a new sub-tab titled **"Journal 2.0"** inside the existing Journal page of UCT Dashboard. Journal 2.0 contains the complete new implementation described in this spec. The current Journal UI is untouched and remains the default view.

Journal 2.0 itself contains two nested tabs:
- **Tab 1 — Open Positions:** live positions with live risk/heat/P&L math.
- **Tab 2 — Trade Journal:** closed-trade log with performance stats, filters, and market-context columns captured at entry.

Journal 2.0 has its own Settings modal (separate from any settings the existing Journal has), its own data store (separate tables/keys from existing Journal data), and its own routing.

The core rule within Journal 2.0: **closing a position (fully or partially) writes a row to Journal 2.0's Trade Journal automatically.** This mechanic is internal to Journal 2.0 only.

### 2.1 Co-existence rules (non-negotiable)
- The existing Journal page layout, tabs, components, routes, styles, data tables, and settings are **never modified**.
- If a piece of logic from the existing Journal would be useful inside Journal 2.0, **copy it** into the Journal 2.0 folder (`components/journal-2-0/...` or equivalent) — do not import from the existing Journal's codepath and do not refactor the existing code to share it.
- Journal 2.0 uses its own database tables / localStorage keys / Supabase schema (whichever your data layer is) namespaced with a `j2_` prefix or the `journal_2_0` schema.
- At the end of the build, a **Feature Blending Guide** document is produced that lists every feature in Journal 2.0 next to notes on how it could later be merged into the existing Journal. This is the cherry-picking reference the user will use after the build.

---

## 2.5 SCOPE TIERING (MoSCoW)

If budget or time runs short, cut from the bottom of this list. Do not cut from the top without explicit approval.

### Must (M) — MVP. Ship without these and the project fails.
- Settings modal (account size, default stop, FIFO/LIFO, BE range, setups list)
- Open Positions tab: top stats + positions table + columns picker
- Add / Edit / Close / Delete position flows (manual only)
- Trade Journal tab: 12 stat cards + table + columns picker
- Journal entries auto-written on close
- Calculations module with full test coverage
- Raise-to-breakeven toggle with original-stop preservation for R-multiples

### Should (S) — Strongly desired but cuttable.
- Filters panel with live stat recomputation
- CSV Import (pre-matched format only is acceptable as a minimum)
- Market context snapshot (Nav Count, Power Trend, Rally Day, breadth metric)

### Could (C) — Nice to have, explicitly optional.
- Chart right-click → "Add to Portfolio" integration
- Auto-detect CSV formats (Schwab / IBKR / E*Trade)
- Interactive column-mapping wizard for unknown CSVs
- URL-state persistence of filters
- Keyboard shortcuts

### Won't (W) — Not in this iteration. Do not build.
- **Any modification of the existing Journal code, UI, data, or routes.** This is locked; Journal 2.0 is additive only.
- Cherry-picking / blending features between the old Journal and Journal 2.0 (this is a separate task after the build).
- Multi-user collaboration / sharing
- Realtime co-editing
- Mobile-native polish (desktop-first; mobile acceptable-degraded is fine)
- Tax-lot accounting beyond FIFO/LIFO
- Broker API live sync
- Charts embedded in Journal rows

---

## 3. HIGH-LEVEL FEATURE LIST

1. Portfolio Settings modal (account size, default stop logic, FIFO/LIFO, BE range, user-defined setups, journal column defaults)
2. Open Positions table with portfolio-wide stats header
3. Add Position modal — manual entry
4. Add Position modal — chart right-click entry (**Could** tier)
5. Edit Position modal with raise-to-breakeven toggle
6. Close Position modal (full or partial) that writes a Trade
7. Trade Journal table with 12 summary stat cards
8. Columns picker (show/hide + drag-to-reorder) on both tabs
9. Filters panel on Journal with live stat recomputation (**Should**)
10. CSV Import modal (**Should** — pre-matched required; auto-detect is **Could**)
11. "Delete All" and "+ Add Trade" manual controls on Journal

---

## 4. DATA MODEL

Use these interfaces exactly. Adapt names for your DB if needed but preserve shape and semantics.

```ts
// ─── Settings (single row per user) ─────────────────────────────────
export interface PortfolioSettings {
  id: string;
  userId: string | null;                    // null allowed only if single-user
  accountSize: number;
  defaultStop:
    | { mode: 'custom' }
    | { mode: 'bar_low_high'; buffer: number; bufferUnit: '$' | '%' }
    | { mode: 'fixed_dollar_risk'; amount: number }
    | { mode: 'fixed_percent_distance'; percent: number };
  positionClosing: 'FIFO' | 'LIFO';
  breakevenRange: {
    enabled: boolean;                       // false iff value === 0
    unit: '$' | '%';
    value: number;
  };
  setups: string[];
  journalColumns: {
    marketNavIndex: string;
    breadthMetric: string;
  };
  createdAt: string;
  updatedAt: string;
}

// ─── Open Position ──────────────────────────────────────────────────
export interface Position {
  id: string;
  userId: string | null;
  symbol: string;
  side: 'Long' | 'Short';
  entryDate: string;                        // ISO 8601, UTC
  shares: number;                           // CURRENT remaining; supports fractional to 4 dp
  originalShares: number;                   // immutable after creation
  entryPrice: number;                       // weighted-avg if scaled in
  stopPrice: number;                        // ORIGINAL stop; frozen for journal R math
  breakevenStop: number | null;             // live-risk override; null unless raiseToBreakeven
  raiseToBreakeven: boolean;
  setup: string | null;
  notes: string | null;
  contextAtEntry: MarketContextSnapshot;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;                  // set when shares reach 0; position is archived, not deleted
}

// ─── Closed Trade (Journal row) ─────────────────────────────────────
export interface Trade {
  id: string;
  userId: string | null;
  positionId: string;                       // source Position for traceability
  symbol: string;
  side: 'Long' | 'Short';
  shares: number;                           // shares closed in THIS trade record
  entryPrice: number;
  entryDate: string;
  exitPrice: number;
  exitDate: string;
  originalStop: number;                     // copied from Position.stopPrice, not breakevenStop
  setup: string | null;
  notes: string | null;
  // Derived, persisted for filter/query speed; also recomputable
  pnlDollar: number;
  pnlPercent: number;
  rMultiple: number;
  holdDays: number;
  result: 'Win' | 'Loss' | 'BE';            // uses settings.breakevenRange at time of close
  contextAtEntry: MarketContextSnapshot;
  createdAt: string;
}

// ─── Market Context Snapshot ────────────────────────────────────────
export interface MarketContextSnapshot {
  navCount: number;                         // # open positions at moment of position creation (EXCLUDING the new one)
  rallyDay: string | null;                  // e.g. 'D7', null if not captured
  powerTrend: 'On' | 'Off' | null;
  breadthValue: number | null;              // numeric reading
  breadthMetricName: string;                // snapshot of settings.journalColumns.breadthMetric at capture
  indexName: string;                        // snapshot of settings.journalColumns.marketNavIndex at capture
  igRank: number | null;
  rsRating: number | null;
}
```

**Notes:**
- Fractional shares supported to **4 decimal places** in storage; display rounded to 4 but collapse trailing zeros (e.g. `0.5` not `0.5000`).
- All timestamps stored as ISO 8601 in UTC; display in the browser's local timezone.
- `navCount` definition: positions open at the **instant of Position creation, not including the one being created**. Document this in the code.

---

## 5. SETTINGS MODAL — `<PortfolioSettingsModal />`

[Same as v1 — reproduced below for completeness.]

**Trigger:** top-right "⚙ Settings $100,000" pill button on the Portfolio page. The pill always shows current account size.

**Layout:** centered modal, ~500px wide, dark, scrollable body, sticky `Cancel` / `Save Settings` footer.

**Sections (top to bottom):**

### 5.1 ACCOUNT
- Label: `Account Size`
- Input: number with `$` prefix.
- Validation: positive, ≥ 1.

### 5.2 DEFAULT STOP PLACEMENT (radio-card group — select ONE)
Each option is a clickable card with radio-left, title, subtitle. Selected card: blue border + faint glow.

1. **Custom** — "No auto-fill — you enter the stop manually"
2. **Bar Low / High** — "Long: bar's low minus buffer • Short: bar's high plus buffer"
   - Reveals: `Buffer [__] [$ / % dropdown] beyond the low / high`
3. **Fixed $ Risk** — "Stop placed so total risk = the $ amount below"
   - Reveals: amount input
4. **Fixed % Distance** — "Stop placed this % from entry price"
   - Reveals: percent input

### 5.3 POSITION CLOSING (pill toggle)
- `FIFO — First In, First Out` — "Oldest positions are closed first when selling same-symbol shares."
- `LIFO — Last In, First Out` — "Newest positions are closed first when selling same-symbol shares."
- Helper text under toggle switches with selection.
- **Semantic note:** FIFO/LIFO only applies across multiple Position rows for the same symbol. A single scaled-in Position is one row — FIFO/LIFO does not subdivide it.

### 5.4 BREAKEVEN RANGE
- Description: "Trades within this range are counted as **BE** instead of a Win or Loss, and are excluded from Avg Win / Avg Loss stats. Set to 0 to disable."
- Unit toggle: `$ Dollar` / `% Return`
- Value input. `0` → show "disabled" muted. Non-zero → show `trades within ±$20 P&L are BE`.

### 5.5 TRADE SETUPS
- Description: "Define setup types for your trades (e.g. Breakout, Pullback, Gap-up)."
- Text input + `Add` button.
- Chips below with `×` removal.
- Deleting a setup does NOT retroactively unset it on existing Positions or Trades.

### 5.6 JOURNAL COLUMNS
- `Market Nav Index` dropdown
- `Breadth Metric` dropdown
- Changing these changes the snapshot name for **future** positions only. Existing Positions/Trades keep their captured snapshot.

### 5.7 FOOTER
- `Cancel` (ghost) | `Save Settings` (primary blue)

---

## 6. JOURNAL 2.0 PAGE LAYOUT

**Mount point:** the existing Journal page already renders some tab-like structure. Journal 2.0 is an additional tab in that structure, labeled **"Journal 2.0"**. When the user clicks it, the existing page body is replaced by the Journal 2.0 view. Clicking any of the original tabs returns the user to the untouched existing Journal.

**Inside the Journal 2.0 tab:**
- **Title:** `Journal 2.0` (top-left, large, bold).
- **Top-right controls:** `⚙ Settings $[accountSize]` pill — this opens Journal 2.0's own Settings modal (stored separately from any existing Journal settings).
- **Nested tabs under the title:** `📊 Open Positions` | `📒 Trade Journal`. Active tab: blue underline + blue text.

**Routing:** if the project uses client-side routing, the Journal 2.0 tab can be reflected in the URL (e.g. `/journal?view=j2` or `/journal/j2`) so the user can link directly to it. Coordinate with the existing Journal's routing without modifying it — if the existing Journal uses a query param or a nested route, mirror that pattern additively.

**Visual cue:** a small `beta` chip next to the "Journal 2.0" tab label, to make it obvious this is the work-in-progress view.

---

## 7. OPEN POSITIONS TAB

### 7.1 Stats header (single row above table)
`N position(s)   Value: $X   Invested: X%   Risk: $X (X%)   Heat: $X (X%)   Unrealized: $X`

Right-aligned on same row: `▦ Columns` | `+ Add Position` (primary blue).

### 7.2 Columns (with tooltips)

| Column | Definition |
|---|---|
| Symbol | Ticker. Sortable; default sort. |
| Side | `LONG` green badge / `SHORT` red badge. |
| Date | Entry date, MM/DD/YY. |
| Shares | Current shares (fractional display rule per Section 4). |
| Entry | Weighted-avg entry price. |
| Current | Live price; `—` if feed stale > 5 min. |
| Stop | Active stop: `breakevenStop` if `raiseToBreakeven`, else `stopPrice`. |
| P&L $ | See Section 14. |
| P&L % | See Section 14. |
| % of Acct | Row-level invested = `(current × shares) / accountSize`. |
| Stop Dist | Per Section 14. |
| Risk $ | Per Section 14. Clamp to 0 if negative. |
| Risk/Acct | `riskDollar / accountSize`. |
| B/E Sell | Shares to sell now to break even if stop hits on remainder. **Rounding: `round()` not `ceil()`.** |
| Heat | Per Section 14. Clamp to 0 if negative. |
| Actions | `Edit` / `Close` / `Del` (red). |

### 7.3 Columns picker
- Popover from `▦ Columns`.
- Each entry: drag handle + checkbox + column name.
- Persisted to `localStorage` under `uct.portfolio.openPositions.columns`.
- `Symbol` and `Actions` are non-hideable.

### 7.4 Row styling
Badges small rounded pill. Positive P&L green, negative red. Hover row highlight.

---

## 8. ADD POSITION MODAL — `<AddPositionModal />`

One component; two entry points.

### 8.1 Manual entry
Title: `Add Position`. Fields: Symbol*, Side, Shares*, Entry Price*, Entry Date*, Stop Price, Setup, Notes. Submit: `Add Position`.

**Stop prefill by `settings.defaultStop`:**
- `custom`: blank.
- `bar_low_high`: blank with helper "No bar context in manual entry — enter manually."
- `fixed_dollar_risk`: on blur of shares+entry, compute `stop = entry - (amount / shares)` (long) / `entry + (amount / shares)` (short). Clamp to ≥ 0.
- `fixed_percent_distance`: `stop = entry × (1 − p/100)` (long) / `entry × (1 + p/100)` (short).

### 8.2 Chart right-click entry (Could tier)
Context menu on any bar: `Reset Chart View` / `Add to Portfolio` / `Settings...`

Click `Add to Portfolio` → modal opens titled `Add {SYMBOL} to Portfolio` with:
- Symbol locked.
- Side: Long (default).
- Entry Price: closing price of clicked bar.
- Entry Date: date of clicked bar.
- Stop Price: auto-computed per defaultStop; show source badge (`Bar low` / `Bar high` / `Fixed %` / `Custom`). Helper: "Auto-computed from stop settings — you can override by typing."

### 8.3 Market context capture
On submit, snapshot `MarketContextSnapshot` onto `position.contextAtEntry`. `navCount` is the count of Open Positions immediately before this one is written. If the market-context source is unavailable or stubbed, write `null` into the unknowable fields — do NOT fabricate values.

### 8.4 Validation
- Shares > 0.
- Entry Price > 0.
- Entry Date not in the future.
- Stop Price, if present, must be on the correct side of entry for `side` (for Long, stop < entry; for Short, stop > entry). Reject with inline error.

---

## 9. EDIT POSITION MODAL — `<EditPositionModal />`

Title: `Edit {SYMBOL}`. Grid layout.

Fields:
- `Side` | `Entry Date *`
- `Shares *` | `Entry Price *`
- `Stop Price` (full-width)

**Raise-to-breakeven block:**
- Checkbox: `☑ Raise stop to breakeven (or better)`
- When checked, reveals numeric `Breakeven Stop` with spinner. Default value = `entryPrice`; user may raise above entry.
- Helper: "Used for live portfolio risk & heat calculations. Your original stop is still recorded on the trade record when the position closes (so journal R-multiples stay accurate)."

**Hard rule:** `stopPrice` on the Position is never modified by this toggle. Only `breakevenStop` and `raiseToBreakeven` change.

Other fields: `Setup` dropdown, `Notes` textarea.
Footer: `Save Changes` primary blue.

---

## 10. CLOSE POSITION MODAL — `<ClosePositionModal />`

Triggered by `Close` action.

Title: `Close {SYMBOL}`. Fields: `Shares to Close *` (default = remaining), `Exit Price *` (default = current price), `Exit Date *` (default today), `Notes`.

**Validation:**
- `1 ≤ shares to close ≤ current remaining` (or `0 < x ≤ remaining` for fractional).
- Exit Price > 0.
- Exit Date ≥ Entry Date.

**On submit:**
1. Write a `Trade` with:
   - `shares` = closed amount
   - `entryPrice`, `entryDate`, `originalStop` copied from Position (originalStop = `position.stopPrice`, NEVER `breakevenStop`)
   - `setup`, `notes`, `contextAtEntry` copied from Position
   - Computed fields: `pnlDollar`, `pnlPercent`, `rMultiple`, `holdDays`, `result` per Section 14 using current `settings.breakevenRange`.
2. Decrement `position.shares`.
3. If `position.shares === 0`, set `position.closedAt = now` (archive; do not hard-delete).
4. Multiple same-symbol open positions: honor `settings.positionClosing` (FIFO/LIFO) to decide which position's remaining shares decrement first if the close is a symbol-level sell rather than a row-level sell. If close is triggered from a specific row, close from that row only.
5. Show a toast and navigate to the `Trade Journal` tab with the new row highlighted briefly.

---

## 11. TRADE JOURNAL TAB

### 11.1 Stats grid (6×2)

| # | Card | Value | Sublabel |
|---|---|---|---|
| 1 | Total Trades | `N` | `{W}W / {L}L / {BE}BE` |
| 2 | Win Rate | `X%` | — |
| 3 | Avg Win | `+X.XX%` green | — |
| 4 | Avg Loss | `-X.XX%` red | — |
| 5 | Avg P&L / Trade | `$X` | — |
| 6 | Profit Factor | number or `∞` | — |
| 7 | Total P&L | `$X` | — |
| 8 | Largest Win | `$X` | `+X.XX%` |
| 9 | Largest Loss | `$X` | `X.XX%` |
| 10 | Avg Hold | `X.Xd` | — |
| 11 | Max Consec. Wins | `N` | — |
| 12 | Max Consec. Losses | `N` | — |

BE trades: excluded from Win Rate, Avg Win, Avg Loss. Included in Total Trades, Total P&L, Avg P&L / Trade.

### 11.2 Toolbar
Left: `☰ Filters ▾`. Right: `▦ Columns`, `🗑 Delete All` (red, double-confirm), `⬆ Import CSV`, `+ Add Trade` (primary blue).

### 11.3 Table default columns
Symbol, Result (badge Win/Loss/BE), Shares, Entry $, Entry Date (default sort desc), Exit $, Exit Date, P&L $, P&L %, R, Hold, Nav Count, Rally Day, Power Trend, `{breadthMetricName}`, Setup, IG Rank, RS, Stop (hidden default).

### 11.4 Data flow
Journal is append-only from normal operation. `+ Add Trade` and `Import CSV` are the only non-close paths that write rows. `Delete All` hard-deletes all trades for the user after double confirm (`type DELETE to confirm`).

---

## 12. FILTERS PANEL (Journal only)

Left-drawer / popover, ~320px wide, opens from `Filters ▾`.

### 12.1 Filter sections
- **Date Range** — from/to date pickers.
- **Symbol** — text (exact or starts-with; document which).
- **RS Rating Minimum (at entry)** — number; `null`-RS trades excluded when filter is set.
- **NASI RSI (at entry)** — `Above` / `Below` pills + threshold number input.
- **Side** — Long / Short checkboxes.
- **Setup** — checkbox per entry in `settings.setups` at the time the filter is rendered (may include setups that have been removed since, if any trade still uses them).
- **Nav Count (market exposure)** — `0-2 (light)` / `3-4 (moderate)` / `5+ (heavy)` checkboxes.
- **Power Trend** — `On` / `Off` checkboxes.
- **Rally Day** — optional text/number input.

### 12.2 Behavior
- AND across sections; OR within a section's checkbox group.
- Empty input = filter off for that field.
- Stats recompute live (< 100 ms target per Section 15.5).
- Active filter count appears as a blue badge: `Filters ▾ 3`.
- `Clear all` link at panel footer.
- (Could-tier) Persist filter state to URL query string so shares/refreshes preserve filters.

---

## 13. CSV IMPORT MODAL — `<ImportCsvModal />`

Title: `Import Trades from CSV`.

### 13.1 Dropzone
Large dashed box. "Drop a CSV file here or click to browse." Max 10 MB. Reject binary / non-UTF-8/Windows-1252 with a clear error.

### 13.2 Supported formats (displayed as a list)
- **Schwab** — auto-detected. (Could-tier.)
- **IBKR** — auto-detected, stocks only, fractional supported. (Could-tier.)
- **E*Trade** — auto-detected, Bought/Sold rows only. (Could-tier.)
- **Raw execution fills** — interactive mapper; FIFO reconstruction. (Could-tier.)
- **Pre-matched trades** — CSV with `symbol, side, shares, entry_price, entry_date, exit_price, exit_date, [setup], [notes]`. (Must-tier for the Should-level import feature.)

### 13.3 Downloadable templates
`⬇ Pre-matched template` and `⬇ Raw executions template` — generated client-side.

### 13.4 Flow
1. User drops file.
2. Read as text with encoding detection.
3. **Sanitize every cell** against formula injection (see Section 15.9).
4. Try format auto-detect by header signature. If matched → parse with that adapter. If not → offer interactive column mapping (Could-tier) OR reject with instruction to use pre-matched template.
5. Show a **preview table** of parsed trades (first 20 rows) + row count + warnings (e.g. "3 rows skipped: invalid date").
6. User clicks `Import`. Batch-insert with a transaction; on failure, roll back entirely.
7. Toast: `Imported N trades (M skipped)` and refresh Journal.

### 13.5 Errors
Per-row errors listed with row number and reason. User can proceed with valid rows only (checkbox: `Import N valid rows and skip M invalid`) or cancel.

---

## 14. CALCULATIONS — SINGLE SOURCE OF TRUTH

File: `lib/portfolio/calculations.ts`. Every function is pure, exported, and unit-tested. No calc logic lives in components.

### 14.1 Helpers

```ts
const EPSILON = 1e-9;

export const safeDivide = (a: number, b: number): number | null =>
  Math.abs(b) < EPSILON ? null : a / b;

export const clampNonNegative = (x: number): number => (x < 0 ? 0 : x);

export const roundShares = (x: number, allowFractional: boolean): number =>
  allowFractional ? Math.round(x * 10000) / 10000 : Math.round(x);
```

### 14.2 Long-side formulas

```ts
activeStop(p: Position): number
  → p.raiseToBreakeven && p.breakevenStop != null ? p.breakevenStop : p.stopPrice

positionPnlDollar(p, current) = (current - p.entryPrice) * p.shares
positionPnlPercent(p, current) = safeDivide(current - p.entryPrice, p.entryPrice)

positionRiskDollar(p) = clampNonNegative((p.entryPrice - activeStop(p)) * p.shares)
positionHeatDollar(p, current) = clampNonNegative((current - activeStop(p)) * p.shares)
stopDistancePercent(p, current) = safeDivide(current - activeStop(p), current)

beSellShares(p, current) = {
  const denom = current - activeStop(p);
  if (denom <= EPSILON) return null;                   // stop ≥ current: BE sell undefined
  const raw = positionRiskDollar(p) / denom;
  return roundShares(raw, allowsFractional);           // Math.round, not Math.ceil
}
```

### 14.3 Short-side formulas (explicit; NOT "flip signs")

```ts
// Short: entry > stop is WRONG; stop is ABOVE entry.
// Profit when price falls.

positionPnlDollar(p, current) = (p.entryPrice - current) * p.shares
positionPnlPercent(p, current) = safeDivide(p.entryPrice - current, p.entryPrice)

positionRiskDollar(p) = clampNonNegative((activeStop(p) - p.entryPrice) * p.shares)
positionHeatDollar(p, current) = clampNonNegative((activeStop(p) - current) * p.shares)
stopDistancePercent(p, current) = safeDivide(activeStop(p) - current, current)

beSellShares(p, current) = {
  const denom = activeStop(p) - current;
  if (denom <= EPSILON) return null;
  const raw = positionRiskDollar(p) / denom;
  return roundShares(raw, allowsFractional);
}
```

### 14.4 Portfolio aggregates
Sum component functions across all open positions. Only Long/Short math differs at the position level.

### 14.5 Trade-level

```ts
// Long
tradePnlDollar(t) = (t.exitPrice - t.entryPrice) * t.shares
tradeRMultiple(t) = safeDivide(t.exitPrice - t.entryPrice, t.entryPrice - t.originalStop)

// Short — mirror as above.

holdDays(t) = floor((exitDate - entryDate) / 86400000)  // calendar days

result(t, settings):
  if (!settings.breakevenRange.enabled) return pnl > 0 ? 'Win' : pnl < 0 ? 'Loss' : 'BE';
  const threshold = settings.breakevenRange.unit === '$'
    ? settings.breakevenRange.value
    : Math.abs(t.entryPrice * t.shares * settings.breakevenRange.value / 100);
  if (Math.abs(tradePnlDollar(t)) <= threshold) return 'BE';
  return tradePnlDollar(t) > 0 ? 'Win' : 'Loss';
```

### 14.6 Journal summary stats

```ts
winRate = safeDivide(wins, wins + losses) * 100          // BE excluded from denom
avgWinPercent = mean(pnlPercent) over Win trades
avgLossPercent = mean(pnlPercent) over Loss trades
avgPnlPerTrade = mean(pnlDollar) over ALL trades (incl. BE)
profitFactor = |Σ wins pnl$| / |Σ losses pnl$|  ;  '∞' if losses-sum is 0 and wins > 0 ;  0 if wins = 0
largestWin = max(pnlDollar)
largestLoss = min(pnlDollar)
avgHold = mean(holdDays)
maxConsecWins = longest chronological run of Win
maxConsecLosses = longest chronological run of Loss
```

BE trades **do NOT break** a Win/Loss streak — they're skipped when scanning for consecutive runs. Document this decision explicitly with a code comment.

### 14.7 Verification test data (MANDATORY — add as test cases)

**Open Position:**
YSS, Long, 250 shares @ $29.57, stop $27.90, current $35.53, `accountSize = $100,000`, `raiseToBreakeven = false`.

Expected:
- Value row-level: $8,882.50
- Invested %: 8.88% → display 8.9%
- Risk $: $417.50
- Risk/Acct: 0.4175% → display 0.42%
- Heat $: $1,907.50
- Heat %: 1.9075% → display 1.91%
- Unrealized $: $1,490.00
- P&L %: 20.1556% → display 20.16%
- Stop Dist %: 21.4748% → display 21.5%
- B/E Sell: 54.72 → round → **55 shares (22%)**

**Closed partial:**
Sold 100 shares at $34.50 on 04/10/26 from the YSS Position (entry 04/09/26).

Expected:
- pnlDollar: $493.00
- pnlPercent: +16.6723% → display +16.67%
- rMultiple: 2.9521 → display +3.0R (one decimal)
- holdDays: 1
- result (BE threshold $20): Win

### 14.8 Display-formatting rules
- Money: `$1,234.56` (always 2 dp).
- Percent: 2 dp for stats/table cells, 1 dp only where explicitly noted (R-multiple: 1 dp).
- Share counts: integer if not fractional; up to 4 dp with trailing zeros stripped.
- Dates: `MM/DD/YY` in tables, `MM/DD/YYYY` in modals (matches screenshots).
- Display-format helpers live in `lib/portfolio/format.ts`, separate from calculations.

---

## 14.5 ERROR & EDGE CASE CATALOG

Every case below must have a defined behavior and a matching test.

| # | Case | Defined Behavior |
|---|---|---|
| 1 | Price feed null/stale > 5 min | Display `—` in Current, Stop Dist, P&L cols; disable `Close` with tooltip "Price unavailable" |
| 2 | `activeStop ≥ currentPrice` (long) | Heat clamped to 0; B/E Sell returns `null` → display `—` |
| 3 | `entryPrice == originalStop` | R-multiple `null` → display `—`; warn on Position creation ("Entry equals stop — risk is zero") |
| 4 | Shares = 0 | Position auto-archives (`closedAt = now`) |
| 5 | Negative computed Risk | Clamp to 0 and log a warning; indicates bad data |
| 6 | Fractional shares on non-fractional symbol | Allow; downstream renders 4dp |
| 7 | Scale-in of same symbol | Creates a SEPARATE Position row (not merged). FIFO/LIFO now applies between them. |
| 8 | Partial close larger than remaining | Reject with inline error |
| 9 | Closing date before entry date | Reject with inline error |
| 10 | Timezone drift (user crosses midnight) | Store UTC; compute holdDays using UTC ISO dates |
| 11 | Concurrent edits (two tabs) | Last-write-wins; show toast "Position updated elsewhere — reloaded" when a stale save is rejected by server |
| 12 | BE trade with 0 P&L exactly | Counts as BE (inclusive of zero) |
| 13 | Profit factor with 0 wins & 0 losses | 0 |
| 14 | Profit factor with wins > 0 and losses = 0 | `∞` (display as `∞` glyph) |
| 15 | CSV row missing a required field | Skip row, add to errors list; do not abort the import |
| 16 | CSV with mixed line endings / BOM | Strip BOM; normalize line endings |
| 17 | Setup deleted from settings | Existing Positions/Trades retain the label; filter section still offers it as a filterable value |

---

## 15. STYLING NOTES

[As v1 — retained.]

- Theme: dark. Background near-black `#0a0a0a`–`#111827`. Cards/modals slightly lighter. Borders subtle.
- Typography: Inter / Geist / system sans. Numerics use tabular-nums.
- Primary: `#3b82f6` blue. Positive: `#22c55e` green. Negative: `#ef4444` red. BE/highlight: `#eab308` amber.
- Side/result badges: small rounded pills.
- Modals: centered, 500–600px, rounded-xl, backdrop blur.
- Tables: hover row highlight, sticky header.
- Desktop-first; tablet OK; mobile allowed to degrade tables into card lists.

---

## 15.5 PERFORMANCE BUDGET

- **Table virtualization** kicks in above 200 rows (use `@tanstack/react-virtual` or equivalent).
- **Filter recompute** target: < 100 ms on a 1,000-trade dataset, measured on a mid-tier laptop.
- **Price-update UI debounce**: 250 ms.
- **Initial TTI for the Journal 2.0 tab**: < 2 s on a warm cache.
- **Bundle**: lazy-load CSV parsers (only imported when `<ImportCsvModal />` opens).
- Memoize summary-stat calculations against a filter-state hash; don't recompute on unrelated UI rerenders.

---

## 15.75 ACCESSIBILITY (WCAG 2.1 AA)

- All interactive elements keyboard-focusable with visible focus ring (never removed without equivalent replacement).
- Modals: focus trap; `Esc` closes; focus returns to trigger on close.
- Tables: semantic `<table>` with `<th scope>`; row-level actions grouped.
- Color is never the sole indicator: badges always include text ("Win", "LONG"), P&L cells include `+`/`-` sign.
- Contrast ratios: body text ≥ 4.5:1; large text/badges ≥ 3:1.
- Icon-only buttons have `aria-label`.
- Form inputs labeled; errors announced via `aria-live="polite"`.
- Drag-to-reorder in columns picker has a keyboard alternative (up/down buttons or an order number input).

---

## 15.9 SECURITY REQUIREMENTS

### CSV import hardening
- Reject files > 10 MB.
- Reject binary content; allow only UTF-8 or Windows-1252 text.
- **Formula injection:** before persisting any cell value, if its first character is `=`, `+`, `-`, `@`, `\t`, or `\r`, prefix it with a single apostrophe `'` OR reject the row (choose one and document). Do not render raw.
- Strip leading/trailing whitespace on string fields.

### XSS
- `notes` and `setup` values must be rendered as text, never via `dangerouslySetInnerHTML`.

### Data access
- If multi-user: every query scoped by `userId`. If using Supabase/Postgres, enforce via RLS policies (write and include a SQL migration for them).
- `Delete All` requires double confirmation including typing the literal string `DELETE`.

### Secrets
- No API keys in client code. Price feed / broker calls routed through a server action / API route.

---

## 16. IMPLEMENTATION PHASES

Execute in order. Each phase ends with a review gate per Section 0.

### Phase 0 — Clarify & plan
- Validate Section 1 inputs. If any remain blank, trigger ambiguity protocol.
- **Integration audit:** read the existing Journal page structure to understand its tab pattern and identify the exact mount point for the new "Journal 2.0" tab. Produce `docs/journal-2.0-integration-audit.md` with:
  - A list of files in the existing Journal (read-only reference — these are OFF LIMITS for modification).
  - The exact file(s) where the "Journal 2.0" tab entry must be added (should be 1–2 files maximum — typically where the tabs list is defined).
  - The proposed folder structure for the new code (e.g. `components/journal-2-0/`, `lib/journal-2-0/`, `app/journal/j2/` or equivalent).
  - Confirmation that all new DB tables / storage keys will use the `j2_` prefix or `journal_2_0` schema.
- Set up feature branch `feat/journal-2-0`, lint/format configs, test runner.
- **Gate:** user approves audit + mount-point + folder structure + scope tier.

### Phase 1 — Data model & persistence
- TS interfaces from Section 4.
- DB schema + migrations.
- Default settings row seeded.
- `lib/portfolio/calculations.ts` with every function from Section 14.
- Unit tests using Section 14.7 verification data.
- **Gate:** all tests green; user reviews schema migration.

### Phase 2 — Settings modal
- Full `<PortfolioSettingsModal />` per Section 5.
- Persistence wired.
- `⚙ Settings $X` pill visible inside the Journal 2.0 tab.
- **Gate:** user confirms each stop mode + BE range + setups list persist correctly.

### Phase 3 — Open Positions tab
- Stats header, table, columns picker, tooltips, badges.
- Read-only — no add/edit yet.
- Seed a demo Position (YSS reference) for manual verification.
- **Gate:** visual + numeric check vs screenshots/verification data.

### Phase 4 — Add / Edit / Close / Delete
- All three modals, validation, raise-to-breakeven logic.
- Close writes Trade + decrements Position + archives at 0.
- FIFO/LIFO only exercised with multiple same-symbol Positions.
- Toast notifications + tab switch on close.
- **Gate:** full manual run-through of add → partial close → raise-to-BE → full close → verify Journal row.

### Phase 5 — Trade Journal tab
- 12 stat cards.
- Journal table + columns picker.
- `+ Add Trade` modal.
- `Delete All` with double-confirm.
- **Gate:** stat math audited; BE-exclusion verified.

### Phase 6 — Filters
- All sections per Section 12.
- Live recompute within perf budget.
- Active-filter badge + Clear-all.
- **Gate:** filter combinations spot-checked; stats update correctly.

### Phase 7 — CSV Import
- Pre-matched template parser (Must subset of Should tier).
- Template download.
- Sanitization and security per 15.9.
- Preview → confirm flow.
- Auto-detect adapters (Schwab/IBKR/E*Trade) if time allows (Could tier).
- **Gate:** successful import round-trip; injection test cases blocked.

### Phase 8 — Chart integration (Could — conditional)
- Right-click context menu on existing chart.
- Prefill flow per Section 8.2.
- Skip if Section 1 says "N/A."

### Phase 9 — Polish
- Empty states, loading skeletons, toasts, keyboard shortcuts (optional).
- Accessibility audit pass.
- Perf audit against budget in 15.5.

### Phase 10 — Feature Blending Guide & final polish
- Produce `docs/feature-blending-guide.md`. This is the cherry-picking reference the user will use after the build. For every feature in Journal 2.0, include:
  - Feature name + one-sentence description
  - File(s) where it lives (inside the `journal-2-0` folder)
  - A "merge-back note" describing what would be involved to graft this feature into the existing Journal: which existing files would likely need to change, any data-shape differences, any settings dependencies, any styling dependencies.
  - An effort estimate (S / M / L) for the merge.
  - A compatibility flag: "drop-in," "needs adapter," or "conflicts — requires design decision."
- Update top-level README with a short section: "Journal 2.0 — what it is, where to find it, how to toggle to it."
- Final test suite and lint green.
- **DO NOT** remove, modify, or touch the existing Journal code. It stays as-is permanently until the user runs the cherry-picking pass separately.

---

## 16.5 MIGRATION STRATEGY (OPTIONAL — SKIP BY DEFAULT)

**Default:** do not migrate anything. Journal 2.0 starts empty. The existing Journal keeps all its data. The user will decide later, after review, whether to bring historical trades into Journal 2.0 — and that decision is part of the separate cherry-picking pass, not this build.

If (and only if) the user explicitly requests during Phase 0 that historical trades be seeded into Journal 2.0:

1. Dump current Journal trades to `/backups/journal-<timestamp>.json` before touching anything (read-only copy).
2. Write `scripts/seed-journal-2-0.ts` that **reads** the existing Journal data and **writes** transformed records into the `j2_` tables.
3. **Never modify the existing Journal tables** — this script is read-only against them.
4. For missing fields (e.g. no `originalStop` in legacy): accept `null` and mark `result` computed from `pnlDollar` only.
5. Missing `setup` → `"Legacy"` sentinel.
6. `contextAtEntry` → all nulls.
7. Dry-run mode that prints a diff report without writing.
8. Require explicit user approval before running against real data.

In the default (non-migration) path, simply note in the Feature Blending Guide: *"Historical data migration from the existing Journal is a separate future task."*

---

## 17. ACCEPTANCE CRITERIA (MAPPED TO PHASES)

Each criterion must pass at the end of its mapped phase (or earlier).

**Phase 1:**
- [ ] `calculations.ts` unit tests pass, including Section 14.7 verification.
- [ ] DB schema migration applies cleanly on a fresh DB.

**Phase 2:**
- [ ] Settings persist and all four default-stop modes are honored.

**Phase 3:**
- [ ] Top stats match verification data exactly.
- [ ] B/E Sell returns 55 (22%) for the YSS reference.
- [ ] Columns picker hide/reorder persists across reload.

**Phase 4:**
- [ ] Manual add + chart add (if in scope) produce identical Position records.
- [ ] Raise-to-BE changes live risk/heat but Trade R-multiples use original stop (verify with a unit test + a manual flow).
- [ ] Partial close writes a Trade; full close archives the Position.
- [ ] Stop placement prefilled per `defaultStop`.

**Phase 5:**
- [ ] All 12 stat cards compute correctly on a hand-crafted 10-trade dataset.
- [ ] Profit Factor shows `∞` when zero losses, `0` when zero wins.
- [ ] BE exclusion from Avg Win/Loss verified.

**Phase 6:**
- [ ] Filter recompute stays under 100 ms on a 1,000-trade dataset.
- [ ] AND/OR logic behaves per Section 12.2.

**Phase 7:**
- [ ] Pre-matched CSV round-trips cleanly.
- [ ] Formula-injection test (cell starting with `=SUM(A1:A10)`) is blocked.
- [ ] Templates download and parse back in.

**Phase 9/10:**
- [ ] Keyboard-only navigation works for every interactive element.
- [ ] Lighthouse / axe accessibility score ≥ 95.
- [ ] Dark theme visually matches screenshots.
- [ ] **Existing Journal UI is unchanged and fully functional — verify by switching back to the original tab from Journal 2.0 and confirming nothing looks or behaves differently from before the project started.**
- [ ] `docs/feature-blending-guide.md` exists and covers every feature.
- [ ] No files outside the `journal-2-0` scope have been modified (except the 1–2 tab-registration lines identified in the Phase 0 audit).

---

## 18. THINGS NOT TO DO

- **Do not modify, refactor, rename, move, or delete any file that belongs to the existing Journal.** If you think you need to, STOP and trigger the ambiguity protocol. The only permitted change outside the `journal-2-0` folder is the single tab-registration line(s) identified in the Phase 0 integration audit.
- Do not share database tables, settings rows, or storage keys between the existing Journal and Journal 2.0. Journal 2.0 uses the `j2_` prefix or `journal_2_0` schema exclusively.
- Do not share components between the existing Journal and Journal 2.0. If a utility would be useful, copy it into `journal-2-0/` — do not import from the old path.
- Do not modify `originalStop` when raise-to-breakeven is toggled.
- Do not include BE trades in Win Rate, Avg Win, or Avg Loss.
- Do not fabricate market-context snapshot values — write `null` when unknown.
- Do not silently drop CSV rows; list per-row errors.
- Do not allow closing more shares than are held.
- Do not merge scale-ins into the same Position row.
- Do not hard-delete Positions on full close; archive via `closedAt`.
- Do not round B/E Sell with `ceil` — use `round`.
- Do not ship without the Section 14.7 verification tests green.
- Do not migrate historical Journal data unless explicitly asked (Section 16.5).

---

## 18.5 RESPONSE PROTOCOL

### Template every response must follow

```
## Phase <N> — <name> — <PLANNING | IN PROGRESS | BLOCKED | AWAITING REVIEW | COMPLETE>

<body>

### Proposed next step
<single sentence>
```

### Plan-before-code rule
Before any code in a phase, output a plan:

```
### Plan — Phase <N>
Files to create: <list>
Files to modify: <list>
Approach: <2–5 sentences>
Risks: <bulleted>
Tests: <what will be added/updated>
Estimated scope: <S / M / L>
```

### After writing code
Paste a diff summary (file + line counts + one-line per change), run tests, paste the summary. Self-review against acceptance criteria. Flag anything skipped.

### Ambiguity template (repeated from 0.2)

```
⚠ AMBIGUITY — <topic>
Context: ...
Options: A) ... B) ... C) ...
Recommendation: ...
Waiting for decision.
```

---

## 19. DELIVERABLES CHECKLIST

- [ ] `lib/journal-2-0/calculations.ts` + test suite (Section 14.7 verification included)
- [ ] `lib/journal-2-0/format.ts` for all display formatting
- [ ] DB schema / migrations for `j2_`-prefixed tables only (existing Journal tables untouched)
- [ ] All components in Sections 5–13, scoped under a `journal-2-0/` folder
- [ ] Single tab-registration change in the existing Journal page (1–2 lines, identified in Phase 0 audit)
- [ ] CSV parsers (pre-matched required; broker adapters optional)
- [ ] Client-side CSV template generators
- [ ] `docs/journal-2.0-integration-audit.md` (Phase 0 output)
- [ ] `docs/journal-2.0-architecture.md` (final architecture overview of just Journal 2.0)
- [ ] `docs/feature-blending-guide.md` (the cherry-picking reference — every feature mapped with merge-back notes and effort estimates)
- [ ] RLS policies / auth guards for Journal 2.0 tables (if multi-user)
- [ ] Accessibility audit report
- [ ] Perf audit report against Section 15.5 budget
- [ ] Verification: existing Journal still works unchanged

---

## 20. STRICT MODE ADDENDUM (OPTIONAL)

Append or enable by user. When active, the following override anything softer above.

- **No libraries** beyond those already present in `package.json` and those explicitly listed in Section 1. Any new dep requires a written justification and explicit approval. This includes dev deps.
- **No `any`.** Not with a comment, not ever. Use `unknown` and narrow.
- **100% branch coverage** on `calculations.ts` before Phase 1 is COMPLETE. Target ≥ 90% on modals.
- **Every component** has a minimal Storybook story (or equivalent isolation harness).
- **Every phase** ends with: lint pass, type check pass, test pass, manual smoke-test checklist filled in by Claude Code and pasted.
- **No global mutable state** outside the defined stores (settings store, positions store, trades store).
- **No inline event handlers** that call multiple effects; extract to named functions.
- **One PR per phase**, titled `feat(journal): Phase <N> — <name>`. Body contains: summary, screenshots (if UI), test results, acceptance checklist, risks.
- **Spec conflicts:** if this section conflicts with an earlier section, **this section wins**. Flag the conflict in your response.
- **No creative UI deviations** from screenshots/spec. If a design decision isn't covered, trigger ambiguity protocol — do not invent.
- **Response discipline:** responses that violate Section 18.5's structure are considered incorrect and must be restarted.

---

**End of spec.** When in doubt, default to Section 0.2 (Ambiguity Protocol) and Section 14.7 (Verification Data).
