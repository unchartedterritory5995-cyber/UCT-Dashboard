# Robinhood-Style Journal — Design & Roadmap

**Date:** 2026-07-01
**Brand direction (user):** Robinhood *layout + functionality*, dressed in UCT's dark/gold brand (not a literal light-mode clone). Gains green / losses red per RH; UCT gold stays for chrome.
**Scope (user):** all four surfaces — portfolio home + graph, RH holdings list, per-stock detail pages, RH options view. Built in phases; accurate live net-liq is the foundation and ships first.

Grounded in 4 parallel research passes (RH portfolio home/graph, holdings/detail, options/return-semantics — from RH Help Center + verified App Store screenshots — plus a codebase data-availability audit). Confidence tags: [C]=confirmed first-party/screenshot, [M]=medium, [V]=verify-in-app.

---

## Robinhood ground truth (the facts we build to)

### Return / value math (correctness-critical — [C] unless noted)
- **Portfolio value** = cash + market value of all holdings (net-liq).
- **1D "Today"** = return vs the **previous trading day's 4:00 PM ET close**; external cash flows excluded (Modified Dietz). Per-position today = `shares × (price − prevClose)`; portfolio today = Σ of those. Today % = todayΔ ÷ previous-close portfolio value.
- **Total return** (position) = `(price − averageCost) × shares`. Average cost is a P&L basis, explicitly **not** tax cost basis.
- **Non-1D ranges** rebaseline to the **window start** (current vs value at start of 1W/1M/3M/YTD/1Y/ALL) [M — behaviorally certain].
- **Line color** = green if last value in frame > first, else red (per selected window). 1D dotted baseline = prev close; green above / red below.

### Portfolio home layout (top→bottom) [C from screenshots]
1. Account-type label + caret (dropdown picker; "Investing"/account name).
2. Big portfolio value.
3. Today's-change line: colored **triangle** ▲/▼ + `$X.XX (Y.YY%)` + inline session label (`Today` regular; during extended hours a **second stacked row** labeled `Overnight`/`After-Hours`).
4. Interactive line graph (scrub: value+time follow finger; vertical scrub indicator; dotted baseline).
5. **Range tabs BELOW graph: `1D 1W 1M 3M YTD 1Y ALL`** (7; selected = filled pill).
6. **Buying Power** row (label left, `$` + `>` chevron right).
7. `Stocks & ETFs` section header → holdings rows.

### Holdings row [C] — minimal
Left: ticker (bold) + share count (gray, "2 shares"). Center: mini sparkline. Right: current value/price in a **color-filled pill** (green up / red down). No company name, no numeric $/% change, no logo in RH's real row.
→ **UCT adaptation:** keep it minimal but add the UCT `CompanyLogo` (we have it, looks good) + keep the colored price pill; optional today-% since our users expect it. Table view stays as a toggle.

### Per-stock detail page order [C presence, M sequence]
Header → Chart(+ranges) → Your Position (Shares · Market value · Average cost · Portfolio diversity · Today's return · Total return) → About(blurb only) → Stats → Short Interest → News → Analyst Ratings(Buy/Hold/Sell % + count, past 100d; Buy=Buy+Overweight, Sell=Sell+Underweight) → Earnings(EPS est vs actual) → History(your trades) → (Gold/gated extras skipped).
Stats list is CLOSED: Market cap · P/E · Div/Yield · Avg volume · High/Low today · Open · Volume · 52wk High/Low · Short inventory · Borrow rate. **No EPS/beta/shares-outstanding.**

### Options [C]
List/detail shows contract label (`AAPL $150 Call 12/20`), qty, today, total return, mark. Options **section charts net options performance**, not market value. Greeks / chance-of-profit / live option quotes = **not available** (broker mark only) → out of scope.

### Design system
Gains green / losses red app-wide. RH auto-inverts theme by session (our dark = its off-hours look). No official hex — tune our own green/red; keep UCT gold for brand chrome. Range/pill accent = neon green in RH → we use UCT tokens.

---

## Our data (audit result — mostly reuse)

| Need | Status | Source |
|---|---|---|
| Live price + `prev_close` + `change_pct` per ticker | reuse | `/api/live-prices`, `useRealtimePrices` |
| Account cash / buying power / total equity / market value | reuse | `/api/j2/accounts` → `brokerCash,brokerBuyingPower,brokerTotalEquity,brokerMarketValue` |
| Option market value | reuse | strategy `brokerCurrentValue` (⚠ FE bug: JournalSnapshotTile reads snake `broker_current_value`) |
| Longer-range equity series (daily) | reuse | `/api/j2/broker/performance?period=` → `equitySeries` |
| Intraday bars per ticker | reuse | `/api/bars/{t}?tf=5` (1 ticker/call — **fan-out**, no batch) |
| Company logo | reuse | `<CompanyLogo sym/>` → `/api/ticker-logo` |
| StockChart (detail graph) | reuse | `<StockChart>` |
| Stats (mktcap/PE/52wk/divyield/avgvol) | reuse | `/api/fundamentals/{t}`, `/api/research/snapshot/{sym}` |
| Analyst ratings + PT | reuse | `/api/earnings/analyst-grades/{t}` |
| Per-ticker news | reuse | `/api/chart-news/{t}` |
| Earnings est vs actual | reuse | `/api/fundamentals/earnings-table` |
| UCT proprietary ratings (augment) | reuse | `/api/research/ratings/{sym}` |
| Intraday portfolio curve (1D) | **NEW (client fan-out)** | bars ×N + sum×shares + cash |
| Company "About" blurb | **NEW (1 field)** | add `longBusinessSummary` to `ticker-meta`/`research-snapshot` |
| Prior-day equity for "Today" | derive | per-position `prev_close` (best) or `equitySeries[-2]` |
| Options greeks/quotes | out of scope | none exist |

---

## Phase 1 — Accurate live net-liq + RH portfolio hero

### 1a. Correctness fix (ship first — the active bug: our $11,438 vs RH $10,919, Today $0.00 vs −$588)
Root cause: headline anchored to broker-reported `brokerTotalEquity` (SnapTrade serves it stale/prev-close for RH) + ~0 reconcile drift → today's move invisible.

**Fix — compute net-liq directly (RH's method), on BOTH `BrokerAccountHero` and `JournalSnapshotTile`:**
```
currentPrice(p)   = livePrice(p) ?? p.brokerPrice          // per-share
signedShares(p)   = p.side==='Short' ? -shares : +shares
netLiq = brokerCash
       + Σ_equity  ( currentPrice(p) × signedShares(p) )
       + Σ_option  ( brokerCurrentValue )                   // signed; camelCase!
```
- New pure helper `brokerNetLiq(account, positions, optionStrategies, prices) -> { value, marketValue }`.
- Fallback: if `brokerCash == null` → fall back to `brokerTotalEquity` (never show garbage).
- **Today** (folded into one `brokerLiveSummary(account, positions, optionStrategies, prices, todayISO) -> { netLiq, marketValue, today, todayPct }` helper):
  per equity position, reference = **entry price if opened today** (`entryDate === today` → RH measures same-day entries from your fill, starting ~$0, not the overnight gap), **else `prev_close`** (from live-prices). `today$ = Σ signedShares × (livePrice − ref)`; options ≈ 0 (no live option quote). **`todayPct = today$ / (netLiq − today$)`** — confirmed denominator = previous-close equity, reproduces RH's −5.12%. Off-session: `live` = last-session price (still present in the snapshot) so Today = last session's change, matching RH.
  - Extended-hours "After-Hours"/"Overnight" as a *separate* stacked delta = Phase 1b (RH shows it apart from the main Today, not folded in).
- **Supersedes** the reconcile-by-drift approach (`brokerLiveEquity` headline use + the market-session gate become obsolete for the headline — remove/replace). This is inherently self-consistent (both surfaces compute the same cash+holdings from the shared feed; off-session `livePrice→brokerPrice`/`prevClose` so both are stable and equal) → also closes the two-surfaces-disagree issue for good.
- Fix the `brokerCurrentValue` camelCase read in JournalSnapshotTile so options count.
- TDD the two helpers (long/short sign, cash debit, option contribution, missing-price fallback, Today vs prevClose). Verify in-browser it matches the RH number + shows today's move.

### 1b. RH hero visual + graph
- Big value; Today line with ▲/▼ + `$ (%)` + inline `Today` label (green/red); extended-hours 2nd stacked `After-Hours`/`Overnight` row [later refinement ok].
- **7 range tabs `1D 1W 1M 3M YTD 1Y ALL`** (expand current 1M/3M/1Y/All); selected = pill; change line + graph rebaseline per tab (1D=prev close, else window start); line green-above/red-below baseline.
- Scrub graph (hero already has drag-scrub SVG) + dotted baseline + value/time on scrub.
- **Buying Power** row.
- Graph data: longer ranges from `/api/j2/broker/performance` `equitySeries` (right edge overlaid with the corrected live net-liq); **1D = intraday reconstruction** (fan-out `/api/bars?tf=5` over holdings, align+sum×shares+cash; reuse `prefetchBars`; cap/caching to bound fan-out).

## Phase 2 — RH holdings list
Rows: `CompanyLogo` + ticker + share count + mini sparkline + colored price pill + today-% (UCT adaptation of RH's minimal row). Extract a reusable `<Sparkline>` (from the JournalSnapshotTile SVG). Sparkline data = `/api/bars?tf=D&bars=30` per holding (fan-out). Dense table kept behind a view toggle. Sort control (Symbol/Price/%/Equity/Today/Total return) mirroring RH.

## Phase 3 — Per-stock detail page
New route `journal/position/:sym`. Sections per RH order using the reuse map. `<StockChart>` for the graph; Your Position from J2 data (shares/avgCost/marketValue/today/total return/diversity); Stats/News/Analyst/Earnings from existing endpoints; **About** needs the one new `longBusinessSummary` field; augment Analyst with UCT ratings. Options greeks omitted.

## Phase 4 — RH options view
Option positions as contract cards (label/qty/mark/today/expiry) using `brokerCurrentValue`; net-options-performance mini chart. No greeks.

---

## Locked invariants
- Net-liq = cash + live holdings (NOT broker-reported total equity, which lags for RH). Today = Σ position (price − prevClose)×signedShares.
- Both surfaces compute the headline identically via the shared helpers + shared price feed.
- Options: broker mark only; contribute market value to net-liq, ~0 to Today; no greeks.
- Reuse existing endpoints/components per the audit; only new backend = intraday curve + `longBusinessSummary`.
- Gains green / losses red; UCT gold for chrome; keep the dense table as a toggle (don't delete existing functionality).

## Verify-in-app before hard-coding (from research)
Line-color basis on multi-day ranges; extended-hours dashed segment; scrub haptics/dot styling. These are 1b/graph polish, not correctness blockers for 1a.
