# Live Reliability — Design (Phase 3 of Chart Feel Initiative)

**Date:** 2026-06-09
**Status:** Approved (design); pending implementation plan
**Scope:** Frontend + one small additive server change. No bars/IDB/correctness paths touched.

## Context

The chart's live updates come from `useRealtimePrices` (`app/src/hooks/useRealtimePrices.js`), an SSE client on `/api/stream/prices` **merged with an always-on 2s REST poll** (`useLivePrices`). So live *prices* are resilient: even a dead SSE leaves the 2s REST floor flowing. The SSE adds value on top — sub-2s tick smoothness, `bar_close`/`bar_correction` events, and per-symbol `stale`/`fresh` liveness events. (`useRealtimeBars` is a second SSE path, gated off by `VITE_REALTIME_BARS`; the prices stream is the active one.)

Three concrete weaknesses degrade the live experience and the user's trust in it:

1. **Silent death is undetectable.** The server heartbeat is sent as an SSE *comment* (`api/routers/stream.py:178`, `: heartbeat`). Comments keep the TCP connection alive but fire **no** JS event — so the client cannot tell a silently-stalled stream (Cloudflare idle drop, hung coroutine) from a healthy-but-quiet one. `EventSource.onerror` is unreliable/slow at detecting dead connections through a proxy, so recovery can take minutes.
2. **Slow reconnect.** Backoff caps at 120s (`useRealtimePrices.js:19,109`) — worst-case 2 minutes without tick smoothness / liveness events.
3. **No honest feed indicator.** The only UI is `⏸ STALE` (`StockChart.jsx:4963`), driven solely by server `stale` events. If the *connection* dies, those events stop arriving, so the badge silently stays hidden while the stream is actually dead — there is no positive "LIVE" state and no "RECONNECTING" state.

## Goal

Detect a silently-dropped stream within ~30s and reconnect within ~20s, and always show an honest feed state (LIVE / STALE / RECONNECTING). Prices keep flowing via the untouched 2s REST floor throughout.

Non-goals: changing the price/bar data pipeline, the 2s REST poll, or anything in the bars/IDB/reconciliation correctness layer. The deferred edge cache (B5) and W/M audit (Phase 4 / C7) are out of scope.

## Components

### 1. Server: client-visible heartbeat
`api/routers/stream.py` — change the heartbeat from a comment to a **named event**:
```python
# before:  yield f": heartbeat\n\n"
yield "event: heartbeat\ndata: {}\n\n"
```
Same 15s cadence and keep-alive effect; now the client can listen for it and reset its watchdog. Additive — nothing consumes the comment form today. (Only the `/api/stream/prices` generator; the bars stream is off.)

### 2. Pure status helper — `app/src/utils/streamStatus.js`
```
streamStatus({ isStreaming, isStale }) -> { state, label, tone }
```
- `state: 'reconnecting'` when `!isStreaming` (precedence: a dead connection outranks a stale symbol),
- else `state: 'stale'` when `isStale`,
- else `state: 'live'`.
Returns a display `label` (`LIVE` / `STALE` / `RECONNECTING`) and `tone` (`live` / `warn`). Also exports the tunable constants `STREAM_WATCHDOG_MS = 30000`, `STREAM_WATCHDOG_TICK_MS = 10000`, `STREAM_RECONNECT_CAP_MS = 20000`. Pure → fully unit-tested.

### 3. Client watchdog + faster reconnect — `useRealtimePrices.js`
(The watchdog lives ONLY here, because it depends on the heartbeat to reset `lastMsgRef` during quiet periods. `useRealtimeBars` streams `/api/stream/bars`, which sends no heartbeat — a watchdog there would falsely trip whenever bars are quiet — so it receives the cap reduction ONLY, not the watchdog. It is also off by default (`VITE_REALTIME_BARS`).)
- Add `lastMsgRef` (epoch ms). Set it in `onopen` and at the top of **every** inbound listener: `onmessage`, `tick`, `bar_close`, `bar_correction`, `stale`, `fresh`, and a new `heartbeat` listener (`es.addEventListener('heartbeat', ...)` that does nothing but bump `lastMsgRef`).
- A watchdog `setInterval(STREAM_WATCHDOG_TICK_MS)`: if `connected` and `Date.now() - lastMsgRef.current > STREAM_WATCHDOG_MS`, force-recover — `setConnected(false)`, `es.close()`, clear `esRef`, and schedule an immediate `connect()` (reuse the existing reconnect path; reset backoff to the 5s base for a watchdog-initiated reconnect so recovery is prompt). Guard so it fires once per stall (only when `esRef.current` is the live ES).
- Lower the backoff cap: `Math.min(delay * 2, 120000)` → `Math.min(delay * 2, STREAM_RECONNECT_CAP_MS)` (20s). Initial 5s, ×2 → 5/10/20/20…
- The watchdog interval is created/torn down with the connection lifecycle (same effect cleanup that closes the ES), so no leak.

`useRealtimePrices` already returns `{ isStreaming: connected, staleSymbols }` — unchanged surface; the watchdog only makes `connected` more truthful (flips false on silent death so the indicator and reconnect both react).

### 4. Live indicator — `StockChart.jsx`
Replace the current `{isStale && (<div …>⏸ STALE</div>)}` block (~line 4963) with a single badge driven by `streamStatus({ isStreaming, isStale })`, rendered **only** when `liveUpdates && realtimeTfEligible` (live-capable surface + intraday TF) so Daily/Weekly/Monthly, Model Book, and closed-market charts don't show a spurious "RECONNECTING":
- `live` → `● LIVE` with a subtle green pulse,
- `stale` → `⏸ STALE` (existing amber styling/wording preserved),
- `reconnecting` → `⟳ RECONNECTING` (amber).
`isStreaming` comes from `useRealtimePrices` (already consumed in StockChart via the same hook call that yields `staleSymbols`). New CSS classes mirror the existing `.staleIndicator` style.

## Data flow

```
/api/stream/prices ──(named events incl. heartbeat)──▶ useRealtimePrices
   every event → lastMsgRef = now
   watchdog (10s tick): connected && now-lastMsgRef > 30s → close + reconnect (≤20s cap)
   onopen → connected=true ; onerror/watchdog → connected=false
        │
        ├─ isStreaming + staleSymbols ─▶ streamStatus() ─▶ StockChart badge (LIVE/STALE/RECONNECTING)
        └─ prices (SSE ⊕ 2s REST floor) ─▶ live candle (unchanged; never blocked by stream health)
```

## Error handling
- Watchdog-forced reconnect uses the existing backoff/reconnect machinery; if reconnect keeps failing, the badge stays RECONNECTING while the 2s REST floor keeps prices current (degraded smoothness, never blank).
- Malformed heartbeat/event payloads are swallowed (existing `try/catch` per listener); the heartbeat listener only bumps the timestamp, no parsing required.
- If `EventSource` is unavailable, `useRealtimePrices` already no-ops the stream and relies on REST — unchanged.

## Testing
- **`streamStatus` unit tests** (`app/src/utils/streamStatus.test.js`): `live` when streaming+fresh; `stale` when streaming+stale; `reconnecting` when not streaming (and precedence: not-streaming + stale → `reconnecting`); label/tone values; constants exported.
- **Watchdog + reconnect + badge**: manual verification (EventSource not jsdom-renderable). With the app running: on `/charts` intraday, block `/api/stream/prices` (DevTools → Network → offline, or block the URL) → badge flips to RECONNECTING within ~30s; restore → reconnect within ~20s → badge returns to LIVE; confirm prices still tick (~2s) while RECONNECTING.

## Files
- New: `app/src/utils/streamStatus.js` (+ `streamStatus.test.js`).
- Modify: `app/src/hooks/useRealtimePrices.js` (watchdog, heartbeat listener, cap).
- Modify: `app/src/hooks/useRealtimeBars.js` (reconnect cap reduction ONLY — no watchdog; the bars stream has no heartbeat).
- Modify: `api/routers/stream.py` (heartbeat → named event).
- Modify: `app/src/components/StockChart.jsx` (status badge) + `StockChart.module.css` (badge styles).

## Tunables (defaults chosen)
- `STREAM_WATCHDOG_MS = 30000`, `STREAM_WATCHDOG_TICK_MS = 10000`, `STREAM_RECONNECT_CAP_MS = 20000`, heartbeat `15s` (unchanged in stream.py).
