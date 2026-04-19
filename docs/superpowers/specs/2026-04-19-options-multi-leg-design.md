# Journal 2.0 — Options (Multi-Leg Native) — Design Spec

**Phase 5 / Step 3 of the J2.0 Enhanced Suite.**

**Date:** 2026-04-19
**Author:** Patrick (with Claude)
**Status:** Draft, research-informed — for review before implementation

---

## 0. Research summary (what informs this design)

Before writing this spec, we did deep competitive research across:
**Tradezella · Edgewonk · Tradervue · TraderSync · ChartLog · TradesViz ·
TradingDiary Pro · Trademetria · Stonk Journal · Option Alpha · OptionStrat
(planner) · tastytrade · Webull/IBKR**.

**Key findings driving this design:**

1. **Pattern C wins.** Every mature options journal uses separate
   strategies + legs tables (TradesViz, Trademetria, tastytrade "Order
   Chains"). Tradezella's one-row-per-leg is universally panned in user
   reviews ("my iron condor shows as 4 losers"). JSON-blob-of-legs is a
   false economy; it kills strategy-type analytics in 3 months.

2. **OptionStrat's sticky live-calc footer is the killer UX win.**
   Users typing legs want to see Net Debit/Credit · Max Loss · Max Profit
   · Breakevens updating live as they enter strikes. Hiding that until
   save is the #1 UX complaint across reviews.

3. **Plain-English strategy tiles beat jargon + emoji.** "Sell a Put
   Spread (bullish, income)" outperforms "📉 Put Credit Spread" for
   non-pro traders. Emojis look toyish in a serious-money UI.

4. **Manual-first entry is a feature.** Trademetria is pilloried for
   "only ThinkorSwim users get auto-grouping." The manual leg editor
   needs to be *excellent*, not second-class. Template pre-fill + live
   calcs + smart defaults = users don't feel punished for not using TOS.

5. **No competitor combines options + playbook + daily journal.**
   Tradezella has good options, weak journaling. TradesViz has great
   options analytics, no playbook. UCT's unique moat: tie every option
   strategy to a Playbook entry and surface it in the Daily Recap. The
   "Prep → Plan → Trade → Recap" loop is ours to own.

6. **Greeks are out for v1.** Newer options traders freeze when
   presented with delta/theta/gamma columns. TradesViz has 8 Greek
   columns and first-time users bounce. Greeks live behind a future
   "Pro view" toggle if at all.

## 1. Goals

Add first-class options trading support to Journal 2.0. Users can log
single-leg calls/puts AND multi-leg strategies (verticals, condors,
butterflies, diagonals) as **one trade per strategy**, not as N
individual trades to be mentally recombined.

### Explicit non-goals (v1)

- **No Greeks** (delta / gamma / theta / vega) — future Pro-view toggle
- **No live options chain** — users enter contracts manually; no quote feed
- **No IV rank / IVR** — requires market data we don't have
- **No payoff-at-expiration chart** — nice-to-have, post-v1
- **No assignment → auto-convert-to-stock** — mark Assigned, no auto-magic
- **No auto-detect-strategy** on import — user picks template
- **Futures / Crypto / Bets** — separate future phases

### Core design constraint

**Simple and user-friendly** — specifically, an options-naive trader
should be able to log an Iron Condor in under 60 seconds and understand
their max risk before they save. Every UX decision below serves this.

## 2. Data model

### 2.1 Strategy vs. Legs (Pattern C)

An **Options Strategy** = a coherent options trade idea, 1–4 legs, one
underlying.

**Strategy types supported v1:**

- Single-leg: `long_call`, `long_put`, `short_call`, `short_put`
- Two-leg: `vertical_debit_call`, `vertical_credit_call`,
  `vertical_debit_put`, `vertical_credit_put`, `calendar`, `diagonal`,
  `straddle`, `strangle`
- Four-leg: `iron_condor`, `iron_butterfly`, `call_butterfly`, `put_butterfly`
- `custom` (user-defined)

Each leg has its own strike / expiration / side / qty / entry price /
exit price.

### 2.2 Schema

**New table `j2_option_strategies`:**

```sql
CREATE TABLE IF NOT EXISTS j2_option_strategies (
    id                  TEXT PRIMARY KEY,
    user_id             TEXT NOT NULL,
    account_id          TEXT,                      -- defaults via router
    underlying          TEXT NOT NULL,             -- e.g. "NVDA"
    strategy_type       TEXT NOT NULL,             -- see §2.1 list
    direction           TEXT NOT NULL CHECK(direction IN ('bullish','bearish','neutral')),
    net_entry           REAL NOT NULL,             -- net debit (+) or credit (-) per strategy
    fees                REAL NOT NULL DEFAULT 0,
    entry_date          TEXT NOT NULL,             -- ISO 8601 UTC
    setup               TEXT,                      -- pulls from account.setups
    notes               TEXT,
    context_at_entry    TEXT NOT NULL DEFAULT '{}',
    status              TEXT NOT NULL DEFAULT 'open'
                        CHECK(status IN ('open','closed','expired','assigned','rolled')),
    closed_at           TEXT,                      -- ISO when status → closed/expired/assigned
    net_exit            REAL,                      -- net exit credit (+) or debit (-)
    exit_fees           REAL NOT NULL DEFAULT 0,
    pnl_dollar          REAL,                      -- realized net P&L
    pnl_percent         REAL,                      -- vs. net_entry risk
    r_multiple          REAL,                      -- vs. max-risk
    result              TEXT,                      -- Win|Loss|BE
    linked_playbook_id  TEXT,                      -- UNIQUE ANGLE: link to Playbook entry
    parent_strategy_id  TEXT,                      -- for rolled strategies (v2 uses this)
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_j2_opt_user_status
    ON j2_option_strategies(user_id, status);
CREATE INDEX IF NOT EXISTS idx_j2_opt_user_account
    ON j2_option_strategies(user_id, account_id);
CREATE INDEX IF NOT EXISTS idx_j2_opt_underlying
    ON j2_option_strategies(user_id, underlying);
CREATE INDEX IF NOT EXISTS idx_j2_opt_playbook
    ON j2_option_strategies(user_id, linked_playbook_id);
```

**New table `j2_option_legs`:**

```sql
CREATE TABLE IF NOT EXISTS j2_option_legs (
    id            TEXT PRIMARY KEY,
    strategy_id   TEXT NOT NULL REFERENCES j2_option_strategies(id) ON DELETE CASCADE,
    leg_index     INTEGER NOT NULL,                -- 0-based display order
    side          TEXT NOT NULL CHECK(side IN ('buy','sell')),
    contract_type TEXT NOT NULL CHECK(contract_type IN ('call','put')),
    strike        REAL NOT NULL,
    expiration    TEXT NOT NULL,                   -- YYYY-MM-DD
    qty           INTEGER NOT NULL,                -- contracts
    entry_price   REAL NOT NULL,                   -- premium per contract
    exit_price    REAL,                            -- premium at close
    UNIQUE(strategy_id, leg_index)
);
CREATE INDEX IF NOT EXISTS idx_j2_opt_legs_strategy
    ON j2_option_legs(strategy_id);
```

**User-level settings addition:**

```sql
ALTER TABLE j2_accounts ADD COLUMN default_fee_per_contract REAL NOT NULL DEFAULT 0;
```

Surfaced in Account Settings modal. Used to pre-fill fees on new
option strategies (see §4.2).

### 2.3 Net entry / exit accounting

For a strategy:

- **net_entry** = `Σ over legs of (sideSign × qty × entry_price × 100)`
  where `sideSign = +1 for buy, -1 for sell`.
  - Positive → **net debit** (you paid to enter).
  - Negative → **net credit** (you received).

- **net_exit** = same formula with `exit_price`. Set on close.

- **pnl_dollar** = `net_exit − net_entry − fees − exit_fees`.
  This formula handles both debit and credit structures uniformly — a
  credit spread closed for a smaller credit = profit (negative net_exit
  that's smaller in magnitude than negative net_entry).

**R-multiple (max-risk based):**

- Long (debit) strategy: `max_risk = net_entry`. R = `pnl / max_risk`.
- Credit spread: `max_risk = spread_width × 100 × qty − |net_credit|`.
- Naked short: `max_risk = NULL` (display "N/A"; undefined).

Store computed `r_multiple` at close time, frozen.

## 3. Nav integration

Options live alongside stocks in existing J2.0 tabs — no new tab.

### 3.1 Open Positions

Table grows a new `asset` column (visible by default). Values: `Stock`
/ `Option`. Each open option-strategy row shows:

- **Label** (e.g. `NVDA 200/205C 05/16` — see §6.3 formatter)
- **Strategy type badge** (e.g. "Vertical Debit", "Iron Condor")
- **Net entry** ($ debit or credit)
- **Days to expiration** (nearest leg)
- **Current P&L** = placeholder `—` in v1 (no quote feed)
- **Max risk** (from §2.3)
- **Setup** (from `setup` col)

Click row → expand showing per-leg mini-table: side / type / strike /
exp / qty / entry / (exit).

### 3.2 Trade Journal

Closed option-strategies appear in the trades list alongside stock
trades, same table, same columns (P&L, R, result, setup, fees).
Symbol column renders the strategy label.

Filter Panel gains an **Asset Type** section: `Stock` / `Option` / `All`.

### 3.3 Calendar

Day P&L includes realized options P&L, ET-bucketed by `closed_at`.
**NEW:** day cells show a small `🕒 N` indicator when N strategies
expire on that day — "expiry density heatmap", exploits UCT's
calendar-first positioning (§7 unique angle).

### 3.4 Analytics — options charts

Backend aggregator (`analytics.py`) unions `j2_trades` + closed
`j2_option_strategies`, tagging each row with `asset_type`.

**New charts:**

1. **P&L by Asset Type** (Stock vs Option, side-by-side)
2. **P&L by Strategy Type** (horizontal bars: Long Call / Vertical
   Debit / Iron Condor / etc., sorted by P&L; sort toggle: P&L / Count
   / Win Rate / Avg R)
3. **Credit vs Debit split** — side-by-side: P&L, Win Rate, Avg Hold
   Days, Avg R, Trade Count (research-inspired addition; high insight,
   cheap to compute)
4. **DTE-at-entry vs R-multiple scatter** — each closed option is a
   point: X = days-to-expiration at entry, Y = R-multiple at close.
   Bubble size = net_entry $. Reveals "I make money at 30-45 DTE, lose
   at 0-7 DTE" without ever saying the word theta. (Research-inspired;
   unique to UCT.)
5. **Options % of P&L** (small KPI pill added to the Equity section
   strip) — "37% of P&L came from options this period."

### 3.5 Accounts

No structural change. `j2_option_strategies.account_id` respects the
global selector. Account Comparison metrics sum both asset types.

**NEW setting**: `default_fee_per_contract` (e.g. $0.65) in Account
Settings modal → pre-fills option fees at write time.

### 3.6 Playbook (UCT's unique moat)

`j2_option_strategies.linked_playbook_id` — nullable FK to
`j2_playbook_entries.id`. Set at entry time via a picker in the Add
modal (§4.1).

Playbook tab's entry cards now show:
- "Linked trades: 2 option strategies · +$430 realized"
- Click → drill into list of linked options + stock trades

**Playbook → Daily Recap → Analytics loop** is what no competitor has.
Analytics gains a breakdown by `linked_playbook_id`: "My SPY-put-credit-
spread-in-uptrend playbook wins 72%; my impulse PCS wins 38%."

## 4. UX flows

### 4.1 Add Option Strategy modal

New button in OpenPositionsTab header: **`+ Add Option`** (next to
`+ Add Position`). Opens `AddOptionStrategyModal`.

**Layout:**

```
┌─────────────────────────────────────────────────────┐
│ Add Option Strategy                         [× ]    │
│ Adding to Live                                      │
├─────────────────────────────────────────────────────┤
│  Pick a strategy                                    │
│  ┌────────────┬────────────┬────────────┬─────────┐│
│  │ ╱          │ ╲          │ ╱╲         │ ╲╱      ││
│  │ Long Call  │ Long Put   │ Call Debit │ Put Cre ││
│  │ "Buy a call│ "Buy a put │ "Buy call  │ "Sell pu││
│  │  bullish…" │  bearish…" │  spread…"  │  spread…││
│  └────────────┴────────────┴────────────┴─────────┘│
│   [ 12+ tiles total ]          [ Custom ]          │
├─────────────────────────────────────────────────────┤
│  Underlying: [NVDA___]  Entry Date: [2026-04-19]   │
│  Setup: [VCP  ▾]  Playbook: [SPY-PCS-uptrend  ▾]   │
│  Fees: [$2.60]  Direction: ● bullish                │
├─────────────────────────────────────────────────────┤
│  LEGS                                               │
│  ─────────────────────────────────────────          │
│  Leg 1  [Buy ▾] [Call ▾] Strike [200] Exp [05/16]  │
│         Qty [1] Entry Price [$5.20]                 │
│  Leg 2  [Sell ▾] [Call ▾] Strike [205] Exp [05/16] │
│         Qty [1] Entry Price [$3.50]                 │
│  [+ Add leg]                                        │
├─────────────────────────────────────────────────────┤
│  ◆ STICKY FOOTER (always visible)                   │
│  Net Debit: $170   Max Loss: $170  Max Profit: $330│
│  Break-even: $201.70                                │
│  [Cancel]                      [Save Strategy]      │
└─────────────────────────────────────────────────────┘
```

**Template tiles** (research-informed design):

- Render as small **monochrome SVG P&L diagrams** — not emojis. Each
  tile has: shape icon (30×20 payoff-curve silhouette), label (plain
  English, e.g. "Buy a Call Spread"), one-line description
  ("bullish, limited risk").
- Grid of ~14 templates + custom: Long Call, Long Put, Short Call,
  Short Put, Call Debit Spread, Call Credit Spread, Put Debit Spread,
  Put Credit Spread, Call Butterfly, Put Butterfly, Iron Condor, Iron
  Butterfly, Straddle, Strangle, Calendar, Diagonal, Custom.
- Clicking a template **pre-fills leg scaffolding** — correct sides,
  types, suggested default strike offsets (e.g. short-strike at
  `round(lastPrice × 1.02)` if we have a cached underlying price).

**Live sticky footer** (OptionStrat's signature):

- `Net Debit / Net Credit: $XXX.XX` — updates on every keystroke
- `Max Loss: $X` — from §2.3 formula
- `Max Profit: $X` — per template logic
- `Break-even: $X` — per template logic (multiple for condors)
- For invalid/incomplete leg data, show `—` with warning color
- **Must be visible on mobile without scrolling** (sticky, not inline)

**Smart defaults** (so manual entry doesn't feel second-class):

- Expiration: default to nearest monthly Friday, 30-45 DTE
- Strike suggestions based on underlying last price (if cached from
  recent chart view) — short legs near the money, long legs 5-10 pts
  further out
- Qty defaults to 1
- Entry price defaults to empty — user MUST type this (no guess)
- Fees auto-fill from `account.default_fee_per_contract × total legs
  qty × 2` (round-trip)

### 4.2 Close Option Strategy modal

From OpenPositionsTab row → `Close` button opens
`CloseOptionStrategyModal`:

- Lists each open leg with entry price; user enters **exit price per
  leg** (or 0 for expired-worthless)
- Live sticky footer: **Net Exit · $ P&L · R-multiple**
- Fields: **Exit Date** · **Fees** (pre-filled from account default ×
  legs) · **Notes**
- Status selector:
  - `Closed` (normal)
  - `Expired` (auto-fills all exit_prices = 0, one click)
  - `Assigned` (marks only; no auto-convert in v1)
  - `Rolled` (closes this strategy; v1 stops here; v2 opens a new
    strategy with `parent_strategy_id = this.id`)

### 4.3 Expired strategies — one-click banner

When the nearest-leg expiration of an open strategy is in the past, it
appears in a **banner** at the top of OpenPositionsTab:

```
⚠ 3 strategies ready to mark expired
  SPY IC 420/425/435/440  · exp 04/12 · -$120 realized
  NVDA PCS 195/200         · exp 04/12 · +$150 realized
  AMD 140C                  · exp 04/12 · -$320 realized
  [Mark all expired]  [Review each]
```

**One click → confirm toast → all expired strategies' legs set
exit_price=0, status='expired', P&L realized.** No modal with zeros to
type.

`Review each` opens them individually in CloseOptionStrategyModal with
Expired pre-selected, giving the user a chance to adjust (e.g. a leg
was closed at $0.05 before expiry, not $0).

## 5. Backend

### 5.1 Services (`api/services/journal_two/options.py`)

- `list_open_strategies(user_id, account_id=None)` → strategies with
  legs embedded
- `list_closed_strategies(user_id, account_id=None, date_from=None, date_to=None)`
- `get_strategy(user_id, strategy_id)`
- `create_strategy(user_id, payload, account_id=None)` — atomic:
  insert strategy + N legs in one transaction
- `close_strategy(user_id, strategy_id, payload)` — updates exit
  prices + computes P&L + sets status
- `mark_expired(user_id, strategy_id)` — exit_price=0 all legs, compute
  P&L, status='expired'
- `mark_expired_batch(user_id, strategy_ids)` — one-click batch for
  the banner
- `update_strategy(user_id, strategy_id, patch)` — edit metadata
  (notes, setup, direction, linked_playbook_id) only; **legs are
  immutable once created** (enforces audit trail)
- `delete_strategy(user_id, strategy_id)` — only when status='open'

**Calc helpers** (`options.py` + `lib/optionCalcs.js`):

- `compute_net_entry(legs)` — sum, see §2.3
- `compute_net_exit(legs)` — same for exit_price
- `compute_pnl(net_entry, net_exit, fees, exit_fees)`
- `compute_max_risk(strategy_type, legs, net_entry)` — per-template formula
- `compute_max_profit(strategy_type, legs, net_entry)` — per-template
- `compute_break_evens(strategy_type, legs, net_entry)` — returns array
- `compute_days_to_expiration(legs, as_of=today)` — min across legs

### 5.2 Routes

All under `/api/j2/options/*`:

```
GET    /options                    list open + closed (account-scoped, optional status filter)
POST   /options                    create
GET    /options/{id}               single + legs
PUT    /options/{id}               update metadata (not legs)
DELETE /options/{id}               delete while open
POST   /options/{id}/close         close with exit-price-per-leg
POST   /options/{id}/expire        mark expired (legs' exit=0)
POST   /options/mark-expired-batch body: { strategy_ids: [...] }
```

### 5.3 Analytics integration

`/api/j2/analytics` aggregator currently reads `j2_trades`. Extend:

1. Union closed `j2_option_strategies` with `j2_trades` into one
   "realized trades" set, each row tagged `asset_type` ∈
   `{stock, option}`.
2. Equity curve / drawdown / day/week/month histogram / hourly /
   day-of-week: use realized rows (timestamped `closed_at` for
   options, `exit_date` for stocks).
3. **New breakdowns added to payload:**
   - `byAssetType`: `{ stock: {pnl, winRate, tradeCount}, option: {...} }`
   - `byStrategyType`: array of `{ strategyType, pnl, winRate, avgR, tradeCount }`
   - `creditVsDebit`: `{ credit: {...}, debit: {...} }` — options only
   - `dteVsR`: array of `{ dteAtEntry, rMultiple, netEntry }` scatter points
4. `edgeScore` uses the combined realized set.
5. `optionPctOfPnl` = `options_total_pnl / (options_total_pnl + stocks_total_pnl)`.

### 5.4 Calendar integration

`/api/j2/calendar` day bucketer unions options same way. New optional
field per day: `expiringCount` — # of open strategies whose nearest leg
expires that date. Renders as a small `🕒 N` badge in the cell (opt-in
— can be toggled in CalendarHeader).

### 5.5 Community integration

Per existing `share_journal_data` flag per account — shared account's
option strategies show up in the Community Trader Detail page
alongside closed stock trades, stripped of $ amounts (per existing
privacy rules).

## 6. Frontend

### 6.1 New files

```
app/src/pages/journal-2-0/
├── components/options/
│   ├── AddOptionStrategyModal.jsx      ← template picker + LegEditor + live footer
│   ├── AddOptionStrategyModal.module.css
│   ├── CloseOptionStrategyModal.jsx
│   ├── CloseOptionStrategyModal.module.css
│   ├── StrategyTemplates.js            ← library of 14+ templates
│   ├── StrategyIcons.jsx               ← monochrome SVG P&L-shape icons
│   ├── LegEditor.jsx                   ← shared leg-row input
│   ├── LegEditor.module.css
│   ├── StrategyLabel.jsx               ← formatted label like "NVDA 200/205C 05/16"
│   ├── ExpiredStrategiesBanner.jsx
│   └── StrategyDetail.jsx              ← expanded row content in OpenPositions
├── hooks/
│   └── useJ2OptionStrategies.js
└── lib/
    ├── optionCalcs.js                  ← pure calc functions (mirrors backend)
    └── optionCalcs.test.js             ← co-located tests
```

### 6.2 StrategyTemplates.js

Array of template objects:

```js
{
  key: 'vertical_credit_put',
  label: 'Sell a Put Spread',
  plainDescription: 'Bullish, limited risk, collect income.',
  icon: PutCreditSpreadIcon,           // SVG component
  direction: 'bullish',
  defaultLegs: [
    { side: 'sell', contract_type: 'put', strikeOffset: -0.02, qty: 1 },
    { side: 'buy',  contract_type: 'put', strikeOffset: -0.05, qty: 1 },
  ],
  maxRiskFormula: (legs, netEntry) => (legs[1].strike - legs[0].strike) * 100 * legs[0].qty + netEntry,
  maxProfitFormula: (legs, netEntry) => -netEntry,
  breakEvensFormula: (legs, netEntry) => [legs[0].strike + netEntry / (100 * legs[0].qty)],
}
```

`strikeOffset` is relative to underlying's last known price (if
available). E.g. `-0.02` = 2% below. Used for smart defaults.

### 6.3 Strategy label formatter

`formatStrategyLabel(strategy, legs)` utility:

| Strategy | Format | Example |
|---|---|---|
| Long Call / Put | `{symbol} {strike}C 05/16` | `NVDA 200C 05/16` |
| Short Call / Put | `{symbol} -{strike}C 05/16` | `NVDA -200C 05/16` |
| Vertical | `{symbol} {strike1}/{strike2}{C|P} 05/16` | `NVDA 200/205C 05/16` |
| Iron Condor | `{symbol} {putLong}/{putShort}/{callShort}/{callLong} 05/16` | `SPY 420/425/435/440 05/16` |
| Straddle | `{symbol} {strike} Straddle 05/16` | `NVDA 200 Straddle 05/16` |
| Strangle | `{symbol} {putStrike}/{callStrike} Strangle 05/16` | `NVDA 195/205 Strangle 05/16` |
| Calendar | `{symbol} {strike}{C|P} {exp1}/{exp2}` | `NVDA 200C 05/16/06/20` |
| Custom (fallback) | concatenated legs | `NVDA +1 200C / -1 205C` |

Mixed expirations (except Calendar/Diagonal): append `MIXED` suffix.

### 6.4 StrategyIcons.jsx

Monochrome inline SVGs — 30×20px — showing payoff shape of each
strategy type. Replaces emoji anti-pattern. Drawn in
`var(--text-bright)` stroke on transparent fill, turns
`var(--ut-gold)` on tile hover.

## 7. Unique angle — what no other journal does

**Prep → Plan → Trade → Recap loop for options.** UCT's moat:

1. User writes **Playbook entry** for SPY Put Credit Spread setup (saved
   screenshots + thesis + key levels + required conditions).
2. Morning — **Daily Prep** note: "Watching SPY PCS today; IV rank > 50,
   underlying above 20-day MA."
3. Signal fires → **Add Option Strategy** modal → user picks the
   Playbook entry from dropdown → `linked_playbook_id` stamped.
4. Evening — **Daily Recap**: auto-populates "Options opened today: 1 ·
   Options closed: 0 · Unrealized on open strategies: —"
5. Later — **Analytics**: "Playbook: SPY PCS uptrend — 7 strategies,
   72% win rate, avg +0.8R. Playbook: impulse PCS — 3 strategies, 38%
   win rate, avg -0.4R."

**Concrete v1 features that wire this loop:**

- Linked-playbook picker in Add Option modal (§4.1)
- Daily Recap auto-populates "Options opened/closed today" (extends
  existing DayReflection recap section)
- Analytics section shows `byLinkedPlaybook` breakdown when any
  strategies have a linked playbook (graceful degrade if none)
- Playbook entry card shows linked-strategies summary (§3.6)

**Bonus:** Options Discipline metric in Edge Scorecard — "% of
options strategies closed before 0 DTE" (avoid pin-risk / gamma
explosion). Unique to UCT because no other journal has the Edge
Scorecard concept.

## 8. Migration

**Pure additive.** No existing table touched.

1. `ensure_schema` on app start creates the two new tables (idempotent)
2. `ALTER TABLE j2_accounts ADD COLUMN default_fee_per_contract` (via
   `_PHASE_5_ALTERS` similar to Phase 4 pattern; idempotent via
   try/except)
3. Existing stock-only users see no change until they click `+ Add Option`
4. Analytics aggregator falls through cleanly when no options exist

**Rollback:** drop the two new tables; guard the analytics code path.
Safe.

## 9. Testing strategy

### 9.1 Backend (pytest)

`test_options.py`:
- Create: single-leg long call (debit +), short put (credit -), 2-leg
  vertical credit put (credit -), 4-leg iron condor (credit -)
- Net entry sign correctness per structure
- Close: P&L math per structure type — debit closed for profit, credit
  closed for profit (smaller close credit than open credit), breakeven,
  full loser, partial
- Max risk: long call = net_entry; credit spread = width*100 -
  net_credit; naked short → None
- User isolation + account scoping
- Expired → all exit_price=0, status='expired', P&L computed
- `mark_expired_batch` atomic
- Validation: rejects strike ≤ 0, qty ≤ 0, past expiration, mixed
  underlyings within one strategy
- `parent_strategy_id` nullable, FK integrity

`test_analytics.py` extension:
- Equity curve sums stock + option P&L at date boundaries
- `byAssetType` correct for mixed portfolio
- `byStrategyType` sort + filter
- `creditVsDebit` split correct
- `dteVsR` scatter points populated only for closed options w/ non-null R

`test_calendar.py` extension:
- Day-bucketed P&L includes closed options
- `expiringCount` per day matches open strategies

### 9.2 Frontend (vitest)

- `lib/optionCalcs.test.js` — net_entry / exit / P&L / max-risk / max-profit
  / break-evens per strategy type (15+ cases)
- `StrategyTemplates.test.js` — every template produces valid default legs
- `AddOptionStrategyModal.test.jsx` — pick template → legs populate →
  change strikes → live footer updates → save → payload shape correct
- `CloseOptionStrategyModal.test.jsx` — exit-per-leg → live net exit +
  P&L preview correct; Expired toggle → all exits = 0
- `ExpiredStrategiesBanner.test.jsx` — batch-mark action
- `StrategyLabel.test.js` — label format for every strategy type

## 10. Phasing

Eight small commits (research-informed order):

1. **Backend foundation.** Schema (both tables + default_fee_per_contract
   ALTER) + `options.py` service + CRUD + calc helpers + tests. **~1 day.**
2. **List + detail read path.** `useJ2OptionStrategies` hook;
   `StrategyLabel` + `StrategyDetail` components; expandable row in
   OpenPositionsTab; closed strategies in TradeJournal. No writes yet.
   **~0.5 day.**
3. **Strategy templates + icons.** `StrategyTemplates.js` (14 templates
   w/ formulas) + `StrategyIcons.jsx` (14 monochrome SVGs) + unit tests.
   **~0.5 day.**
4. **Add Option Strategy modal.** Template picker + LegEditor + live
   sticky footer + smart defaults + save. Wired to POST. **~1 day.**
5. **Close Option Strategy modal + expired banner.** Exit-per-leg +
   P&L preview + status selector + expired banner w/ batch action.
   **~0.5 day.**
6. **Analytics integration.** Backend aggregator unions options; 4 new
   charts (by asset type, by strategy type, credit-vs-debit, DTE scatter)
   + Options % KPI. **~1 day.**
7. **Calendar integration.** Day P&L includes options; expiringCount
   badge. **~0.25 day.**
8. **Playbook + Daily Recap wiring.** `linked_playbook_id` picker in
   Add modal; Playbook card shows linked strategies; Daily Recap
   auto-populates options opened/closed. **~0.5 day.**

**Total:** ~5 days.

## 11. Open questions (deferred answers)

| Q | Decision for v1 | Revisit when |
|---|---|---|
| Live options chain lookup | No — manual entry | Broker integration (separate spec) |
| Greeks (delta / theta / gamma) | No — Pro view future | Quote feed ships |
| Rolled strategy → auto-create new | No — mark `Rolled`, schema ready via `parent_strategy_id` | v2, after users ask |
| Assignment → auto-convert to stock position | No — mark `Assigned` only | v2 |
| Multi-underlying strategies (pairs trades) | No — one underlying per strategy | Future |
| Strike-line overlay on underlying's chart | No — out of scope v1 | Polish pass |
| IV rank at entry | No — no data | Quote feed ships |
| Payoff-at-expiration chart | No — defer to post-v1 | Polish / user demand |
| Live current-P&L column (requires live options quotes) | No — show `—` for open strategies | Quote feed |

---

**End of spec. Research-informed. Ready for review before implementation.**
