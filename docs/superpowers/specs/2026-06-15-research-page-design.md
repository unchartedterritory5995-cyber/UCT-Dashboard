# Equity Research Page (`/research/:sym`) — Design

**Date:** 2026-06-15
**Status:** Approved design, pre-implementation
**Goal:** A premium, paid, MarketSurge / EarningsWhispers / EarningsHub–class
equity research surface — a complete, aesthetic, comprehensive view of a
stock's earnings + fundamentals, anchored by proprietary **UCT Ratings**.

---

## 1. Summary

Today earnings/fundamental depth lives in a long-scroll `EarningsModal`
(~18 stacked sections). To compete with the named products we build a
dedicated full-page research surface at **`/research/:sym`** with a persistent
header and **seven tabs**. The existing modal is retained as a free
"10-second peek" from the calendar and gains an **"Open full report →"**
button that deep-links into the page (an **"Unlock full research →"** upsell
for free users, since the page is paid-only).

The marquee differentiator is the **UCT Ratings** system — a 0–99 Composite
plus component ratings (EPS, Relative Strength, Growth, Value, SMR,
Accumulation/Distribution, Sponsorship), a "Stock Checkup" pass/fail
checklist mapped to the UCT knowledge base, and peer ranking within
sector/industry. This ties best-in-class data to *our* proprietary scoring —
something EarningsWhispers/EarningsHub don't have and MarketSurge gates
behind IBD.

## 2. Goals / Non-Goals

**Goals**
- One comprehensive, bookmarkable, SEO-able page per ticker.
- Match-or-beat the data depth of MarketSurge (fundamentals + ratings),
  EarningsWhispers (whisper/expected-move/surprise history), and
  EarningsHub (estimates + transcripts + reactions).
- Proprietary UCT Ratings as the headline differentiator.
- Reuse existing endpoints and the app's cartographer dark+gold aesthetic.
- Ship in working phases (a usable page early, deepened over time).

**Non-Goals (v1)**
- Live option chains / full Greeks / IV surface (heaviest lift — deferred;
  expected-move via ATM straddle is retained from existing code).
- Real-time intraday financial-statement updates (statements refresh on the
  data cadence below, not live).
- Replacing the `EarningsModal` (it stays as the free quick-peek).
- A universe-wide screener built on these ratings (future; the ratings DB
  this produces makes it possible later).

## 3. Surface, Routing, Access

- **Route:** `/research/:sym` (React Router). `sym` upper-cased; unknown/
  malformed symbols render a friendly "not found / search" state.
- **Entry points:**
  - Calendar quick-peek modal → "Open full report →" button.
  - Ticker clicks app-wide (additive; existing `TickerPopup` unchanged for
    now — a later pass can add an "Open research →" affordance).
  - Header **SymbolSearch** (reuse `components/chart/SymbolSearch.jsx`) to
    jump tickers without leaving the page.
  - Direct URL / bookmark / external link.
- **Access tier — PAID ONLY.** The page is **not** in `FREE_PAGES`.
  `AuthGuard` enforces an active plan. Free/unauthenticated users hitting
  `/research/:sym` get a **paywall teaser** (blurred preview + value props +
  upgrade CTA) rather than a hard redirect, so the surface still converts.
  The calendar modal remains free; its "Open full report" becomes
  "🔒 Unlock full research" for non-paid users → routes to upgrade.
- **Nav:** not a left-sidebar tab (it's ticker-scoped, reached contextually).
  Optionally a future "Research" entry that opens search.

## 4. Page Header (persistent across tabs)

- Company logo (`CompanyLogo`, large), ticker · name, exchange ·
  sector — industry.
- Live price + day change (`useLivePrices`), post-earnings gap when fresh.
- Next/last earnings date + BMO/AMC + countdown; implied expected move ±%.
- **UCT Ratings badge row:** Composite (hero) + 7 components.
- Actions: ⚑ flag, 🔔 alert, add-to-watchlist (reuse `TickerActions`),
  SymbolSearch to switch tickers.

## 5. Tabs

### 5.1 Overview (snapshot)
- Mini price chart with earnings markers + post-print reaction stats
  (avg abs move, up/total quarters) — reuse `StockChart` + enrichment
  `hist_stats`.
- Latest report card: EPS/Rev est vs actual + surprise + verdict; whisper
  vs consensus; beat streak.
- Key-stats strip: mkt cap, P/E, fwd P/E, PEG, beta, div yield,
  short % float, 52-wk range.
- Analyst view: consensus buy/hold/sell + price-target low/mean/high.
- AI snapshot (2–3 sentences) — reuse existing earnings-analysis AI.

### 5.2 Financials (MarketSurge core)
- **Annual** EPS & sales growth grid (last 5 FY) with YoY %.
- **Quarterly** EPS & sales growth grid (last 8 Q) with YoY %.
- Margin trend: gross / operating / net (8 Q or 5 FY) — sparklines.
- Profitability: ROE, ROA.
- Balance sheet: cash, total debt, debt/equity, current ratio, FCF.
- Cash flow: operating CF, capex, FCF trend.
- Growth cells **heat-shaded** (green acceleration / red deceleration).

### 5.3 Estimates
- Forward EPS & revenue estimates (next 4 Q + next 2 FY).
- Revision trends (up/down counts, last 30/90d).
- Whisper number vs consensus (labeled honestly re: derivation).
- Surprise-accuracy history (EPS & rev, last 8–12 Q) as bars.
- Guidance (management) vs street.
- Recent analyst rating changes (firm, action, PT).

### 5.4 Ratings (UCT proprietary — the differentiator)
- **UCT Composite (0–99)** hero gauge + plain-English summary.
- Component gauges with "why" copy: EPS, Relative Strength, Growth, Value,
  SMR (letter), Accumulation/Distribution (letter), Sponsorship (letter).
- **Stock Checkup**: pass/fail/neutral checklist mapped to UCT KB criteria,
  each row showing the actual value.
- **Peer rank**: percentile within sector & industry, per component.
- See §7 for the methodology.

### 5.5 Ownership
- Institutional ownership % + fund-count trend (rising/falling).
- Top institutional holders.
- Insider activity (buys/sells, last 3–6 mo) — **endpoint already exists**
  (`/api/insider`), wire it in here.
- Short interest, short % float, days-to-cover, squeeze context, float,
  shares outstanding.

### 5.6 Calls & Transcript
- AI call recap: headline, sentiment, bullets, guidance, Q&A highlights,
  rating changes (existing `/api/earnings/call-recap`).
- Full verbatim transcript + keyword search + 🔊 TTS Listen (existing AV
  transcripts + earnings audio).
- Sentiment gauge; key quotes from prior call.

### 5.7 Filings & Events
- SEC filings (EDGAR) 10-K / 10-Q / 8-K (existing `/api/filings`).
- Dividends: ex/pay date, yield, payout ratio, history (existing
  `/api/calendar/dividends`).
- Splits & corporate actions.
- News (RSS) + recent tweets (existing).

## 6. Data Layer

Reuse existing endpoints wherever possible; add a small number of new ones.

| Need | Source | Status |
|------|--------|--------|
| Income / balance / cash-flow statements | FMP `stable/income-statement`, `…/balance-sheet-statement`, `…/cash-flow-statement`; yfinance fallback | **NEW** endpoint `/api/research/financials/{sym}` |
| Metrics (margins, ROE, ratios, 52w, short float) | Finnhub `/stock/metric?metric=all`; FMP `stable/ratios`; yfinance | Extend existing `fundamentals` service |
| Forward estimates + revisions | Finnhub estimate trends; FMP analyst estimates | **NEW** `/api/research/estimates/{sym}` |
| Analyst consensus + targets + rating changes | Finnhub (existing `/api/earnings/intel`, `call-recap`) | Reuse |
| Surprise / beat history, expected move, hist reactions | existing `/api/earnings-analysis`, `/api/calendar/enrichment` | Reuse |
| Institutional ownership / top holders | FMP `institutional-holder`; Finnhub ownership | **NEW** `/api/research/ownership/{sym}` |
| Insider activity | existing `/api/insider` | Reuse (wire in) |
| Short interest | FMP short-interest; Finnhub | folded into ownership endpoint |
| UCT Ratings | new ratings service + universe job (see §7) | **NEW** `/api/research/ratings/{sym}` |
| Transcript / call recap / sentiment / audio | existing earnings_intel + av_transcripts | Reuse |
| Filings / dividends / splits / news / tweets | existing routers | Reuse |

**Caching & cost.** New financial-statement/metrics/ownership endpoints
cache per-ticker on disk (statements 24–48 h, metrics 12 h, ownership 24 h),
following the existing `bars_disk_cache` / fundamentals TTL idiom. AI calls
(recap, snapshot, sentiment) keep their existing cost-guards and caches —
no new uncapped LLM spend.

## 7. UCT Ratings Methodology

All component ratings are **percentile ranks (0–99) against the cap_universe
distribution** (letters A–E are percentile buckets), except where noted.
A nightly background job (pattern: `breadth_collector` / RS rankings)
computes rating inputs across `cap_universe.json` and stores them in a new
SQLite DB **`/data/research_ratings.db`**; per-ticker reads percentile
against the stored distribution. Cold/missing tickers fall back to a
sector-peer percentile and queue for the next universe pass (prewarmer
idiom). **This universe job is the central technical risk** and is built in
Phase 4 with the Ratings tab.

- **EPS Strength (0–99):** percentile of recent quarterly + annual EPS
  growth (YoY), weighted to the two most recent quarters. (IBD EPS-Rating
  analogue.)
- **Relative Strength (0–99):** price performance vs universe over 3/6/12 mo
  (weighted). **Reuse the existing RS-rankings computation** (cap-universe
  6-month bars already cached).
- **Growth (0–99):** composite of revenue-growth + EPS-growth *acceleration*
  (recent vs trailing), percentile.
- **Value (0–99):** inverse-percentile of valuation multiples (P/E, fwd P/E,
  PEG, EV/EBITDA, P/B). Cheaper ⇒ higher. (High-growth names score low — by
  design.)
- **SMR (A–E):** Sales growth + Margin level/trend + ROE composite, bucketed.
- **Accumulation/Distribution (A–E):** up/down volume ratio over ~13 weeks
  (price-volume from cached bars), bucketed.
- **Sponsorship (A–E):** institutional ownership quality + fund-count trend.
- **UCT Composite (0–99):** weighted blend, momentum/growth-leaning per UCT
  KB philosophy. **Initial weights (tunable):** EPS 0.25, RS 0.25, Growth
  0.20, SMR 0.15, Acc/Dis 0.10, Value 0.05. Weights live in one constants
  module for easy tuning.
- **Stock Checkup:** explicit pass/fail/neutral rules from the UCT KB
  (e.g. EPS growth ≥25% last 2 Q; sales growth ≥20%; ROE ≥17%; RS ≥80;
  within 15% of 52-wk high; margins expanding; manageable debt/equity;
  rising institutional sponsorship). Each row surfaces the actual value.
- **Peer rank:** percentile within sector & industry for Composite + each
  component, from the same universe distribution.

Every rating shows a plain-English explanation and its as-of date.
Derived/estimated values (e.g. whisper, sector-peer fallback percentiles)
are visually labeled so we never imply false precision.

## 8. Aesthetic

App cartographer dark + gold language (`--cal-*` / app tokens). Rating
gauges/rings reuse the **breadth-views** visual vocabulary
(`useBreadthViews` styles). Per-metric sparklines; growth tables heat-shaded
(green accel / red decel) using the breadth 8-tier heat idea. Large logos.
Dense like MarketSurge but with the app's polish. Responsive: header wraps,
tabs become horizontally scrollable, the Overview two-column grid stacks on
phones (640px / 1024px canonical breakpoints).

## 9. Component Architecture (frontend)

```
app/src/pages/research/
  ResearchPage.jsx            # route shell: header + tab bar + active tab
  ResearchHeader.jsx          # logo/price/earnings/ratings badges/actions
  RatingBadges.jsx            # the badge row + shared gauge
  tabs/OverviewTab.jsx
  tabs/FinancialsTab.jsx
  tabs/EstimatesTab.jsx
  tabs/RatingsTab.jsx         # gauges + Stock Checkup + peer rank
  tabs/OwnershipTab.jsx
  tabs/CallsTab.jsx
  tabs/FilingsTab.jsx
  components/{GrowthGrid,MetricSparkline,RatingGauge,StatStrip,Paywall}.jsx
  hooks/{useFinancials,useEstimates,useOwnership,useRatings}.js
  ResearchPage.module.css
```
Each tab is independently loadable and lazy — a tab fetches its own data on
first activation (no monolithic payload). Tabs are individually testable.

## 10. Backend Architecture

```
api/routers/research.py                 # /api/research/* endpoints
api/services/research/
  financials.py                         # statements + growth grids
  estimates.py                          # forward + revisions + whisper
  ownership.py                          # institutional + insider + short
  ratings.py                            # per-ticker rating assembly + checkup
  ratings_universe.py                   # nightly universe job → ratings DB
  ratings_db.py                         # /data/research_ratings.db CRUD
```
Ratings DB seeded/refreshed by the nightly job; per-ticker endpoint reads it
+ computes peer percentiles. Follows the cot.db / modelbook.db ownership
pattern (dashboard-owned SQLite on the Railway volume).

## 11. Phasing

1. **Scaffold + Overview** — route, paywall guard, header, ratings-badge
   *placeholders*, Overview tab on existing endpoints; modal "Open full
   report →" link. (Usable page ships here.)
2. **Financials** — statement endpoints + annual/quarterly growth grids +
   margin/balance/cash-flow + heat shading.
3. **Estimates** — forward estimates, revisions, whisper, surprise-accuracy,
   guidance, rating changes.
4. **Ratings** — `research_ratings.db` + nightly universe job + ratings
   service + Ratings tab (gauges, Stock Checkup, peer rank); fill the header
   badges with real values.
5. **Ownership** — institutional + insider wire-in + short interest.
6. **Calls + Filings/Events** — surface existing recap/transcript/filings/
   dividends/splits/news/tweets.
7. **Aesthetic polish** — gauges, sparklines, heat tuning, responsive QA,
   paywall teaser polish.

Per project convention, phases run end-to-end before a dedicated polish pass.

## 12. Testing

- Backend: per-service unit tests (statement parsing, growth math, rating
  percentile/bucket logic, checkup rules, universe-job aggregation) following
  the `tests/test_*` idiom; rating math property-tested where sensible.
- Frontend: per-tab vitest (renders with mock data, empty/loading/error
  states, paywall gate, tab switching). No hooks-in-loops (calendar
  enrichment lesson).
- Build green (`npm run build`) before each push; object-form manualChunks
  preserved.

## 13. Risks / Open Items

- **Universe ratings job cost/perf** — fundamentals across ~3,685 tickers is
  heavy. Mitigation: nightly batch + disk cache + sector-peer fallback for
  cold tickers + prewarmer-style backfill. Revisit cadence/scope in Phase 4.
- **FMP plan coverage** — confirm `stable/*` statement + estimate endpoints
  return on the current plan (the working-set is documented; verify in
  Phase 2/3, fall back to yfinance/Finnhub).
- **Whisper numbers** — no licensed true-whisper feed; derive a proxy and
  label it honestly, or omit if it can't be made trustworthy.
- **Paywall UX** — teaser must entice without leaking the full paid dataset.
- **Partner branch** — avoid touching partner-owned files
  (`OptionsFlow.jsx`, `schwab_router.py`); this work is in new `research/`
  namespaces, so collisions are unlikely.

## 14. Reused Existing Assets

`EarningsModal`, `CompanyLogo`, `StockChart`, `SymbolSearch`,
`TickerActions`, `useLivePrices`, breadth-views styles, and the existing
earnings/fundamentals/filings/intel/transcript/insider/dividends endpoints.
New code is additive under `pages/research/`, `routers/research.py`,
`services/research/` — no changes to Journal/Calendar internals beyond the
modal's "Open full report" button.
