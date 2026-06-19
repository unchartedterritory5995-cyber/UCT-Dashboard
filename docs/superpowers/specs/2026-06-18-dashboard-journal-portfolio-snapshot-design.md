# Dashboard Journal Portfolio Snapshot — Design

**Date:** 2026-06-18
**Status:** Approved (brainstorm)

## Goal

Replace the `CompassTodayTile` ("🧭 Compass · Today") on the Dashboard with a
**Robinhood-style portfolio snapshot** of the user's Journal 2.0 open positions:
balance + performance hero, plus a short list of open positions with their live
performance. The whole tile click-throughs into `/journal?j2tab=positions`.

The old `CompassTodayTile` files stay in the repo, **unused (dormant)** — Compass
coaching remains fully reachable inside `/journal`.

## Non-goals (v1)

- No new backend. Reuse existing J2 endpoints + the dashboard live-price store.
- No true equity-curve sparkline (we don't store intraday portfolio-value history
  on the web side outside broker snapshots). Deferred.
- No cash+equity account balance (needs broker net-liq for all users). Hero uses
  live open-position market value instead.

## Data sources (all existing)

- `GET /api/j2/positions` (unscoped → **all accounts**) — open equity positions.
- `GET /api/j2/options?status=open` (unscoped) — open option strategies.
- `useLivePrices(symbols)` — shared 2s live-price store → `{ price, change_pct }`.
- `lib/journal-2-0`: `portfolioAggregates`, `positionPnlDollar/Percent`,
  `money/moneySigned/percent`.
- `pages/journal-2-0/lib/optionCalcs`: `prettyStrategyType`,
  `computeDaysToExpiration`, `classifyDebitCredit`.

The dashboard tile fetches positions/options **unscoped** (its own small SWR
calls), independent of the Journal's selected-account state, so it always shows
the whole book.

## Layout

`TileCard` titled **📓 Journal · Positions**, whole tile is a `<Link>` to
`/journal?j2tab=positions`.

1. **Hero** — large portfolio value = Σ (live price × shares) over equity
   positions, via `portfolioAggregates`. Below it, two performance figures:
   - **Today** — Σ today's $ change (`shares × (price − prevClose) × sideSign`,
     `prevClose = price / (1 + change_pct/100)`), with %, colored.
   - **Open P&L** — `portfolioAggregates.unrealized` ($ and % vs cost basis),
     colored.
2. **Holdings list** — open positions, sorted by |today's $| desc, capped at 6.
   - Equity row: symbol · side · shares · live price · today $/%.
   - Option row: `build…`-style label (underlying · strategy · DTE) · debit/credit
     net · broker value/P&L if `broker_current_value` present, else greyed "—".
   - "+ N more →" footer when truncated.
3. **States** — loading ("Loading positions…"); empty ("No open positions yet" +
   "Open your journal →"); per-symbol missing live price → "—" (never a wrong
   number, matching the real Open Positions tab).

## Numbers — honesty rules

- Equity drives the hero value + Today + Open P&L (true mark-to-market).
- Options have **no live option quotes** in-app (Greeks/chain out of scope).
  Broker-imported strategies may carry `broker_current_value` → use it; manual
  strategies show cost basis with greyed P&L. Options count toward the position
  count but a manual option's missing mark never fabricates a value.
- Missing live price for an equity symbol → that row and its contribution are
  skipped from sums (matches `portfolioAggregates`), shown as "—".

## Files

- `app/src/components/tiles/JournalSnapshotTile.jsx` (new)
- `app/src/components/tiles/JournalSnapshotTile.module.css` (new)
- `app/src/components/tiles/JournalSnapshotTile.test.jsx` (new)
- `app/src/pages/Dashboard.jsx` — swap `CompassTodayTile` → `JournalSnapshotTile`
  in both the desktop stack and the mobile stack.

## Test plan

Vitest: overview math (value + Today + Open P&L from mocked positions/prices),
empty state, loading state, options row rendering, click-through href. Mock the
two J2 fetches + `useLivePrices`.
