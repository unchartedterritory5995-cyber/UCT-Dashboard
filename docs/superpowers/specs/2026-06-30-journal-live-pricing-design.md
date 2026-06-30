# Journal Live Pricing & Account Value — Design

**Date:** 2026-06-30
**Status:** Approved (brainstorming) → ready for implementation plan
**Base branch:** `origin/master` (worktree `feat/journal-live-pricing`)

## Problem

The Journal 2.0 price surfaces refresh on a 2s/4s REST poll via `useLivePrices`
(shared `livePriceStore` singleton). The user wants **live streaming prices and
quotes** — tick-by-tick last price — across every journal price display, and the
**account value** to tick in real time too.

"Quotes" here means **real-time last price only** — no bid/ask/spread (the current
trade-tick stream is last-price; bid/ask would need a new feed, explicitly out of
scope). Live options pricing/Greeks also remain out of scope; option positions
keep the broker mark.

## Key existing infrastructure (reuse, don't rebuild)

`app/src/hooks/useRealtimePrices.js` already implements exactly the streaming we
want and is in production on charts + Theme Tracker:

- Opens an SSE to `/api/stream/prices?tickers=…` (Finnhub WebSocket tick-by-tick
  bridged server-side).
- **Internally composes `useLivePrices`** (the 2s REST poll) and per-field merges:
  REST provides session OHLC/volume/`prev_close`; stream overlays live
  `price`/`change_pct`/`updated_at`.
- Ships a silent-death watchdog, exponential-backoff reconnect (5→10→20s cap),
  15s heartbeat, and per-symbol `stale`/`fresh` tracking.
- Returns `{ prices, isLoading, isStreaming, staleSymbols }`.

Because it wraps `useLivePrices`, swapping a surface to `useRealtimePrices`
**keeps the 2s REST floor as automatic fallback** when the stream drops — no
blank states, no regression in the worst case.

## Approach (chosen: A — swap the hook per surface)

Replace `useLivePrices` → `useRealtimePrices` at each journal price surface.
Rejected alternatives:
- **B (shared journal stream provider):** one SSE for the union of journal
  tickers. Marginal benefit — journal surfaces rarely co-render (dashboard tile
  vs `/journal` are different routes; journal tabs show one at a time). Can be
  layered on later without rework if connection count ever matters.
- **C (make `useLivePrices` stream under the hood):** maximum leverage but
  app-wide blast radius (catalysts, breadth, mobile sheets) and uncontrolled
  streaming-cost change. Out of scope.

## Surfaces converted

All on `origin/master`:

| File | Current | Change |
|---|---|---|
| `pages/journal-2-0/tabs/OpenPositionsTab.jsx` (~L81) | `useLivePrices(symbols)` | → `useRealtimePrices(symbols)`; feeds table + stats bar + broker hero |
| `pages/journal-2-0/tabs/AnalyticsTab.jsx` `EquitySection` (~L317) | `useLivePrices` | → `useRealtimePrices`; live "now" equity point |
| `pages/journal-2-0/components/TraderDetail.jsx` (~L64) | `useLivePrices` | → `useRealtimePrices`; community trader open positions |
| `components/tiles/JournalSnapshotTile.jsx` (~L122) | `useLivePrices` | → `useRealtimePrices`; Dashboard "Journal · Positions" tile |
| `pages/journal-2-0/components/PositionsTable.jsx` | receives `prices` prop | **no change** — parent now feeds streamed prices |

**Manual accounts** need no calc change: `portfolioAggregates(positions, prices,
accountSize)` in `lib/journal-2-0/calculations.js` computes `value = Σ current ×
shares`; once fed streamed prices it ticks live. The existing no-cash-term manual
convention is preserved (account size is only used for invested/risk ratios).

## Broker headline → live mark-to-market

Broker (SnapTrade) accounts get their headline net-liq from a sync endpoint
(`/api/j2/broker/performance` / `account.brokerTotalEquity`), not live prices.
`account.brokerCash` and per-position `brokerPrice` (last synced mark) are
delivered raw to the client by `/api/j2/accounts` and `/api/j2/positions`.

New pure helper in `lib/journal-2-0/calculations.js`:

```
brokerLiveEquity(account, positions, prices) ->
   liveDelta = Σ over EQUITY positions of
        (livePrice − brokerPrice) × signedShares      // Short ⇒ −shares; long ⇒ +shares
   liveValue = account.brokerTotalEquity + liveDelta
   return { liveValue, liveDelta }
```

Rationale — **reconcile by construction:** start from the broker's authoritative
`brokerTotalEquity` and add only the *price drift since last sync*. At sync time
`livePrice === brokerPrice` ⇒ `liveDelta = 0` ⇒ `liveValue` exactly equals the
broker's number; intraday it drifts live with the market. This honors
broker-mirror fidelity (the synced number is the anchor) and sidesteps any
cash/sign reconstruction error. Guards:
- `livePrice` or `brokerPrice` missing ⇒ that position contributes 0 (no drift).
- Option positions contribute 0 (no live options pricing in scope).
- `account.brokerTotalEquity` null ⇒ return `{ liveValue: null, liveDelta: 0 }`
  so callers fall back to the synced display.

Consumers:
- `BrokerAccountHero.jsx`: headline = `liveValue` (ticks); the synced
  `endEquity`/`brokerTotalEquity` stays the reconciliation baseline. "Today" live
  = synced Today + `liveDelta`.
- `JournalSnapshotTile.jsx` `BrokerHero`: same treatment.

## Live affordance (UX)

Reuse `isStreaming` / `staleSymbols` from `useRealtimePrices`:
- Small **LIVE** badge when `isStreaming` (consistent with the chart stream badge).
- Subtle dimming on any symbol in `staleSymbols`.
- Stream down ⇒ silent fallback to 2s REST poll (already automatic via the
  composed `useLivePrices`). No blank states.

## Testing

- Extend `PositionsTable.test.jsx` and `JournalSnapshotTile.test.jsx` to mock
  `useRealtimePrices` (same return shape as `useLivePrices` plus `isStreaming`).
- New unit tests for `brokerLiveEquity` in `calculations.test.js`:
  1. at-sync (`livePrice === brokerPrice`) ⇒ `liveValue === brokerTotalEquity`,
     `liveDelta === 0`.
  2. long price move ⇒ correct signed `liveDelta`.
  3. short position ⇒ correct sign.
  4. option / missing-price positions contribute 0.
  5. `brokerTotalEquity` null ⇒ `{ liveValue: null, liveDelta: 0 }`.

## Out of scope (confirmed with user)

- Bid/ask/spread quotes.
- Live options pricing / Greeks (option positions keep the broker mark).
- Approach B/C streaming refactors.

## Invariants / risks

- `useRealtimePrices` keeps the REST floor — worst case is current behavior, never
  worse.
- Broker headline must reconcile to broker truth on every sync (delta=0 at sync).
- Each converted surface opens its own SSE; the stream backend dedups ticker
  subscriptions. Journal surfaces rarely co-render, so connection count stays low.
