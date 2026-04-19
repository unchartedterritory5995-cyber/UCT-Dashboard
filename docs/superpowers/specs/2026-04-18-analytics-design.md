# Journal 2.0 — Analytics Tab — Design Spec

**Phase 3 of the J2.0 Enhanced Suite (Calendar → Accounts → Analytics)**

**Date:** 2026-04-18
**Author:** Patrick (with Claude)
**Status:** Draft for review

---

## 1. Goals

A new **Analytics** tab in Journal 2.0 that surfaces edge across every dimension a serious trader cares about:

1. **Time-series view of equity** with drawdown overlay + KPI strip (Peak / Max DD / Current DD / Longest Underwater).
2. **Performance distribution** by day-of-week, hour-of-day, day/week/month/year — find when you trade well.
3. **Risk distribution** — R-multiples, P&L distribution, win/loss streaks, long vs short — find the shape of your edge.
4. **Attribution** — P&L by setup, win rate by setup, P&L by symbol — find what works.
5. **Live unrealized equity** — J2.0-unique. Closed equity + open-position unrealized = your true current equity.
6. Account-scoped via the global header selector (Phase 2). Time-range filtered globally per page.

## 2. Out of scope (explicit non-goals)

- **Edge Scorecard composite metric** — Phase 4 polish
- **Streak benchmarking** ("best YTD: 7") — Phase 4
- **Time-Underwater detailed timeline** — basic version in Equity section; detailed in Phase 4
- **Cross-trader comparison / leaderboard** — community feature, not analytics
- **AI-generated insights** — out of scope for v1
- **Comparison views** ("Q1 vs Q2", "Live vs Paper") — v2
- **Export to PDF/CSV from Analytics** — handled by Phase 4 Generate Report modal
- **Custom dimension breakdowns** ("by mistake tag", "by playbook") — depends on tagging features we haven't built
- **Real-time chart updates as new positions open/close** — initial load only; user re-fetches by clicking refresh or changing time range

## 3. Nav placement

Add **Analytics** as a new tab in `JournalTwoRoot.jsx`:

```
📊 Open Positions  |  📒 Trade Journal  |  📅 Calendar  |  💼 Accounts  |  📈 Analytics  |  🌐 Community
```

Hotkey: **`g > y`** (mnemonic: "go > analYtics" — `g > a/c/t` already taken).

## 4. Page layout

Single long-scroll page. Top: header + filters. Below: 4 sections, each in a card-style container.

```
┌──────────────────────────────────────────────────────────────────┐
│ Analytics                                  [Import][Export][...]  │
│ Detailed performance analysis across N trades                    │
│                                                                   │
│ RANGE  [All time] [30d] [90d] [MTD] [QTD] [YTD] [12mo] [Custom]  │
└──────────────────────────────────────────────────────────────────┘

┌── EQUITY ──────────────────────────────────────────────────────┐
│  KPI strip: Peak P&L · Max DD · Current DD · Longest Underwater│
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ Equity Curve         [Drawdown overlay] [Live unrealized] │ │
│  │ ECharts line + drawdown overlay (dual axis)               │ │
│  └───────────────────────────────────────────────────────────┘ │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ Drawdown Panel — time underwater area chart               │ │
│  └───────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘

┌── PERFORMANCE ─────────────────────────────────────────────────┐
│  ┌─────────────────────┐  ┌─────────────────────┐              │
│  │ P&L Histogram       │  │ Hourly Performance  │              │
│  │ [Day][Week][Mon][Yr]│  │ 6AM ─── 8PM bars    │              │
│  └─────────────────────┘  └─────────────────────┘              │
│  ┌─────────────────────┐  ┌─────────────────────┐              │
│  │ Day of Week         │  │ Win/Loss Streaks    │              │
│  │ Mon Tue Wed Thu Fri │  │ progression bars    │              │
│  └─────────────────────┘  └─────────────────────┘              │
└────────────────────────────────────────────────────────────────┘

┌── DISTRIBUTION ────────────────────────────────────────────────┐
│  ┌─────────────────────┐  ┌─────────────────────┐              │
│  │ Long vs Short       │  │ P&L Distribution    │              │
│  │ side-by-side bars   │  │ histogram by bucket │              │
│  └─────────────────────┘  └─────────────────────┘              │
│  ┌─────────────────────┐  ┌─────────────────────┐              │
│  │ R-Multiple Dist     │  │ Rolling Win Rate    │              │
│  │ <-2R … >+2R buckets │  │ [10][20][50][100]   │              │
│  └─────────────────────┘  └─────────────────────┘              │
└────────────────────────────────────────────────────────────────┘

┌── ATTRIBUTION ─────────────────────────────────────────────────┐
│  ┌─────────────────────┐  ┌─────────────────────┐              │
│  │ P&L by Setup        │  │ P&L by Symbol       │              │
│  │ [P&L][Count][WinRt] │  │ [P&L][Count][WinRt] │              │
│  └─────────────────────┘  └─────────────────────┘              │
│  ┌─────────────────────┐  ┌─────────────────────┐              │
│  │ Win Rate by Setup   │  │ Avg R by Setup      │              │
│  │ horizontal bars     │  │ horizontal bars     │              │
│  └─────────────────────┘  └─────────────────────┘              │
│                                                                 │
│  Symbol Performance Mini-Cards (grid of 4-6 per row)            │
└────────────────────────────────────────────────────────────────┘
```

## 5. Time-range filter

Reused from Calendar's pattern (and TWI's dashboard). 8 preset pills + Custom date picker. Defaults to **All time**. State stored in URL (`?from=2026-01-01&to=2026-04-18`).

```
RANGE  [All time] [Last 30d] [Last 90d] [MTD] [QTD] [YTD] [Last 12mo] [Custom]
```

Custom opens a date-range picker (two date inputs + Apply button).

Filter reduces the trade set used for **every** chart on the page. Single source of truth: a `dateRange` state in `AnalyticsTab.jsx` passed down to all sub-components and the API call.

## 6. Backend

### 6.1 Single mega-endpoint

```
GET /api/j2/analytics?account_id=<id>&from=<iso_date>&to=<iso_date>
```

Returns one payload with **all chart data pre-aggregated** server-side. Reasoning:
- Single round-trip — page renders instantly when data arrives
- Aggregation in Python is faster than shipping raw trades + computing in JS
- Average user payload is < 50 KB compressed (small enough)
- If perf becomes an issue with 10k+ trade users, extract per-section endpoints

`account_id` is optional (NULL = all accounts). `from` / `to` default to "all time" if omitted.

### 6.2 Response shape

```json
{
  "tradeCount": 47,
  "dateRange": { "from": "2026-01-01", "to": "2026-04-18" },

  "equity": {
    "kpis": {
      "peakPnl": 1240.50,
      "maxDrawdown": -340.00,
      "maxDrawdownPct": -0.0273,
      "currentDrawdown": -50.00,
      "longestUnderwaterDays": 12
    },
    "curve": [
      { "date": "2026-01-01", "equity": 100000, "drawdown": 0 },
      { "date": "2026-01-02", "equity": 100120, "drawdown": 0 },
      ...
    ]
  },

  "performance": {
    "byDay":   [{ "date": "2026-04-19", "pnl": 83.00 }, ...],
    "byWeek":  [{ "weekStart": "2026-04-13", "pnl": 100.00 }, ...],
    "byMonth": [{ "month": "2026-04", "pnl": 423.00 }, ...],
    "byYear":  [{ "year": 2026, "pnl": 2403.00 }, ...],
    "hourly":  [{ "hour": 7, "pnl": 0.00, "tradeCount": 0 }, ..., { "hour": 19, "pnl": 140.00, "tradeCount": 1 }],
    "dayOfWeek": [{ "day": "Mon", "pnl": 140.00, "tradeCount": 1 }, ...]
  },

  "distribution": {
    "longVsShort": {
      "long":  { "totalPnl": 223.00, "winRate": 1.0, "avgPnl": 44.60, "tradeCount": 5 },
      "short": { "totalPnl": 0.00,    "winRate": null, "avgPnl": null, "tradeCount": 0 }
    },
    "pnlBuckets": [
      { "bucket": "$140-$141", "count": 1 },
      { "bucket": "$141-$142", "count": 0 },
      ...
    ],
    "rMultiples": [
      { "bucket": "< -2R",  "count": 0 },
      { "bucket": "-2R..-1R", "count": 0 },
      { "bucket": "-1R..0R", "count": 0 },
      { "bucket": "0R..1R",  "count": 1 },
      { "bucket": "1R..2R",  "count": 2 },
      { "bucket": "2R..3R",  "count": 1 },
      { "bucket": "> 3R",    "count": 1 }
    ],
    "winLossStreaks": [
      { "index": 1, "type": "win",  "length": 5 }
    ]
  },

  "attribution": {
    "bySetup": [
      { "setup": "VCP",      "totalPnl": 423.00, "winRate": 0.83, "avgR": 1.92, "tradeCount": 6 },
      { "setup": "Breakout", "totalPnl": 180.00, "winRate": 0.67, "avgR": 1.40, "tradeCount": 3 }
    ],
    "bySymbol": [
      { "symbol": "AMD",  "totalPnl": 140.00, "winRate": 1.0, "avgPnl": 140.00, "tradeCount": 1 },
      { "symbol": "GME",  "totalPnl": 60.00,  "winRate": 1.0, "avgPnl": 60.00,  "tradeCount": 1 },
      ...
    ],
    "rollingWinRate": {
      "windows": {
        "10":  [{ "tradeIndex": 10, "winRate": 0.7 }, ...],
        "20":  [...],
        "50":  [...],
        "100": [...],
        "200": [...]
      }
    }
  }
}
```

### 6.3 Aggregation logic notes

- **Equity curve x-axis = ET trading day** (consistent with Calendar spec). Multiple closes on same day collapse to one point: end-of-day equity.
- **Drawdown calculation:** for each day, equity − running peak. `currentDrawdown` = drawdown at last day. `longestUnderwaterDays` = longest consecutive run of days where drawdown < 0.
- **Hourly buckets:** ET hour of `exit_date`. Buckets 0–23. Render shows 6AM-8PM range typically; off-hours bars exist if data does.
- **R-multiple buckets:** discrete: `< -2R, -2R..-1R, -1R..0R, 0R..1R, 1R..2R, 2R..3R, > 3R`. Trades with `null` R (entry == originalStop) are **excluded** from R-distribution + Avg R by Setup.
- **P&L distribution buckets:** dynamic — split P&L range into 20 equal-width buckets. Min/max from data, rounded to nice numbers.
- **Win/Loss Streaks:** sequence of consecutive same-result trades. Each entry = `{index, type, length}` for chart bars.
- **Rolling Win Rate windows:** for window N, at trade index i ≥ N, compute win rate over trades [i-N, i]. Skipped if total trades < N.
- **Setup attribution:** trades with `setup IS NULL` excluded from setup-related charts (no "(none)" bucket — reduces noise).
- **Symbol attribution:** sorted by `totalPnl` desc by default; client can re-sort.

### 6.4 Live unrealized equity (separate endpoint)

Equity Curve's "Live unrealized" toggle does NOT use the analytics endpoint (which is closed-trade only). Instead:

```
GET /api/j2/analytics/live-unrealized?account_id=<id>
```

Returns:

```json
{
  "asOf": "2026-04-18T20:42:00Z",
  "closedEquity": 100823.50,
  "openPositions": [
    { "symbol": "NVDA", "shares": 100, "entryPrice": 195.00, "currentPrice": 197.50, "unrealizedPnl": 250.00 }
  ],
  "unrealizedTotal": 250.00,
  "liveEquity": 101073.50
}
```

Client appends a final dashed point to the equity curve at `(now, liveEquity)`.

**Disabled in "All Accounts" mode** — semantics get fuzzy across multiple `accountSize` values. UI greys the toggle with tooltip "Select a single account."

## 7. Frontend / Components

### 7.1 New files

```
app/src/pages/journal-2-0/
├── tabs/
│   └── AnalyticsTab.jsx                 ← page shell + range filter + section mounts
├── components/analytics/
│   ├── RangeFilter.jsx                  ← 8-pill + custom range picker
│   ├── sections/
│   │   ├── EquitySection.jsx            ← KPI strip + chart + drawdown panel
│   │   ├── PerformanceSection.jsx       ← histogram + hourly + day-of-week + streaks (2x2)
│   │   ├── DistributionSection.jsx      ← long/short + p&l dist + r-mult + rolling WR (2x2)
│   │   └── AttributionSection.jsx       ← by-setup + by-symbol + rate/avg-R + symbol cards
│   ├── charts/
│   │   ├── EquityCurveChart.jsx         ← ECharts line w/ optional drawdown axis + live point
│   │   ├── DrawdownChart.jsx            ← ECharts area chart (time underwater)
│   │   ├── PnlHistogram.jsx             ← ECharts bars w/ Day/Week/Month/Year toggle
│   │   ├── HourlyChart.jsx              ← ECharts bars
│   │   ├── DayOfWeekChart.jsx           ← ECharts bars
│   │   ├── LongShortChart.jsx           ← ECharts grouped bars
│   │   ├── PnlDistChart.jsx             ← ECharts histogram
│   │   ├── RMultDistChart.jsx           ← ECharts histogram
│   │   ├── WinLossStreaksChart.jsx      ← ECharts bars (streak progression)
│   │   ├── RollingWinRateChart.jsx      ← ECharts line w/ window toggle
│   │   ├── BySetupChart.jsx             ← ECharts horizontal bars w/ sort toggle
│   │   ├── BySymbolChart.jsx            ← same shape as BySetupChart
│   │   ├── WinRateBySetupChart.jsx      ← horizontal bars
│   │   ├── AvgRBySetupChart.jsx         ← horizontal bars
│   │   └── SymbolMiniCards.jsx          ← grid of compact per-symbol cards
│   └── KpiStrip.jsx                     ← Peak/Max DD/Current DD/Longest Underwater pills
├── hooks/
│   ├── useJ2Analytics.js                ← SWR for /api/j2/analytics
│   └── useJ2LiveUnrealized.js           ← SWR for /api/j2/analytics/live-unrealized (only when toggle on)
└── lib/
    ├── analytics.js                     ← shared formatters, color helpers, empty-state copy
    └── echartsTheme.js                  ← shared ECharts theme matching var(--ut-gold) etc.
```

### 7.2 Shared ECharts theme

Single theme object reused by all charts:

```js
// lib/echartsTheme.js
export const j2EchartsTheme = {
  color: ['var-resolved-ut-gold', 'var-resolved-gain', 'var-resolved-loss', ...],
  backgroundColor: 'transparent',
  textStyle: { fontFamily: 'Instrument Sans, system-ui', color: '<text-bright>' },
  axisLine: { lineStyle: { color: '<border>' } },
  splitLine: { lineStyle: { color: '<border>', type: 'dashed' } },
  ...
}
```

CSS vars resolved at runtime via `getComputedStyle()` so theme switches propagate.

### 7.3 Range filter

`RangeFilter.jsx`. Pills + custom date picker (opens inline when Custom selected). Writes `?from=YYYY-MM-DD&to=YYYY-MM-DD` to URL via `useSearchParams`. Pill clicks compute the right `from`/`to` and write them.

### 7.4 KPI Strip

Above the equity curve. Four pills/cards:

- **Peak P&L** (max equity reached in range)
- **Max Drawdown** ($ + %)
- **Current Drawdown** (relative to all-time peak in range)
- **Longest Underwater** (in days)

Tooltips on each explain the metric.

### 7.5 Equity Curve chart

ECharts line. Two toggles in the header:

- **[Drawdown overlay]** — adds drawdown as a second series on right axis (red, area-filled below zero)
- **[Live unrealized]** — fetches live data, appends a dashed point past the last close

When a single point is hovered, tooltip shows: date, equity $, drawdown $, drawdown %.

### 7.6 P&L Histogram

Bars. Header toggle: **[Day] [Week] [Month] [Year]**. Default Month. Color: green for positive bars, red for negative. Empty buckets render as gray "no trades" stubs (not omitted).

### 7.7 By-Setup / By-Symbol charts

Horizontal bar charts. Sort toggle: **[P&L] [Trade count] [Win rate]**. Bars colored by P&L sign. Tooltip shows all three metrics.

### 7.8 Symbol Mini-Cards

Grid of compact cards (4-6 per row depending on viewport). Each card:
```
┌──────────────┐
│ AMD       1  │
│           trade
│ P&L  +$140   │
│ Win   100%   │
│ Pts   +14    │
│ Avg   +14    │
└──────────────┘
```

Sortable: click a header label to re-sort all cards.

### 7.9 Empty states

- **Zero trades in range** → all charts replaced with single empty card: "No trades in this range. Try expanding the date range or pick a different account."
- **Per-chart empty** (e.g. 0 short trades for Long vs Short) → chart still renders with empty side, label "No short trades in range"
- **Setup attribution empty** (no trades have setup tagged) → small "Tag your trades with a setup to see attribution" hint

## 8. State management

- **`useJ2Analytics({ accountId, from, to })`** — SWR over `/api/j2/analytics`. Cache key includes all three params. Refresh on focus disabled (data is stable per range).
- **`useJ2LiveUnrealized({ accountId })`** — SWR with refresh interval 15s when Live toggle is ON; SWR key only set when toggle is on (no fetch otherwise).
- **Range state** — URL-synced `from` / `to` via `useSearchParams`. Pill-button click computes dates and writes URL.
- **Per-chart toggles** (P&L histogram granularity, By-Setup sort, etc.) — local component state. Resets on tab change.

## 9. Account scoping

Inherits from Phase 2:
- `useJ2SelectedAccount()` provides `accountId` (or `null` for All Accounts)
- `useJ2Analytics` passes `accountId` to backend
- "All Accounts" view aggregates: payload covers trades from every account, weighted appropriately
- "Live unrealized" toggle disabled in "All Accounts" mode (per §6.4)

## 10. Error handling

- **Network error** → red banner above sections: "Couldn't load analytics. [Retry]"
- **Slow query** (> 3s) → skeleton loaders per section
- **Live unrealized fetch fails** → toggle stays on but final point not drawn; small inline error
- **ECharts render error** → caught at chart-component level; replaces chart with "Couldn't render this chart" stub; rest of page works
- **Time range with `from > to`** → client validation rejects; URL params normalized

## 11. Testing strategy

### 11.1 Backend (pytest)

`api/services/journal_two/test_analytics.py`:
- Empty trade set → all sections return zero/null structures (no crashes)
- Equity curve from a known trade sequence matches expected running balance
- Drawdown KPIs match hand-calculated values (test with synthetic data)
- Hourly bucket logic uses ET (DST transition test)
- R-multiple bucket boundaries (exactly -2R, exactly +1R go to right buckets)
- Setup attribution excludes null-setup trades
- Account scoping: `account_id=X` returns only X's trades; `account_id=null` returns all
- Date range: `from`/`to` filters correctly; trades exactly on boundaries included

### 11.2 Frontend (vitest)

- `RangeFilter.test.jsx` — pill click computes correct from/to, custom range opens picker
- `EquityCurveChart.test.jsx` — renders with closed data, toggles drawdown overlay, live toggle appends dashed point
- `KpiStrip.test.jsx` — renders all four KPIs, tooltips on hover
- `BySetupChart.test.jsx` — sort toggle re-orders bars, empty state when no setups
- `useJ2Analytics.test.js` — cache key stability across range changes
- `lib/analytics.test.js` — formatters

### 11.3 Integration

- Pick "Last 30d" → API called with correct from/to → all charts populated
- Switch account → all charts re-fetch + re-render
- Toggle Live Unrealized → live endpoint fetches → dashed point appears
- Switch to All Accounts → Live toggle greys out

## 12. Migration / rollout

- Code: shipped behind no flag — additive
- DB: no schema changes (purely read-side aggregation over existing `j2_trades`)
- Existing endpoints / tabs untouched
- Order of deployment: Phase 1 → Phase 2 → Phase 3 (this spec). Each independently shippable. Analytics relies on Phase 2 (Account selector) for the account_id filter — if Phase 2 isn't shipped yet, Analytics ignores account_id and aggregates all trades.

## 13. Phasing within Phase 3

Suggested commit cadence:

1. **Backend foundation** — `/api/j2/analytics` endpoint + aggregation logic + tests. No UI yet.
2. **Page shell + Range filter** — AnalyticsTab.jsx + RangeFilter + URL state. Empty section placeholders.
3. **Equity section** — KPI strip + Equity Curve chart (closed only) + Drawdown panel.
4. **Performance section** — P&L Histogram + Hourly + Day of Week + Win/Loss Streaks (4 charts).
5. **Distribution section** — Long vs Short + P&L Dist + R-Mult Dist + Rolling Win Rate (4 charts).
6. **Attribution section** — By-Setup + By-Symbol + Win Rate by Setup + Avg R by Setup + Symbol Mini-Cards.
7. **Live unrealized toggle** — backend endpoint + frontend integration on Equity Curve.
8. **Polish** — empty states, error handling refinement, tooltip copy, mobile responsive pass.

~4-5 days of work.

## 14. Open questions

| Q | A | Revisit when |
|---|---|---|
| Single mega-endpoint vs per-section? | Mega for v1; split if perf hits | Users have 5k+ trades and load > 3s |
| Live unrealized in All Accounts mode? | Disabled — semantics unclear | Users explicitly want it |
| Custom dimension breakdowns? | No (would need tagging features first) | Tagging spec lands |
| Exportable from Analytics tab? | No — Phase 4 Generate Report handles it | Phase 4 ships |
| Compare two ranges side-by-side? | No (v2 feature) | Users ask |
| Auto-refresh closed-equity on new trade? | No, manual refresh only | Trade-write events get a pub/sub system |

---

**End of spec.** Ready for review.
