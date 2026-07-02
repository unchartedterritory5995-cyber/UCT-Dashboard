# SSE Connection Pooling — Design

**Date:** 2026-07-02
**Status:** Approved (owner delegated design judgment; goal: launch-ready efficiency for ~200 users)

## Problem

Every `useRealtimePrices(tickers)` hook instance opens its **own** `EventSource`
to `GET /api/stream/prices?tickers=...`. There are 10+ call sites (StockChart,
TickerPopup, CatalystFlow, LeadershipTile, ThemeTracker, NHNLModal, Screener ×2,
UCT20, Watchlists, calendar FeedView), and the Dashboard mounts desktop + mobile
layouts simultaneously (CSS-hidden, not unmounted), so a single user holds
**4–8 concurrent SSE connections**. Each connection runs a dedicated async
generator loop on the server (250ms cadence) on the **single** event loop —
at 200 users that is 800–1,600 loops, the same load class that fed the
2026-07-01 524 outage.

Secondary waste: every connection independently applies the same `tick` /
`bar_close` / `bar_correction` events to the **global** `realtimeCandle` store —
N connections = N duplicate applies per tick.

## Goal

One shared SSE connection per browser tab (a small pool when the ticker union
exceeds the backend's 50-ticker/connection cap), with **zero behavior change**
for consumers of `useRealtimePrices` and **zero backend changes**.

## Non-Goals

- No changes to `api/routers/stream.py` or any backend code (the fragile
  live-price path stays untouched).
- `/api/stream/bars` (`useRealtimeBars`) is out of scope (env-gated, separate
  endpoint, one instance per chart is rare).
- `useLivePrices` REST polling is out of scope (already two-tier server-cached).

## Architecture

### New module: `app/src/lib/priceStreamManager.js`

A module-level singleton that owns all EventSource connections and fans events
out to subscribers.

**Public API:**

```js
// Subscribe a consumer. Returns an unsubscribe function.
// listener is called (no args) whenever prices/stale/connected state changes;
// consumers read state via the getters (snapshot-style, useSyncExternalStore-friendly).
subscribe(tickers: string[], listener: () => void): () => void

getPrices(): object        // global {SYM: {price, change_pct, updated_at, ...}} store
getStaleSymbols(): Set     // global stale-symbol set
isConnected(): boolean     // true when every active bucket's EventSource is open
_resetForTests()           // test-only: close everything, clear state
```

**Internal state:**

- `subscribers: Map<id, {tickers: Set, listener}>`
- `buckets: Array<{tickers: string[], es: EventSource|null, connected, retryDelay, reconnectTimer, watchdogTimer, lastMsg}>`
- `streamPrices: object` — single global accumulator (replaces per-hook state)
- `staleSymbols: Set` — global
- `rebuildTimer` — debounce handle for union changes

### Union + bucketing

On any subscribe/unsubscribe, compute the union of all subscribers' tickers,
sorted. Slice into buckets of ≤ `MAX_SSE_TICKERS = 50` (mirror of the backend
cap). Each bucket gets one EventSource at
`/api/stream/prices?tickers=<bucket>`.

Typical dashboard union is ≤ ~100 tickers → **1–2 connections instead of 4–8**.

### Reconnect on union change (debounced)

SSE subscriptions are fixed in the URL, so a changed union requires
reconnecting. Rules:

- Debounce rebuilds by **400ms** (`REBUILD_DEBOUNCE_MS`) so a page transition
  (several hooks unmounting + mounting within one render cycle) causes at most
  one rebuild.
- After debounce, diff each new bucket's ticker list against the existing
  bucket at the same index; **only reconnect buckets whose list changed**.
  Unchanged buckets keep their live EventSource.
- The global `streamPrices` store is **not cleared** on rebuild — last-known
  prices stay on screen and the 2s REST poll (`useLivePrices`) continues
  underneath, so the reconnect is visually invisible.
- Empty union → close all connections (no idle streams).

### Event handling (per bucket connection, ported from the hook)

- `onmessage` (price map) → merge into global `streamPrices`, notify listeners.
- `stale` / `fresh` → update global `staleSymbols`, notify.
- `tick` / `bar_close` / `bar_correction` → call the module-level
  `realtimeCandle.applyTick / applyBarClose / applyCorrection` **once**
  (this alone removes the N× duplicate-apply waste).
- `heartbeat` → refresh the bucket's `lastMsg` watchdog timestamp.
- `onerror` → close, exponential backoff 5s→10s→20s (reuse
  `STREAM_RECONNECT_CAP_MS`), reconnect that bucket only.
- Silent-death watchdog per bucket: no event (incl. heartbeat) for
  `STREAM_WATCHDOG_MS` → force-reconnect that bucket (reuse
  `STREAM_WATCHDOG_TICK_MS` cadence). Constants come from
  `app/src/utils/streamStatus.js` exactly as today.

### `useRealtimePrices` rewrite (public API unchanged)

The hook keeps its exact signature and return shape
`{ prices, isLoading, isStreaming, staleSymbols }`:

- Subscribes to the manager with its ticker list (keyed by the same
  `sorted` string it already computes); unsubscribes on unmount/change.
- Reads `getPrices()` / `getStaleSymbols()` / `isConnected()` via
  `useSyncExternalStore` (matching the codebase's existing store idiom in
  `videoStore`).
- Keeps the existing **per-ticker merge filter** (lines ~167-175 today):
  merged output only contains tickers in the hook's own current set — the
  global accumulator never leaks other pages' symbols to a consumer.
- `staleSymbols` returned to the consumer is the global set **filtered to the
  hook's tickers** (preserves today's per-instance semantics).
- `isStreaming` = manager `isConnected()`; `isLoading` = `!connected && restLoading`
  (unchanged formula).

### Kill-switch

`localStorage.setItem('uct.ssePool.disabled', '1')` (checked once at manager
first-use) → the hook falls back to the **legacy per-instance path**, which is
kept intact in the hook file as `useLegacyRealtimePrices` (the current
implementation, extracted verbatim). One flag flip in DevTools = instant
revert without a deploy; removing the legacy path is a later cleanup once the
pool has weeks of green prod.

### SSR / test safety

- No `EventSource` constructed at module import — only on first subscribe.
- `test-setup.js` already mocks `EventSource`; the manager must construct
  lazily so the mock is in place. `_resetForTests()` clears module state
  between tests.

## Error handling summary

| Failure | Behavior |
|---|---|
| One bucket's connection drops | That bucket backs off + reconnects; other buckets unaffected; prices persist |
| Silent stall (proxy eats the stream) | Watchdog force-reconnects the stalled bucket |
| Union changes mid-reconnect | Debounced rebuild wins; identity guards prevent clobbering newer connections |
| All connections down | `isStreaming=false`; consumers fall back visually to REST-polled data (already merged in) |
| Pool disabled via kill-switch | Hook uses legacy per-instance connections, byte-for-byte today's behavior |

## Testing

**Unit (vitest, `app/src/lib/priceStreamManager.test.js` + hook tests):**
1. Two subscribers → one EventSource with the union (deduped, sorted).
2. Union > 50 → multiple buckets, each ≤ 50.
3. Unsubscribe shrinks union; last unsubscribe closes all connections.
4. Rapid subscribe/unsubscribe within debounce window → single rebuild.
5. Bucket unchanged across a rebuild → its EventSource NOT reconnected.
6. Price message fans out; consumer merge filter hides other tickers.
7. stale/fresh transitions update the filtered per-hook set.
8. tick applied to realtimeCandle exactly once (single connection).
9. Kill-switch flag → hook opens its own EventSource (legacy path).
10. Existing `useRealtimePrices` behavior tests keep passing unchanged.

**Browser verification (prod, post-deploy):** DevTools Network tab shows 1–2
`/api/stream/prices` connections on Dashboard (was 4–8); live prices tick on
Dashboard/Watchlists/Charts workspace/Screener/UCT20/Calendar feed/TickerPopup;
navigation between pages keeps prices on screen; kill-switch flips back to
multiple connections.

## Rollout

Ship enabled by default (kill-switch available). Deploy after market close.
Verify in browser same evening. Document the kill-switch in CLAUDE.md's
Performance section.
